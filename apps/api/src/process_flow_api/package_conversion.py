"""Package facts -> a detached, executed ProcessFlow; persistence is the last step."""
from __future__ import annotations

import copy
import hashlib
import json
import math
from collections.abc import Mapping
from typing import Any

from process_flow_geometry_generators import GeometryGeneratorRegistry
from process_flow_kernel import (
    FlowCompiler, GeometryArtifact, GeometryKernel, InMemoryGeometryCatalog, analyze_flow_graph,
)
from process_flow_kernel.application.material_instances import strip_material_dup_suffix
from process_flow_kernel.domain.provenance import structure_nodes

from .models import ProcessFlowCreate
from .package_conversion_schema import ConversionRequest, normalize_source, write_pointer
from .repository import DuplicateItemError, NotFoundError, ResourceConflictError, SQLiteStore
from .services import create_flow, load_step_templates_for_definition, prepare_flow, require_item


JsonObject = dict[str, Any]


class ConversionError(ValueError):
    def __init__(self, message: str, report: JsonObject):
        super().__init__(message)
        self.report = report


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":"),
    ).encode("utf-8")).hexdigest()


def convert_package(
    store: SQLiteStore, generators: GeometryGeneratorRegistry, request: ConversionRequest,
    *, persist: bool = False,
) -> JsonObject:
    """Preview never writes. Import repeats the same validation before native create_flow."""
    baseline = require_item(store.get_process_flow(request.baseFlowId), request.baseFlowId)
    if baseline["revision"] != request.baseRevision:
        raise ResourceConflictError(f"Baseline flow {request.baseFlowId} revision changed; reload it")
    converter = _Converter(store, generators, request, baseline)
    try:
        return converter.run(persist=persist)
    except (DuplicateItemError, NotFoundError, ResourceConflictError):
        raise
    except (ValueError, KeyError) as error:
        converter.report["status"] = "failed"
        converter._record_assumptions()
        issue = {"message": str(error)}
        if converter.current_rule is not None:
            rule = converter.current_rule
            issue["ruleId"] = rule.id
            issue["sourcePath"] = converter.facts[rule.fact]["sourcePath"]
            issue["message"] = f"Rule {rule.id} ({issue['sourcePath']}): {error}"
        converter.report["errors"].append(issue)
        raise ConversionError(issue["message"], converter.report) from error


