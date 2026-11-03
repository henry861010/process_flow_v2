"""Plan horizontal scenes from a partial flow without executing future steps.

Abstract inventories reserve space; only the selected, executed snapshot supplies
visible geometry. Container-to-cohort bindings are presentation sidecars and are
never serialized back into physical geometry.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping

from process_flow_schematic import (
    ComponentHint, SchematicLayoutGroup, SchematicLayoutPlan,
    compose_schematic, describe_schematic_components, make_layout_plan,
)
from process_flow_steps.schematic_layout import component_effect

from .schematic_builder import SCHEMATIC_PRESENTATION_VERSION, schematic_registry
from .services import (
    PreparedPreviewExecution, PreviewRequestContext, PreviewSnapshotGeometry,
    preview_compiler, preview_request_identity, resolve_preview_flow_input,
    validate_preview_step,
)


def _key(*parts: Any) -> str:
    payload = json.dumps(parts, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


def schematic_layout_fingerprint(context: PreviewRequestContext) -> str:
    identity = preview_request_identity(context)
    identity.pop("target")
    identity.pop("sourceLabel")
    # Labels do not affect placement or component classification.
    identity["definition"] = {**identity["definition"], "stepRefs": [
        {key: value for key, value in ref.items() if key != "stepLabel"}
        for ref in identity["definition"].get("stepRefs", [])
    ]}
    return _key(SCHEMATIC_PRESENTATION_VERSION, identity)


@dataclass(frozen=True)
class _Component:
    key: str
    hint: ComponentHint


@dataclass(frozen=True)
class _Inventory:
    assembly: str
    components: tuple[_Component, ...]
    prototype: Mapping[str, Any]
    bindings: Mapping[str, str]


@dataclass
class FlowSchematicPlan:
    fingerprint: str
    layouts: dict[str, SchematicLayoutPlan] = field(default_factory=dict)
    outputs: dict[str, _Inventory] = field(default_factory=dict)
    inputs: dict[str, _Inventory] = field(default_factory=dict)
    input_bindings: dict[str, dict[str, str]] = field(default_factory=dict)
    input_assemblies: dict[str, set[str]] = field(default_factory=dict)

    @property
    def cache_weight(self) -> int:
        return len(json.dumps(asdict(self), default=lambda value: sorted(value),
                              separators=(",", ":")).encode())

    def layout_for(self, target: Mapping[str, Any]) -> SchematicLayoutPlan | None:
        if target["type"] == "stepOutput":
            inventory = self.outputs.get(target["stepRefId"])
            return self.layouts.get(inventory.assembly) if inventory else None
        input_id = target["flowInputId"]
        assemblies = self.input_assemblies.get(input_id, set())
        # A shared catalog input can feed independent assemblies. Its standalone
        # preview must not silently pick one of their unrelated layouts.
        if len(assemblies) == 1:
            return self.layouts[next(iter(assemblies))]
        inventory = self.inputs.get(input_id)
        return self.layouts.get(inventory.assembly) if inventory else None


class _Planner:
    def __init__(self, context, generators, resolved_inputs=None):
        self.context, self.generators = context, generators
        self.compiler = preview_compiler(context, generators)
        self.registry = schematic_registry()
        self.resolved_inputs = resolved_inputs or {}
        self.plan = FlowSchematicPlan(schematic_layout_fingerprint(context))
        self.refs = {ref["stepRefId"]: ref for ref in context.definition.get("stepRefs", [])}
        self.templates = {template["id"]: template for template in context.step_templates}
        self.incoming = {}
        for edge in context.definition.get("flowEdges", []):
            self.incoming.setdefault((edge["target"]["stepRefId"], edge["target"]["inputPortId"]), []).append(edge)
        self.groups: dict[str, dict[str, _Component]] = {}
        self.notes: dict[str, list[str]] = {}
        self.failures: dict[str, str] = {}
        self.visiting: set[str] = set()

    def _remember(self, inventory):
        groups = self.groups.setdefault(inventory.assembly, {})
        for component in inventory.components:
            groups.setdefault(component.key, component)
        return inventory

    def inventory(self, assembly, prototype, bindings):
        hints = describe_schematic_components(prototype, self.registry)
        components = {bindings[id_]: _Component(bindings[id_], hint) for id_, hint in hints.items()}
        return _Inventory(assembly, tuple(components.values()),
                          prototype, bindings)

    def input(self, input_id):
        if input_id in self.plan.inputs:
            return self.plan.inputs[input_id]
        structure = self.resolved_inputs.get(input_id)
        if structure is None:
            structure = resolve_preview_flow_input(self.context, self.generators, input_id, compiler=self.compiler)
        bindings = {}

        def visit(container, path):
            bindings[container["id"]] = _key("input", input_id, path)
            for index, child in enumerate(container.get("children", [])):
                visit(child, (*path, index))

        visit(structure["root"], ())
        # Freeze source entry classes once. Equivalent imported sibling dies
        # share a source class even though their physical container IDs differ.
        document = compose_schematic(structure, self.registry)
        for component in document["components"]:
            source_ids = component["sourceIds"]
            if source_ids:
                group_key = bindings[source_ids[0]]
                for source_id in source_ids:
                    bindings[source_id] = group_key
        inventory = self.inventory(_key("input-scene", input_id), structure, bindings)
        self.plan.inputs[input_id] = inventory
        self.plan.input_bindings[input_id] = bindings
        return self._remember(inventory)

    def source(self, edge):
        source = edge["source"]
        if source["kind"] == "flowInput":
            return self.input(source["flowInputId"])
        return self.output(source["stepRefId"])

    def main(self, ref_id):
        edges = self.incoming.get((ref_id, "main_geometry"), [])
        if len(edges) != 1:
            raise ValueError("main_geometry needs one connected source")
        edge = edges[0]
        inventory = self.source(edge)
        if edge["source"]["kind"] == "flowInput":
            assembly = _key("assembly", edge["source"]["flowInputId"], ref_id)
            inventory = _Inventory(assembly, inventory.components, inventory.prototype, inventory.bindings)
            self.plan.input_assemblies.setdefault(edge["source"]["flowInputId"], set()).add(assembly)
        return self._remember(inventory)

    def output(self, ref_id):
        if ref_id in self.plan.outputs:
            return self.plan.outputs[ref_id]
        if ref_id in self.failures:
            raise ValueError(self.failures[ref_id])
        if ref_id in self.visiting:
            raise ValueError("dependency cycle")
        self.visiting.add(ref_id)
        main = None
        try:
            # Resolve the main path first so a stopped future step can annotate
            # the already-known scene without reaching beyond the missing step.
            main = self.main(ref_id)
            validate_preview_step(self.context, self.generators, ref_id, compiler=self.compiler)
            template = self.templates[self.refs[ref_id]["processStepTemplateId"]]
            effect = component_effect(template["program"])
            if effect is None:
                raise ValueError("this process has no component layout description")
            configuration = self.context.configuration.get("stepConfigurations", {}).get(ref_id, {})
            recipe = next(recipe for recipe in configuration.get("recipeCandidates", [])
                          if recipe["recipeId"] == configuration.get("selectedRecipeId"))
            placements = recipe.get("parameterValues", {}).get("placements")
            sources = {}
            for port in template.get("inputPorts", []):
                port_id = port["portId"]
                if port_id == "main_geometry" or (effect == "place" and placements == [] and port_id == "die_geometry"):
                    continue
                edges = self.incoming.get((ref_id, port_id), [])
                if edges:
                    sources[port_id] = self.source(edges[0])
            prototype, bindings = main.prototype, main.bindings
            if effect == "add_root_body":
                # A presence marker models generic imported-container selection
                # after deposition. Its coordinates never supply measurements,
                # display bounds, or physical geometry, and are discarded after
                # planning. Semantic component hints remain producer-owned.
                marker = {"id": _key("root-body-presence", ref_id), "material": "layout-presence",
                          "geometry": {"type": "BoxGeometry", "bottom_left": [0, 0, 0],
                                       "top_right": [1, 1, 0], "thk": 1}}
                prototype = {**prototype, "root": {**prototype["root"],
                    "bodies": [*prototype["root"].get("bodies", []), marker]}}
            if effect == "place" and placements:
                source = sources["die_geometry"]
                # One abstract attached subtree suffices for selection/hints;
                # physical placement count never determines representative count.
                placed = deepcopy(source.prototype["root"])
                bindings = dict(main.bindings)

                def remap(container):
                    original_id = container["id"]
                    container["id"] = _key("prototype", ref_id, original_id)
                    bindings[container["id"]] = _key("pnp", ref_id, source.bindings[original_id])
                    for collection in ("bodies", "vias", "circuits", "bumps"):
                        for node in container.get(collection, []):
                            node["id"] = _key("prototype-node", ref_id, node["id"])
                    for child in container.get("children", []):
                        remap(child)

                remap(placed)
                prototype = {**main.prototype, "root": {**main.prototype["root"],
                    "children": [*main.prototype["root"].get("children", []), placed]}}
            inventory = self.inventory(main.assembly, prototype, bindings)
            self.plan.outputs[ref_id] = inventory
            return self._remember(inventory)
        except (ValueError, KeyError, StopIteration) as error:
            reason = str(error) or "required recipe or geometry is unavailable"
            self.failures[ref_id] = reason
            if main is not None:
                self.notes.setdefault(main.assembly, []).append(f"Layout lookahead stopped at {ref_id}: {reason}.")
            raise ValueError(reason) from error
        finally:
            self.visiting.discard(ref_id)

    def build(self):
        # Recursive dependencies establish primary-path order even when stepRefs
        # are not topologically sorted. Independent scenes remain independent.
        for ref_id in self.refs:
            try:
                self.output(ref_id)
            except ValueError:
                pass
        for assembly, groups in self.groups.items():
            self.plan.layouts[assembly] = make_layout_plan(
                [SchematicLayoutGroup(component.key, component.hint) for component in groups.values()],
                fingerprint=_key(self.plan.fingerprint, assembly),
                notes=tuple(dict.fromkeys(self.notes.get(assembly, []))),
            )
        # Prototypes are temporary planning inputs, not cached drawing state.
        self.plan.outputs = {key: _Inventory(value.assembly, value.components, {}, {})
                             for key, value in self.plan.outputs.items()}
        self.plan.inputs = {key: _Inventory(value.assembly, value.components, {}, {})
                            for key, value in self.plan.inputs.items()}
        return self.plan


def plan_flow_schematic(context, generators, *, resolved_inputs=None) -> FlowSchematicPlan:
    return _Planner(context, generators, resolved_inputs).build()


def bind_schematic_snapshots(
    planning: FlowSchematicPlan,
    prepared: PreparedPreviewExecution,
    snapshots: tuple[PreviewSnapshotGeometry, ...],
) -> dict[str | None, dict[str, str]]:
    """Follow actual container identities through the executed prefix only."""
    if prepared.execution_plan is None:
        return {None: planning.input_bindings.get(prepared.context.target["flowInputId"], {})}
    plan = prepared.execution_plan
    outputs = {snapshot.step_ref_id: snapshot.geometry_structure for snapshot in snapshots}
    bindings: dict[str | None, dict[str, str]] = {}

    def resolve(source):
        if source.kind == "external":
            return plan.external_geometries[source.flow_input_id].structure, planning.input_bindings.get(source.flow_input_id, {})
        return outputs[source.step_ref_id], bindings[source.step_ref_id]

    for step in plan.steps:
        main, main_bindings = resolve(step.geometry_inputs["main_geometry"])
        output = outputs[step.step_ref_id]
        current = dict(main_bindings)
        if step.step_template["program"] == "pnp/pnp" and step.parameter_values["placements"]:
            source, source_bindings = resolve(step.geometry_inputs["die_geometry"])
            first_child = len(main["root"].get("children", []))

            def match(original, placed):
                if (original.get("key") != placed.get("key")
                        or len(original.get("children", [])) != len(placed.get("children", []))):
                    raise ValueError("PnP adaptation changed the component hierarchy")
                if original["id"] in source_bindings:
                    current[placed["id"]] = _key("pnp", step.step_ref_id, source_bindings[original["id"]])
                for before, after in zip(original.get("children", []), placed.get("children", [])):
                    match(before, after)

            placed_children = output["root"].get("children", [])[first_child:]
            if len(placed_children) != len(step.parameter_values["placements"]):
                raise ValueError("PnP output does not match the placement lineage")
            for child in placed_children:
                match(source["root"], child)
        present = set()

        def collect(container):
            present.add(container["id"])
            for child in container.get("children", []):
                collect(child)

        collect(output["root"])
        current = {key: value for key, value in current.items() if key in present}
        layout = planning.layout_for({"type": "stepOutput", "stepRefId": step.step_ref_id})
        if layout is not None:
            planned_keys = {slot.group_key for slot in layout.slots}
            # Generic imported wrappers can cease to be selected after their
            # body is removed. Surviving descendants retain their ancestor's
            # reserved cohort instead of becoming unbound display components.
            def inherit(container, ancestor_key=None):
                own_key = current.get(container["id"])
                if own_key in planned_keys:
                    ancestor_key = own_key
                elif ancestor_key is not None:
                    current[container["id"]] = ancestor_key
                for child in container.get("children", []):
                    inherit(child, ancestor_key)

            inherit(output["root"])
        bindings[step.step_ref_id] = current
    return bindings
