from __future__ import annotations

import base64
from typing import Any

from process_flow_kernel import (
    ExecuteOptions,
    FlowCompiler,
    GeometryKernel,
    validate_flow_graph,
    validate_process_step_template as validate_step_contract,
)

from .geometry_preview_exporter import export_geometry
from .geometry_resolver import StoreGeometryCatalog
from .models import (
    GeometryPreviewRequest,
    GeometryPreviewStepRequest,
    ProcessFlowInstance,
    ProcessFlowTemplate,
    TemplateInstanceCreateRequest,
)
from .repository import NotFoundError, SQLiteStore


JsonObject = dict[str, Any]


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
    created_template, created_instance = store.insert_template_and_instance(template, instance)
    return {
        "processFlowTemplate": created_template,
        "processFlowInstance": created_instance,
    }


def create_flow_instance(
    store: SQLiteStore,
    body: ProcessFlowInstance,
) -> JsonObject:
    payload = body.payload()
    template = require_item(
        store.get_process_flow_template(payload["processFlowTemplateId"]),
        payload["processFlowTemplateId"],
    )
    step_templates = load_step_templates_for_template(store, template)
    _compiler(store).compile(template, payload, step_templates)
    return store.insert_process_flow_instance(payload)


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


async def preview_geometry(
    store: SQLiteStore,
    body: GeometryPreviewRequest,
) -> JsonObject:
    template = (
        body.flowTemplate.payload()
        if body.flowTemplate is not None
        else require_item(
            store.get_process_flow_template(body.processFlowTemplateId),
            body.processFlowTemplateId,
        )
    )
    step_templates = load_step_templates_for_template(store, template)
    configuration = body.configuration.payload()
    target = body.target.payload()
    compiler = _compiler(store)

    if target["type"] == "flowInput":
        geometry_structure = compiler.resolve_flow_input(
            template,
            configuration,
            step_templates,
            target["flowInputId"],
        )
        source_kind = "flowInput"
        output_step_ref_id = None
    else:
        output_step_ref_id = target["stepRefId"]
        plan = compiler.compile(
            template,
            configuration,
            step_templates,
            output_step_ref_id=output_step_ref_id,
        )
        result = GeometryKernel().execute(
            plan,
            ExecuteOptions(output_step_ref_id=output_step_ref_id),
        )
        geometry_structure = result.geometry()
        source_kind = "stepOutput"

    glb_bytes = await export_geometry(geometry_structure, format="glb")
    geometry_entity_json = build_geometry_entity_download(
        geometry_structure=geometry_structure,
        target=target,
        source_kind=source_kind,
        output_step_ref_id=output_step_ref_id,
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
