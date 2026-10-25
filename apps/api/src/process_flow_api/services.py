from __future__ import annotations

import asyncio
import base64
import copy
from dataclasses import dataclass
from typing import Any, Mapping

from process_flow_geometry_generators import GeometryGeneratorRegistry
from process_flow_kernel import (
    ExecuteOptions,
    ExecutionPlan,
    FlowCompiler,
    GeometryKernel,
    InMemoryGeometryCatalog,
    validate_flow_graph,
    validate_process_step_template as validate_step_contract,
)

from .geometry_preview_exporter import export_geometry
from .geometry_resolver import StoreGeometryCatalog
from .identifiers import generated_flow_id
from .models import (
    GeometryPreviewRequest,
    GeometryPreviewStepRequest,
    ProcessFlowCreate,
    ProcessFlowUpdate,
    ProcessStepTemplate,
)
from .repository import NotFoundError, ResourceConflictError, SQLiteStore
from .step_template_transfer import locked_process_step_template as _locked_process_step_template


JsonObject = dict[str, Any]


@dataclass(frozen=True, slots=True)
class PreviewRequestContext:
    """Fully resolved, immutable input used to address and build a preview session."""

    definition: JsonObject
    step_templates: tuple[JsonObject, ...]
    configuration: JsonObject
    target: JsonObject
    source_label: str | None
    referenced_catalog_geometries: JsonObject


@dataclass(frozen=True, slots=True)
class PreparedPreviewExecution:
    """A compiled step timeline or one resolved flow-input geometry."""

    context: PreviewRequestContext
    execution_plan: ExecutionPlan | None = None
    flow_input_geometry: JsonObject | None = None


@dataclass(frozen=True, slots=True)
class PreviewSnapshotGeometry:
    source_kind: str
    step_ref_id: str | None
    label: str
    order: int
    target: JsonObject
    geometry_structure: JsonObject


def bootstrap_payload(store: SQLiteStore) -> JsonObject:
    return {
        "processStepTemplates": store.list_process_step_templates(),
        "processFlows": store.list_process_flows(),
        "geometries": store.list_geometries(),
    }


def require_item(item: JsonObject | None, id_: str) -> JsonObject:
    if item is None:
        raise NotFoundError(id_)
    return item


def require_enabled_template(template: JsonObject, *, kind: str, action: str) -> None:
    if template.get("status", "enabled") == "disabled":
        raise ResourceConflictError(
            f"{kind} template {template['id']} is disabled; cannot {action}"
        )


def validate_process_step_template(template: JsonObject) -> None:
    validate_step_contract(template)


def update_process_step_template(
    store: SQLiteStore,
    template_id: str,
    body: ProcessStepTemplate,
) -> JsonObject:
    payload = body.payload()
    if payload["id"] != template_id:
        raise ValueError("ProcessStepTemplate.id must match the route id")

    current = require_item(store.get_process_step_template(template_id), template_id)
    normalized_current = ProcessStepTemplate.model_validate(current).payload()
    if _locked_process_step_template(normalized_current) != _locked_process_step_template(payload):
        raise ResourceConflictError(
            "Only status, owner, category, program, inputPorts order, and parameter defaultValue fields can be updated"
        )

    validate_process_step_template(payload)
    updated = copy.deepcopy(current)
    if "status" in body.model_fields_set:
        updated["status"] = payload["status"]
    for field in ("owner", "category", "program"):
        updated[field] = payload[field]
    input_ports_by_id = {port["portId"]: port for port in updated["inputPorts"]}
    updated["inputPorts"] = [input_ports_by_id[port["portId"]] for port in payload["inputPorts"]]
    _apply_parameter_defaults(
        updated.get("parameterDefinitions", []),
        payload.get("parameterDefinitions", []),
    )
    return store.update_process_step_template(updated)


def _apply_parameter_defaults(target_definitions: Any, source_definitions: Any) -> None:
    if not isinstance(target_definitions, list) or not isinstance(source_definitions, list):
        return
    source_by_id = {
        definition.get("id"): definition
        for definition in source_definitions
        if isinstance(definition, Mapping)
    }
    for target in target_definitions:
        if not isinstance(target, dict):
            continue
        source = source_by_id.get(target.get("id"))
        if not isinstance(source, Mapping):
            continue
        if "defaultValue" in source:
            target["defaultValue"] = copy.deepcopy(source["defaultValue"])
        else:
            target.pop("defaultValue", None)
        target_repeat = target.get("repeatDefinition")
        source_repeat = source.get("repeatDefinition")
        if isinstance(target_repeat, Mapping) and isinstance(source_repeat, Mapping):
            _apply_parameter_defaults(
                target_repeat.get("itemParameterDefinitions", []),
                source_repeat.get("itemParameterDefinitions", []),
            )


def load_step_templates_for_definition(store: SQLiteStore, definition: JsonObject) -> list[JsonObject]:
    return [require_item(store.get_process_step_template(id_), id_)
            for id_ in dict.fromkeys(ref["processStepTemplateId"] for ref in definition["stepRefs"])]