class _Converter:
    def __init__(self, store, generators, request, baseline):
        self.store, self.generators, self.request, self.baseline = store, generators, request, baseline
        self.current_rule = None
        self.facts: dict[str, JsonObject] = {}
        self.writes: dict[tuple[str, str, str], str] = {}
        self.catalog: dict[str, JsonObject] = {}
        self.input_artifacts: dict[str, GeometryArtifact] = {}
        self.report: JsonObject = {
            "schemaVersion": 1, "status": "validating",
            "profile": {"id": request.profile.id, "version": request.profile.version,
                        "sha256": _digest(request.profile.payload())},
            "sourceSha256": _digest(request.source),
            "baseFlow": {"id": baseline["id"], "revision": baseline["revision"],
                         "sha256": _digest(baseline)},
            "facts": [], "changes": [], "assumptions": [], "checks": [],
            "executionWarnings": [], "errors": [],
        }
        self.flow = {
            "schemaVersion": 3, **request.metadata.payload(),
            "definition": copy.deepcopy(baseline["definition"]),
            "configuration": copy.deepcopy(baseline["configuration"]),
            "origin": {"flowId": baseline["id"], "revision": baseline["revision"]},
        }

    def run(self, *, persist):
        self.report["facts"] = normalize_source(self.request.source, self.request.profile)
        self.facts = {fact["id"]: fact for fact in self.report["facts"]}
        self.templates = load_step_templates_for_definition(self.store, self.flow["definition"])
        self.graph = analyze_flow_graph(self.flow["definition"], self.templates)
        self._validate_bindings()
        for binding in self.flow["configuration"]["inputBindings"].values():
            if binding["kind"] == "catalog":
                geometry_id = binding["geometryId"]
                self.catalog[geometry_id] = require_item(self.store.get_geometry(geometry_id), geometry_id)
            else:
                try:
                    self.generators.definition(binding["generatorId"], binding["generatorVersion"])
                except KeyError:
                    raise ValueError(f"Unknown geometry generator {binding['generatorId']} v{binding['generatorVersion']}") from None
        self.compiler = FlowCompiler(InMemoryGeometryCatalog(self.catalog.values()), self.generators)
        self.kernel = GeometryKernel()
        for rule in self.request.profile.rules:
            self.current_rule = rule
            if rule.type == "parameter":
                self._map_parameter(rule)
            elif rule.type == "generator_parameter":
                self._map_generator_parameter(rule)
        self.current_rule = None
        self.compiler.validate_authoring(self.flow["definition"], self.flow["configuration"], self.templates)
        order = {step: index for index, step in enumerate(self.graph.ordered_step_ref_ids)}
        derived = [rule for rule in self.request.profile.rules if rule.type == "molding_final_thickness"]
        # Resolve every target first, including absent roles, before sorting on graph position.
        for rule in derived:
            self.current_rule = rule
            self._step(rule.grindingRole, program="grinding/grinding")
        for rule in sorted(derived, key=lambda item: order[self._step(item.grindingRole)]):
            self.current_rule = rule
            self._derive_molding_thickness(rule)
        self.current_rule = None
        result = self._execute()
        self.report["executionWarnings"] = result.execution_warnings()
        terminals = result.terminal_step_ref_ids()
        if len(terminals) != 1:
            raise ValueError("Conversion requires exactly one terminal output")
        terminal = result.step_artifact(terminals[0])
        for rule in self.request.profile.rules:
            self.current_rule = rule
            if rule.type == "generator_parameter":
                input_id = self._input(rule.inputRole)
                self._verify(rule, self._input_artifact(input_id), rule.verify,
                             {"kind": "flowInput", "flowInputId": input_id})
                continue
            step = self._step(rule.role if rule.type == "parameter" else rule.grindingRole)
            producer = self._step(rule.role if rule.type == "parameter" else rule.moldingRole)
            selector = (rule.verify if rule.type == "parameter" else
                        {"kind": "body", "property": "thickness", "key": "molding"})
            self._verify(rule, result.step_artifact(step), selector,
                         {"kind": "stepOutput", "stepRefId": step}, producer=producer)
            verify_terminal = rule.verify.terminal if rule.type == "parameter" else rule.terminal
            if verify_terminal:
                self._verify(rule, terminal, selector,
                             {"kind": "terminal", "stepRefId": terminals[0]}, producer=producer)
        self.current_rule = None
        body = ProcessFlowCreate.model_validate(self.flow)
        # Also use the native create validation for enabled templates and catalog identities.
        prepare_flow(self.store, body, self.generators)
        self._assert_resources_unchanged()
        self._record_assumptions()
        self.report["resources"] = {
            "stepTemplates": [{"id": item["id"], "sha256": _digest(item)} for item in self.templates],
            "catalogGeometries": [{"id": item["id"], "sha256": _digest(item)} for item in self.catalog.values()],
        }
        self.report["status"] = "validated"
        if persist:
            saved = create_flow(self.store, body, self.generators, expected_resources={
                "process_flows": [self.baseline], "process_step_templates": self.templates,
                "geometries": list(self.catalog.values()),
            })
            self.report["status"] = "imported"
            self.report["importedFlow"] = {"id": saved["id"], "revision": saved["revision"]}
            return {"flow": saved, "report": self.report}
        return {"flow": body.payload(), "report": self.report}

    def _validate_bindings(self):
        for role, step in self.request.bindings.roles.items():
            if step not in self.graph.step_refs_by_id:
                raise ValueError(f"Role {role}: stepRefId {step!r} does not exist in baseline flow")
        for role, input_id in self.request.bindings.inputs.items():
            if input_id not in self.graph.flow_inputs_by_id:
                raise ValueError(f"Input role {role}: flowInputId {input_id!r} does not exist in baseline flow")

    def _step(self, role, *, program=None):
        step = self.request.bindings.roles.get(role)
        if step is None:
            raise ValueError(f"Missing process role binding: {role}")
        if program is not None and self.graph.step_templates_by_ref_id[step]["program"] != program:
            raise ValueError(f"Role {role} ({step}) requires program {program}")
        return step

    def _input(self, role):
        input_id = self.request.bindings.inputs.get(role)
        if input_id is None:
            raise ValueError(f"Missing input role binding: {role}")
        return input_id

    def _selected(self, step):
        config = self.flow["configuration"]["stepConfigurations"].get(step, {})
        selected = config.get("selectedRecipeId")
        recipe = next((item for item in config.get("recipeCandidates", ())
                       if item["recipeId"] == selected), None)
        if recipe is None:
            raise ValueError(f"Step {step} needs an explicitly selected recipe; no candidate is inferred")
        return recipe

    def _reserve(self, kind, owner, path, rule):
        key = (kind, owner, path)
        for previous, rule_id in self.writes.items():
            same_owner = previous[:2] == key[:2]
            overlapping = (previous[2] == path or kind == "generatorParameter" and
                           (previous[2].startswith(path + "/") or path.startswith(previous[2] + "/")))
            if same_owner and overlapping:
                raise ValueError(f"Conflicting writes to {owner}.{path}: rules {rule_id} and {rule.id}")
        self.writes[key] = rule.id

    def _write_parameter(self, rule, step, parameter, value, *, origin="source", **details):
        self._reserve("stepParameter", step, parameter, rule)
        recipe = self._selected(step)
        values = recipe["parameterValues"]
        change = {
            "ruleId": rule.id, "factId": rule.fact, "sourcePath": self.facts[rule.fact]["sourcePath"],
            "origin": origin, "target": {"kind": "stepParameter", "stepRefId": step,
                                        "recipeId": recipe["recipeId"], "parameter": parameter},
            "baselinePresent": parameter in values, "baselineValue": copy.deepcopy(values.get(parameter)),
            "value": value, **details,
        }
        values[parameter] = value
        self.report["changes"].append(change)

    def _map_parameter(self, rule):
        step = self._step(rule.role)
        fact = self.facts[rule.fact]
        field = next(item for item in self.request.profile.fields if item.id == rule.fact)
        definition = self._target_definition(step, rule.parameter, field.kind)
        value = fact["value"]
        if definition["valueType"] == "integer" and isinstance(value, float) and value.is_integer():
            value = int(value)
        self._write_parameter(rule, step, rule.parameter, value)

    def _target_definition(self, step, parameter, kind):
        template = self.graph.step_templates_by_ref_id[step]
        definition = next((item for item in template["parameterDefinitions"] if item["id"] == parameter), None)
        if definition is None:
            raise ValueError(f"Step {step} does not define parameter {parameter}")
        if kind == "material":
            if definition["valueType"] != "materialRef":
                raise ValueError(f"Material fact requires a materialRef target: {step}.{parameter}")
        else:
            if definition["valueType"] not in ("float", "integer"):
                raise ValueError(f"Numeric fact requires a scalar numeric target: {step}.{parameter}")
            if kind == "length" and definition.get("unit") not in ("um", "µm"):
                raise ValueError(f"Length target {step}.{parameter} must explicitly use um")
            if kind == "density" and definition.get("unit") not in (None, "%", "percent"):
                raise ValueError(f"Density target {step}.{parameter} must use percent")
        return definition

    def _map_generator_parameter(self, rule):
        input_id = self._input(rule.inputRole)
        binding = self.flow["configuration"]["inputBindings"].get(input_id)
        if binding is None or binding["kind"] != "generator":
            raise ValueError(f"Input {input_id} needs a generator binding; shared catalog geometry is never modified")
        self._reserve("generatorParameter", input_id, rule.parameterPath, rule)
        value = self.facts[rule.fact]["value"]
        previous = write_pointer(binding["parameters"], rule.parameterPath, value)
        self.report["changes"].append({
            "ruleId": rule.id, "factId": rule.fact, "sourcePath": self.facts[rule.fact]["sourcePath"],
            "origin": "source", "target": {"kind": "generatorParameter", "flowInputId": input_id,
                                           "parameterPath": rule.parameterPath},
            "baselinePresent": True, "baselineValue": previous, "value": value,
        })

    def _execute(self, output_step=None):
        plan = self.compiler.compile(self.flow["definition"], self.flow["configuration"], self.templates,
                                     output_step_ref_id=output_step)
        for input_id, artifact in plan.external_geometries.items():
            self._require_um(artifact, f"Input {input_id}")
        result = self.kernel.execute(plan)
        for step in plan.steps:
            self._require_um(result.step_artifact(step.step_ref_id), f"Step {step.step_ref_id}")
        return result

    @staticmethod
    def _require_um(artifact, label):
        if artifact is None or artifact.structure.get("unitSystem") != "um":
            raise ValueError(f"{label}: geometry unitSystem must be um; implicit geometry rescaling is unsupported")

    def _primary_path(self, producer, grinder):
        current, path = grinder, []
        while current != producer:
            edge = self.graph.incoming_edges_by_port.get((current, "main_geometry"))
            if edge is None or edge["source"]["kind"] != "stepOutput":
                raise ValueError(f"Molding {producer} must be upstream on the primary geometry path of {grinder}")
            current = edge["source"]["stepRefId"]
            path.append(current)
        return path

    def _derive_molding_thickness(self, rule):
        producer = self._step(rule.moldingRole, program="layer/molding")
        grinder = self._step(rule.grindingRole, program="grinding/grinding")
        self._target_definition(producer, "thickness", "length")
        target_definition = self._target_definition(grinder, "thk", "length")
        if producer == grinder:
            raise ValueError("Molding and grinding roles must refer to different steps")
        path = self._primary_path(producer, grinder)
        if any(self.graph.step_templates_by_ref_id[step]["program"] == "flip/flip" for step in path):
            raise ValueError("Molding thickness derivation across Flip is unsupported; choose a compatible baseline")
        upstream = self.graph.incoming_edges_by_port[(grinder, "main_geometry")]["source"]["stepRefId"]
        artifact = self._execute(upstream).step_artifact(upstream)
        nodes = self._nodes(artifact, {"kind": "body", "key": "molding"}, producer=producer)
        if len(nodes) != 1:
            raise ValueError(f"Molding {producer} must identify exactly one body before {grinder}; found {len(nodes)}")
        node = nodes[0]
        final_thickness = self.facts[rule.fact]["value"]
        if final_thickness <= 0:
            raise ValueError("Final molding thickness must be positive")
        top_before = artifact.fork_state().geometry_z_max()
        target_z = node["zMin"] + final_thickness
        removal = top_before - target_z
        if not math.isfinite(removal) or removal <= 0:
            raise ValueError(f"Derived grinding removal must be positive, got {removal}; adjust the baseline recipe")
        if target_definition["valueType"] == "integer" and isinstance(removal, float) and removal.is_integer():
            removal = int(removal)
        self._write_parameter(
            rule, grinder, "thk", removal, origin="derived",
            formula="grinding.thk = incoming.zMax - (molding.zMin + finalThickness)",
            inputs={"incomingZMax": top_before, "moldingZMin": node["zMin"],
                    "finalThickness": final_thickness, "targetZ": target_z,
                    "moldingStepRefId": producer, "moldingBodyId": node["id"], "unit": "um"},
        )
        # Fail at this checkpoint before attempting dependent derivations downstream.
        output = self._execute(grinder).step_artifact(grinder)
        self._verify(rule, output, {"kind": "body", "property": "thickness", "key": "molding"},
                     {"kind": "stepOutput", "stepRefId": grinder}, producer=producer)

    def _input_artifact(self, input_id):
        if input_id not in self.input_artifacts:
            binding = self.flow["configuration"]["inputBindings"][input_id]
            entity = self.generators.generate(binding["generatorId"], binding["generatorVersion"], binding["parameters"])
            self.input_artifacts[input_id] = GeometryArtifact.from_entity(entity)
        return self.input_artifacts[input_id]

    @staticmethod
    def _selector_value(selector, name):
        return selector.get(name) if isinstance(selector, Mapping) else getattr(selector, name)

    def _nodes(self, artifact, selector, *, producer=None):
        if artifact is None:
            raise ValueError("Expected geometry checkpoint is absent")
        self._require_um(artifact, "Geometry checkpoint")
        nodes = artifact.fork_state().find_geometry(kind=self._selector_value(selector, "kind"))
        key = self._selector_value(selector, "key")
        if key is not None:
            nodes = [node for node in nodes if node["key"] == key]
        if producer is not None:
            nodes = [node for node in nodes
                     if (artifact.provenance.get(node["id"], {}).get("createdBy") or {}).get("stepRefId") == producer]
        return nodes

    def _verify(self, rule, artifact, selector, checkpoint, *, producer=None):
        nodes = self._nodes(artifact, selector, producer=producer)
        fact = self.facts[rule.fact]
        prop = self._selector_value(selector, "property")
        payloads = {node["id"]: node for node in structure_nodes(artifact.structure)}
        actual = []
        for node in nodes:
            actual.append(node["zMax"] - node["zMin"] if prop == "thickness" else
                          payloads[node["id"]].get(prop))
        expected = fact["value"]
        tolerance = self.request.profile.lengthTolerance if prop == "thickness" else 1e-8
        if prop == "material":
            matches = [isinstance(value, str) and strip_material_dup_suffix(value) ==
                       strip_material_dup_suffix(expected) for value in actual]
        else:
            matches = [type(value) in (int, float) and math.isfinite(value) and
                       abs(value - expected) <= tolerance for value in actual]
        passed = bool(actual) and all(matches)
        check = {
            "ruleId": rule.id, "checkpoint": checkpoint, "sourcePath": fact["sourcePath"],
            "property": prop, "expected": expected,
            "actual": actual[0] if len(actual) == 1 else actual,
            "nodeIds": [node["id"] for node in nodes], "passed": passed,
            "tolerance": None if prop == "material" else tolerance,
        }
        existing = next((index for index, item in enumerate(self.report["checks"])
                         if item["ruleId"] == rule.id and item["checkpoint"] == checkpoint), None)
        if existing is None:
            self.report["checks"].append(check)
        else:
            self.report["checks"][existing] = check
        if not passed:
            raise ValueError(f"{checkpoint['kind']} verification failed for {prop}: expected {expected!r}, got {actual!r}")

    def _record_assumptions(self):
        self.report["assumptions"] = []
        for step, config in self.baseline["configuration"].get("stepConfigurations", {}).items():
            selected = next((item for item in config["recipeCandidates"] if item["recipeId"] == config["selectedRecipeId"]), None)
            if selected is None:
                continue
            retained = {name: copy.deepcopy(value) for name, value in selected["parameterValues"].items()
                        if ("stepParameter", step, name) not in self.writes}
            if retained:
                self.report["assumptions"].append({
                    "kind": "baselineRecipe", "origin": "baseline", "stepRefId": step,
                    "recipeId": selected["recipeId"], "parameterValues": retained,
                })
        for input_id, binding in self.baseline["configuration"].get("inputBindings", {}).items():
            self.report["assumptions"].append({
                "kind": "baselineInputBinding", "origin": "baseline", "flowInputId": input_id,
                "binding": copy.deepcopy(binding),
                "overriddenPaths": [path for kind, owner, path in self.writes
                                    if kind == "generatorParameter" and owner == input_id],
            })

    def _assert_resources_unchanged(self):
        current = require_item(self.store.get_process_flow(self.baseline["id"]), self.baseline["id"])
        if _digest(current) != _digest(self.baseline):
            raise ResourceConflictError("Baseline flow changed during conversion; retry from its current revision")
        for previous in self.templates:
            current = self.store.get_process_step_template(previous["id"])
            if current is None or _digest(current) != _digest(previous):
                raise ResourceConflictError(f"Process step template {previous['id']} changed during conversion")
        for previous in self.catalog.values():
            current = self.store.get_geometry(previous["id"])
            if current is None or _digest(current) != _digest(previous):
                raise ResourceConflictError(f"Catalog geometry {previous['id']} changed during conversion")
