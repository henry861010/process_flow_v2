from __future__ import annotations

import base64
from typing import Any

from process_flow_kernel import GeometryKernel, InMemoryRepository, validate_flow_graph

from .geometry_preview_exporter import export_geometry
from .models import (
    GeometryPreviewRequest,
    GeometryPreviewStepRequest,
    ProcessFlowInstance,
    TemplateInstanceCreateRequest,
)
from .repository import KernelRepository, NotFoundError, SQLiteStore

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
    fields = template.get("fieldDefinitions", [])
    fields_to_check = list(fields)
    while fields_to_check:
        field = fields_to_check.pop()
        if field.get("valueType") == "geometry":
            raise ValueError(
                f"Field {field.get('id')} uses legacy valueType geometry; use geometryRef"
            )
        repeat_definition = field.get("repeatDefinition")
        if isinstance(repeat_definition, dict):
            fields_to_check.extend(repeat_definition.get("itemFieldDefinitions", []))

    if not any(
        field.get("id") == "main_geometry"
        and field.get("valueType") == "geometryRef"
        for field in fields
    ):
        raise ValueError("Process step template must include a main_geometry geometryRef field")


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
    validate_flow_graph(template, instance, step_templates)
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
    validate_flow_graph(template, payload, step_templates)
    return store.insert_process_flow_instance(payload)


def execute_instance(store: SQLiteStore, instance_id: str) -> JsonObject:
    require_item(store.get_process_flow_instance(instance_id), instance_id)
    result = kernel_for_store(store).execute(instance_id)
    return {
        "geometryStructure": result.geometry(),
        "stepOutputs": result.step_outputs(),
        "terminalStepRefIds": result.terminal_step_ref_ids(),
    }


async def preview_geometry(
    store: SQLiteStore,
    body: GeometryPreviewRequest,
) -> JsonObject:
    kernel = kernel_for_preview_request(store, body)
    flow_template = body.flowTemplate.payload()
    draft_instance = body.draftInstance.payload()
    target = body.target.payload()

    validate_preview_request(store, body)
    preview = kernel.execute_preview(
        {
            "processFlowTemplate": flow_template,
            "processFlowInstance": draft_instance,
            "target": target,
        }
    )
    geometry_structure = preview["geometryStructure"]
    glb_bytes = await export_geometry(geometry_structure, format="glb")
    geometry_entity_json = build_geometry_entity_download(
        geometry_structure=geometry_structure,
        target=target,
        source_kind=preview["sourceKind"],
        output_step_ref_id=preview["outputStepRefId"],
        source_label=body.sourceLabel,
    )
    return {
        "geometryEntityJson": geometry_entity_json,
        "glbBase64": base64.b64encode(glb_bytes).decode("ascii"),
    }


async def preview_step_geometry(body: GeometryPreviewStepRequest) -> JsonObject:
    step_bytes = await export_geometry(body.geometryStructure, format="step")
    return {"stepBase64": base64.b64encode(step_bytes).decode("ascii")}


def kernel_for_store(store: SQLiteStore) -> GeometryKernel:
    return GeometryKernel(
        geometry_repository=KernelRepository(store, "geometry"),
        process_step_repository=KernelRepository(store, "process_step"),
        process_flow_template_repository=KernelRepository(store, "process_flow_template"),
        process_flow_instance_repository=KernelRepository(store, "process_flow_instance"),
    )


def kernel_for_preview_request(
    store: SQLiteStore,
    body: GeometryPreviewRequest,
) -> GeometryKernel:
    if body.geometries is not None:
        geometry_repository = InMemoryRepository(
            [geometry.payload() for geometry in body.geometries]
        )
    else:
        geometry_repository = KernelRepository(store, "geometry")
    if body.processStepTemplates is not None:
        process_step_repository = InMemoryRepository(
            [template.payload() for template in body.processStepTemplates]
        )
    else:
        process_step_repository = KernelRepository(store, "process_step")
    return GeometryKernel(
        geometry_repository=geometry_repository,
        process_step_repository=process_step_repository,
        process_flow_template_repository=InMemoryRepository([body.flowTemplate.payload()]),
        process_flow_instance_repository=InMemoryRepository([body.draftInstance.payload()]),
    )


def validate_preview_request(store: SQLiteStore, body: GeometryPreviewRequest) -> None:
    target = body.target.payload()
    flow_template = body.flowTemplate.payload()
    draft_instance = body.draftInstance.payload()
    if target["type"] != "edge":
        return

    edge = next(
        (
            candidate
            for candidate in flow_template.get("flowEdges", [])
            if candidate.get("edgeId") == target["previewEdgeId"]
        ),
        None,
    )
    if edge is None:
        raise ValueError(f"Preview edge not found: {target['previewEdgeId']}")
    if edge.get("source", {}).get("sourceType") != "geometryRef":
        return

    value = find_field_value(
        draft_instance.get("stepValueSets", []),
        edge.get("target", {}).get("stepRefId"),
        edge.get("target", {}).get("targetFieldId"),
    )
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError("Select initial geometry before previewing this edge.")
    if body.geometries is None and store.get_geometry(value) is None:
        raise ValueError(f"Selected geometry not found: {value}")
    if body.geometries is not None and not any(geometry.id == value for geometry in body.geometries):
        raise ValueError(f"Selected geometry not found: {value}")


def find_field_value(
    step_value_sets: list[JsonObject],
    step_ref_id: str | None,
    field_id: str | None,
) -> Any:
    for value_set in step_value_sets:
        if value_set.get("stepRefId") != step_ref_id:
            continue
        for field_value in value_set.get("fieldValues", []):
            if field_value.get("fieldId") == field_id:
                return field_value.get("value")
    return None


def build_geometry_entity_download(
    *,
    geometry_structure: JsonObject,
    target: JsonObject,
    source_kind: str,
    output_step_ref_id: str | None,
    source_label: str | None,
) -> JsonObject:
    preview_id = (
        target.get("previewEdgeId")
        if target.get("type") == "edge"
        else f"step-output-{target.get('stepRefId')}"
    )
    label = source_label or output_step_ref_id or preview_id
    name = f"Preview - {label}" if str(label).lower().endswith("output") else f"Preview - {label} output"
    return {
        "id": None,
        "category": "preview.generated",
        "entityType": "preview",
        "name": name,
        "version": None,
        "owner": None,
        "description": f"Generated geometry preview for {preview_id}; source kind {source_kind}.",
        "structureFormat": "standard",
        "structure": geometry_structure,
    }