def prepare_flow(store: SQLiteStore, body: ProcessFlowCreate, generators: GeometryGeneratorRegistry,
                 *, current: JsonObject | None = None) -> JsonObject:
    payload = body.payload()
    definition, configuration = payload["definition"], payload["configuration"]
    steps = load_step_templates_for_definition(store, definition)
    steps_by_id = {step["id"]: step for step in steps}
    existing_refs = {(ref["stepRefId"], ref["processStepTemplateId"])
                     for ref in (current or {}).get("definition", {}).get("stepRefs", [])}
    for ref in definition["stepRefs"]:
        if (ref["stepRefId"], ref["processStepTemplateId"]) not in existing_refs:
            require_enabled_template(steps_by_id[ref["processStepTemplateId"]], kind="Process step",
                                     action="add a new step reference")
    _compiler(store, generators).validate_authoring(definition, configuration, steps)
    # Resource identity checks never generate geometry or execute recipes at save time.
    for binding in configuration["inputBindings"].values():
        if binding["kind"] == "catalog":
            require_item(store.get_geometry(binding["geometryId"]), binding["geometryId"])
        else:
            try:
                generators.definition(binding["generatorId"], binding["generatorVersion"])
            except KeyError:
                raise ValueError(f"Unknown geometry generator {binding['generatorId']} v{binding['generatorVersion']}") from None
    payload.update(id=current["id"] if current else generated_flow_id(),
                   revision=current["revision"] + 1 if current else 1)
    if current is not None:
        payload.pop("origin", None)
        if "origin" in current:
            payload["origin"] = copy.deepcopy(current["origin"])
    return payload


def create_flow(store: SQLiteStore, body: ProcessFlowCreate, generators: GeometryGeneratorRegistry) -> JsonObject:
    return store.insert_process_flow(prepare_flow(store, body, generators))


def update_flow(store: SQLiteStore, flow_id: str, body: ProcessFlowUpdate,
                generators: GeometryGeneratorRegistry) -> JsonObject:
    current = store._required_flow(flow_id, body.revision)
    return store.update_process_flow(prepare_flow(store, body, generators, current=current), body.revision)


def execute_flow(store: SQLiteStore, flow_id: str, generators: GeometryGeneratorRegistry) -> JsonObject:
    flow = require_item(store.get_process_flow(flow_id), flow_id)
    steps = load_step_templates_for_definition(store, flow["definition"])
    plan = _compiler(store, generators).compile(flow["definition"], flow["configuration"], steps)
    result = GeometryKernel().execute(plan)
    return {"geometryStructure": result.geometry(), "stepOutputs": result.step_outputs(),
            "terminalStepRefIds": result.terminal_step_ref_ids()}


def resolve_preview_request(
    store: SQLiteStore,
    body: GeometryPreviewRequest,
) -> PreviewRequestContext:
    """Resolve database-backed inputs without compiling or executing the flow."""

    flow = body.flow.payload() if body.flow is not None else require_item(store.get_process_flow(body.flowId), body.flowId)
    definition = flow["definition"]
    step_templates = tuple(load_step_templates_for_definition(store, definition))
    configuration = flow["configuration"]
    target = body.target.payload()
    referenced_catalog_geometries: JsonObject = {}
    for binding in configuration.get("inputBindings", {}).values():
        if binding.get("kind") != "catalog":
            continue
        geometry_id = binding.get("geometryId")
        if not isinstance(geometry_id, str) or geometry_id in referenced_catalog_geometries:
            continue
        geometry = store.get_geometry(geometry_id)
        referenced_catalog_geometries[geometry_id] = geometry or {"missingGeometryId": geometry_id}

    return PreviewRequestContext(
        definition=definition,
        step_templates=step_templates,
        configuration=configuration,
        target=target,
        source_label=body.sourceLabel,
        referenced_catalog_geometries=referenced_catalog_geometries,
    )


def preview_request_identity(context: PreviewRequestContext) -> JsonObject:
    """Return all semantic inputs that can affect a preview session."""

    return {
        "contractVersion": 2,
        "target": context.target,
        "sourceLabel": context.source_label,
        "definition": context.definition,
        "stepTemplates": list(context.step_templates),
        "configuration": context.configuration,
        "catalogGeometries": context.referenced_catalog_geometries,
    }


def prepare_preview_execution(
    context: PreviewRequestContext,
    generators: GeometryGeneratorRegistry,
) -> PreparedPreviewExecution:
    """Compile at most once against resources captured by the request context."""

    catalog_geometries = [
        geometry
        for geometry in context.referenced_catalog_geometries.values()
        if isinstance(geometry, dict) and isinstance(geometry.get("id"), str)
    ]
    compiler = FlowCompiler(InMemoryGeometryCatalog(catalog_geometries), generators)
    target = context.target
    if target["type"] == "flowInput":
        geometry_structure = compiler.resolve_flow_input(
            context.definition,
            context.configuration,
            context.step_templates,
            target["flowInputId"],
        )
        return PreparedPreviewExecution(
            context=context,
            flow_input_geometry=dict(geometry_structure),
        )

    if target.get("outputPortId") != "result_geometry":
        raise ValueError(
            "Preview currently supports only the result_geometry step output port"
        )
    output_step_ref_id = target["stepRefId"]
    plan = compiler.compile(
        context.definition,
        context.configuration,
        context.step_templates,
        output_step_ref_id=output_step_ref_id,
    )
    return PreparedPreviewExecution(context=context, execution_plan=plan)


