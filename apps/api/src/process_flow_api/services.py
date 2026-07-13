from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from typing import Any

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
from .configuration_materialization import materialize_embedded_bindings
from .models import (
    GeometryPreviewRequest,
    GeometryPreviewStepRequest,
    ProcessFlowInstanceCreate,
    ProcessFlowTemplate,
    TemplateInstanceCreateRequest,
)
from .repository import NotFoundError, SQLiteStore


JsonObject = dict[str, Any]


@dataclass(frozen=True, slots=True)
class PreviewRequestContext:
    """Fully resolved, immutable input used to address and build a preview session."""

    template: JsonObject
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
        "processFlowTemplates": store.list_process_flow_templates(),
        "processFlowInstances": store.list_process_flow_instances(),
        "geometries": store.list_geometries(),
    }


def require_item(item: JsonObject | None, id_: str) -> JsonObject:
    if item is None:
        raise NotFoundError(id_)
    return item


def validate_process_step_template(template: JsonObject) -> None:
    validate_step_contract(template)


def create_flow_template(store: SQLiteStore, body: ProcessFlowTemplate) -> JsonObject:
    payload = body.payload()
    step_templates = load_step_templates_for_template(store, payload)
    validate_flow_graph(payload, step_templates)
    return store.insert_process_flow_template(payload)


def load_step_templates_for_template(
    store: SQLiteStore,
    template: JsonObject,
) -> list[JsonObject]:
    result = []
    seen = set()
    for step_ref in template.get("stepRefs", []):
        template_id = step_ref.get("processStepTemplateId")
        if template_id in seen:
            continue
        seen.add(template_id)
        result.append(require_item(store.get_process_step_template(template_id), template_id))
    return result


def create_template_instance(
    store: SQLiteStore,
    body: TemplateInstanceCreateRequest,
) -> JsonObject:
    template = body.processFlowTemplate.payload()
    instance = body.processFlowInstance.payload()
    if instance.get("processFlowTemplateId") != template.get("id"):
        raise ValueError("ProcessFlowInstance.processFlowTemplateId must match ProcessFlowTemplate.id")
    step_templates = load_step_templates_for_template(store, template)
    validate_flow_graph(template, step_templates)
    _compiler(store).compile(template, instance, step_templates)
    geometries, catalog_bindings = materialize_embedded_bindings(instance)
    persisted_instance = _persisted_instance(instance, catalog_bindings)
    created_template, created_instance = store.insert_template_and_instance(
        template,
        persisted_instance,
        geometries=geometries,
    )
    return {
        "processFlowTemplate": created_template,
        "processFlowInstance": created_instance,
    }


def create_flow_instance(
    store: SQLiteStore,
    body: ProcessFlowInstanceCreate,
) -> JsonObject:
    payload = body.payload()
    template = require_item(
        store.get_process_flow_template(payload["processFlowTemplateId"]),
        payload["processFlowTemplateId"],
    )
    step_templates = load_step_templates_for_template(store, template)
    _compiler(store).compile(template, payload, step_templates)
    geometries, catalog_bindings = materialize_embedded_bindings(payload)
    instance = _persisted_instance(payload, catalog_bindings)
    return store.insert_instance_with_geometries(instance, geometries=geometries)


def _persisted_instance(
    create_payload: JsonObject,
    catalog_bindings: dict[str, JsonObject],
) -> JsonObject:
    return {
        "schemaVersion": 2,
        "id": create_payload["id"],
        "name": create_payload["name"],
        "processFlowTemplateId": create_payload["processFlowTemplateId"],
        "inputBindings": catalog_bindings,
        "stepConfigurations": create_payload.get("stepConfigurations", {}),
    }


def execute_instance(store: SQLiteStore, instance_id: str) -> JsonObject:
    instance = require_item(store.get_process_flow_instance(instance_id), instance_id)
    template = require_item(
        store.get_process_flow_template(instance["processFlowTemplateId"]),
        instance["processFlowTemplateId"],
    )
    step_templates = load_step_templates_for_template(store, template)
    plan = _compiler(store).compile(template, instance, step_templates)
    result = GeometryKernel().execute(plan)
    return {
        "geometryStructure": result.geometry(),
        "stepOutputs": result.step_outputs(),
        "terminalStepRefIds": result.terminal_step_ref_ids(),
    }


def resolve_preview_request(
    store: SQLiteStore,
    body: GeometryPreviewRequest,
) -> PreviewRequestContext:
    """Resolve database-backed inputs without compiling or executing the flow."""

    template = (
        body.flowTemplate.payload()
        if body.flowTemplate is not None
        else require_item(
            store.get_process_flow_template(body.processFlowTemplateId),
            body.processFlowTemplateId,
        )
    )
    step_templates = tuple(load_step_templates_for_template(store, template))
    configuration = body.configuration.payload()
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
        template=template,
        step_templates=step_templates,
        configuration=configuration,
        target=target,
        source_label=body.sourceLabel,
        referenced_catalog_geometries=referenced_catalog_geometries,
    )


def preview_request_identity(context: PreviewRequestContext) -> JsonObject:
    """Return all semantic inputs that can affect a preview session."""

    return {
        "contractVersion": 1,
        "target": context.target,
        "sourceLabel": context.source_label,
        "flowTemplate": context.template,
        "stepTemplates": list(context.step_templates),
        "configuration": context.configuration,
        "catalogGeometries": context.referenced_catalog_geometries,
    }


def prepare_preview_execution(
    context: PreviewRequestContext,
) -> PreparedPreviewExecution:
    """Compile at most once against resources captured by the request context."""

    catalog_geometries = [
        geometry
        for geometry in context.referenced_catalog_geometries.values()
        if isinstance(geometry, dict) and isinstance(geometry.get("id"), str)
    ]
    compiler = FlowCompiler(InMemoryGeometryCatalog(catalog_geometries))
    target = context.target
    if target["type"] == "flowInput":
        geometry_structure = compiler.resolve_flow_input(
            context.template,
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
        context.template,
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
                for candidate in context.template.get("flowInputs", [])
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
) -> JsonObject:
    context = resolve_preview_request(store, body)
    prepared = await asyncio.to_thread(prepare_preview_execution, context)
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
        "version": None,
        "owner": None,
        "description": f"Generated geometry preview for {preview_id}; source kind {source_kind}.",
        "structureFormat": "standard",
        "structure": geometry_structure,
    }


def _compiler(store: SQLiteStore) -> FlowCompiler:
    return FlowCompiler(StoreGeometryCatalog(store))


def _execute_preview_plan(plan: ExecutionPlan, output_step_ref_id: str):
    return GeometryKernel().execute(
        plan,
        ExecuteOptions(output_step_ref_id=output_step_ref_id),
    )