async def materialize_preview_snapshots(
    prepared: PreparedPreviewExecution,
) -> tuple[PreviewSnapshotGeometry, ...]:
    """Execute one plan once and expose every ordered upstream step output."""

    context = prepared.context
    target = context.target
    if target["type"] == "flowInput":
        geometry_structure = prepared.flow_input_geometry
        if geometry_structure is None:
            raise RuntimeError("Resolved flow-input preview is missing geometry")
        flow_input_id = target["flowInputId"]
        flow_input = next(
            (
                candidate
                for candidate in context.definition.get("flowInputs", [])
                if candidate.get("flowInputId") == flow_input_id
            ),
            None,
        )
        label = context.source_label or (flow_input or {}).get("name") or flow_input_id
        return (
            PreviewSnapshotGeometry(
                source_kind="flowInput",
                step_ref_id=None,
                label=label,
                order=0,
                target=target,
                geometry_structure=geometry_structure,
            ),
        )

    plan = prepared.execution_plan
    if plan is None:
        raise RuntimeError("Step-output preview is missing its execution plan")
    output_step_ref_id = target["stepRefId"]
    result = await asyncio.to_thread(
        _execute_preview_plan,
        plan,
        output_step_ref_id,
    )
    step_outputs = result.step_outputs()
    snapshots = []
    for order, planned_step in enumerate(plan.steps):
        geometry_structure = step_outputs.get(planned_step.step_ref_id)
        if geometry_structure is None:
            raise RuntimeError(
                f"Preview execution did not return output for step {planned_step.step_ref_id}"
            )
        label = planned_step.step_label
        if planned_step.step_ref_id == output_step_ref_id and context.source_label:
            label = context.source_label
        snapshots.append(
            PreviewSnapshotGeometry(
                source_kind="stepOutput",
                step_ref_id=planned_step.step_ref_id,
                label=label or planned_step.step_ref_id,
                order=order,
                target={
                    "type": "stepOutput",
                    "stepRefId": planned_step.step_ref_id,
                    "outputPortId": planned_step.output_port_id,
                },
                geometry_structure=geometry_structure,
            )
        )
    if not snapshots or snapshots[-1].step_ref_id != output_step_ref_id:
        raise RuntimeError(f"Preview execution did not reach target step {output_step_ref_id}")
    return tuple(snapshots)


async def preview_geometry(
    store: SQLiteStore,
    body: GeometryPreviewRequest,
    generators: GeometryGeneratorRegistry,
) -> JsonObject:
    context = resolve_preview_request(store, body)
    prepared = await asyncio.to_thread(prepare_preview_execution, context, generators)
    snapshots = await materialize_preview_snapshots(prepared)
    selected = snapshots[-1]
    geometry_structure = selected.geometry_structure

    glb_bytes = await export_geometry(geometry_structure, format="glb")
    geometry_entity_json = build_geometry_entity_download(
        geometry_structure=geometry_structure,
        target=selected.target,
        source_kind=selected.source_kind,
        output_step_ref_id=selected.step_ref_id,
        source_label=body.sourceLabel,
    )
    return {
        "geometryEntityJson": geometry_entity_json,
        "glbBase64": base64.b64encode(glb_bytes).decode("ascii"),
    }


async def preview_step_geometry(body: GeometryPreviewStepRequest) -> JsonObject:
    step_bytes = await export_geometry(body.geometryStructure, format="step")
    return {"stepBase64": base64.b64encode(step_bytes).decode("ascii")}


def build_geometry_entity_download(
    *,
    geometry_structure: JsonObject,
    target: JsonObject,
    source_kind: str,
    output_step_ref_id: str | None,
    source_label: str | None,
) -> JsonObject:
    preview_id = (
        target.get("flowInputId")
        if target.get("type") == "flowInput"
        else f"step-output-{target.get('stepRefId')}"
    )
    label = source_label or output_step_ref_id or preview_id
    return {
        "id": None,
        "category": "preview.generated",
        "entityType": "preview",
        "name": f"Preview - {label}",
        "dim": "",
        "owner": None,
        "description": f"Generated geometry preview for {preview_id}; source kind {source_kind}.",
        "structureFormat": "standard",
        "structure": geometry_structure,
    }


def _compiler(store: SQLiteStore, generators: GeometryGeneratorRegistry) -> FlowCompiler:
    return FlowCompiler(StoreGeometryCatalog(store), generators)


def _execute_preview_plan(plan: ExecutionPlan, output_step_ref_id: str):
    return GeometryKernel().execute(
        plan,
        ExecuteOptions(output_step_ref_id=output_step_ref_id),
    )
