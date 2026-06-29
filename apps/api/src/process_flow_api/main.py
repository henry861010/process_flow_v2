from __future__ import annotations

import base64
import os
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from process_flow_kernel import GeometryKernel, InMemoryRepository, validate_flow_graph

from .exporter import export_geometry
from .models import (
    ExecuteInstanceResponse,
    GeometryEntity,
    GeometryPreviewRequest,
    GeometryPreviewResponse,
    GeometryPreviewStepRequest,
    GeometryPreviewStepResponse,
    ProcessFlowInstance,
    ProcessFlowTemplate,
    ProcessStepTemplate,
    SeedRequest,
    TemplateInstanceCreateRequest,
)
from .repository import DuplicateItemError, KernelRepository, NotFoundError, SQLiteStore
from .seed import load_seed_fixtures

JsonObject = dict[str, Any]


def create_app(*, db_path: str | Path | None = None) -> FastAPI:
    app = FastAPI(title="Process Flow API", version="0.1.0")
    app.state.store = SQLiteStore(db_path or default_db_path())

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(DuplicateItemError)
    async def duplicate_handler(_: Request, error: DuplicateItemError):
        return JSONResponse({"message": str(error)}, status_code=status.HTTP_409_CONFLICT)

    @app.exception_handler(NotFoundError)
    async def not_found_handler(_: Request, error: NotFoundError):
        return JSONResponse({"message": f"Not found: {error.args[0]}"}, status_code=status.HTTP_404_NOT_FOUND)

    @app.exception_handler(ValueError)
    async def value_error_handler(_: Request, error: ValueError):
        return JSONResponse({"message": str(error)}, status_code=status.HTTP_400_BAD_REQUEST)

    @app.get("/api/health")
    async def health():
        return {"status": "ok"}

    @app.get("/api/bootstrap")
    async def bootstrap(request: Request):
        store = get_store(request)
        return bootstrap_payload(store)

    @app.post("/api/admin/seed")
    async def seed(request: Request, body: SeedRequest):
        store = get_store(request)
        store.seed(load_seed_fixtures(), reset=body.mode == "reset")
        return bootstrap_payload(store)

    @app.get("/api/process-step-templates")
    async def list_process_step_templates(
        request: Request,
        search: str | None = None,
        category: str | None = None,
    ):
        return get_store(request).list_process_step_templates(search=search, category=category)

    @app.get("/api/process-step-templates/{template_id}")
    async def get_process_step_template(request: Request, template_id: str):
        return require_item(get_store(request).get_process_step_template(template_id), template_id)

    @app.post("/api/process-step-templates", status_code=status.HTTP_201_CREATED)
    async def create_process_step_template(request: Request, body: ProcessStepTemplate):
        payload = body.payload()
        validate_process_step_template(payload)
        return get_store(request).insert_process_step_template(payload)

    @app.delete("/api/process-step-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_process_step_template(request: Request, template_id: str):
        get_store(request).delete_process_step_template(template_id)
        return None

    @app.get("/api/geometries")
    async def list_geometries(
        request: Request,
        search: str | None = None,
        category: str | None = None,
        entityType: str | None = None,
    ):
        return get_store(request).list_geometries(
            search=search,
            category=category,
            entity_type=entityType,
        )

    @app.get("/api/geometries/{geometry_id}")
    async def get_geometry(request: Request, geometry_id: str):
        return require_item(get_store(request).get_geometry(geometry_id), geometry_id)

    @app.post("/api/geometries", status_code=status.HTTP_201_CREATED)
    async def create_geometry(request: Request, body: GeometryEntity):
        payload = body.payload()
        if payload.get("id") in (None, ""):
            payload["id"] = generated_geometry_id(payload)
        return get_store(request).insert_geometry(payload)

    @app.get("/api/process-flow-templates")
    async def list_process_flow_templates(request: Request):
        return get_store(request).list_process_flow_templates()

    @app.get("/api/process-flow-templates/{template_id}")
    async def get_process_flow_template(request: Request, template_id: str):
        return require_item(get_store(request).get_process_flow_template(template_id), template_id)

    @app.post("/api/process-flow-template-instances", status_code=status.HTTP_201_CREATED)
    async def create_process_flow_template_instance(request: Request, body: TemplateInstanceCreateRequest):
        store = get_store(request)
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

    @app.get("/api/process-flow-instances")
    async def list_process_flow_instances(request: Request):
        return get_store(request).list_process_flow_instances()

    @app.get("/api/process-flow-instances/{instance_id}")
    async def get_process_flow_instance(request: Request, instance_id: str):
        return require_item(get_store(request).get_process_flow_instance(instance_id), instance_id)

    @app.post("/api/process-flow-instances", status_code=status.HTTP_201_CREATED)
    async def create_process_flow_instance(request: Request, body: ProcessFlowInstance):
        store = get_store(request)
        payload = body.payload()
        template = require_item(
            store.get_process_flow_template(payload["processFlowTemplateId"]),
            payload["processFlowTemplateId"],
        )
        step_templates = load_step_templates_for_template(store, template)
        validate_flow_graph(template, payload, step_templates)
        return store.insert_process_flow_instance(payload)

    @app.post("/api/process-flow-instances/{instance_id}/execute", response_model=ExecuteInstanceResponse)
    async def execute_process_flow_instance(request: Request, instance_id: str):
        store = get_store(request)
        require_item(store.get_process_flow_instance(instance_id), instance_id)
        kernel = kernel_for_store(store)
        result = kernel.execute(instance_id)
        return {
            "geometryStructure": result.geometry(),
            "stepOutputs": result.step_outputs(),
            "terminalStepRefIds": result.terminal_step_ref_ids(),
        }

    @app.post("/api/geometry-preview", response_model=GeometryPreviewResponse)
    async def geometry_preview(request: Request, body: GeometryPreviewRequest):
        store = get_store(request)
        kernel = kernel_for_preview_request(store, body)
        flow_template = body.flowTemplate.payload()
        draft_instance = body.draftInstance.payload()
        validate_preview_request(store, body)
        preview = kernel.execute_preview(
            {
                "processFlowTemplate": flow_template,
                "processFlowInstance": draft_instance,
                "target": body.target.payload(),
            }
        )
        geometry_structure = preview["geometryStructure"]
        glb_bytes = await export_geometry(geometry_structure, format="glb")
        geometry_entity_json = build_geometry_entity_download(
            geometry_structure=geometry_structure,
            target=body.target.payload(),
            source_kind=preview["sourceKind"],
            output_step_ref_id=preview["outputStepRefId"],
            source_label=body.sourceLabel,
        )
        return {
            "geometryEntityJson": geometry_entity_json,
            "glbBase64": base64.b64encode(glb_bytes).decode("ascii"),
        }

    @app.post("/api/geometry-preview/step", response_model=GeometryPreviewStepResponse)
    async def geometry_preview_step(body: GeometryPreviewStepRequest):
        step_bytes = await export_geometry(body.geometryStructure, format="step")
        return {"stepBase64": base64.b64encode(step_bytes).decode("ascii")}

    return app


def default_db_path() -> Path:
    env_path = os.environ.get("PROCESS_FLOW_API_DB_PATH")
    if env_path:
        return Path(env_path)
    return Path(__file__).resolve().parents[2] / ".data" / "process-flow.sqlite3"


def cors_origins() -> list[str]:
    configured = os.environ.get("PROCESS_FLOW_API_CORS_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]


def get_store(request: Request) -> SQLiteStore:
    return request.app.state.store


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
    if not any(
        field.get("id") == "main_geometry" and field.get("valueType") in ("geometryRef", "geometry")
        for field in fields
    ):
        raise ValueError("Process step template must include a main_geometry geometry field")


def load_step_templates_for_template(store: SQLiteStore, template: JsonObject) -> list[JsonObject]:
    result = []
    seen = set()
    for step_ref in template.get("stepRefs", []):
        template_id = step_ref.get("processStepTemplateId")
        if template_id in seen:
            continue
        seen.add(template_id)
        result.append(require_item(store.get_process_step_template(template_id), template_id))
    return result


def kernel_for_store(store: SQLiteStore) -> GeometryKernel:
    return GeometryKernel(
        geometry_repository=KernelRepository(store, "geometry"),
        process_step_repository=KernelRepository(store, "process_step"),
        process_flow_template_repository=KernelRepository(store, "process_flow_template"),
        process_flow_instance_repository=KernelRepository(store, "process_flow_instance"),
    )


def kernel_for_preview_request(store: SQLiteStore, body: GeometryPreviewRequest) -> GeometryKernel:
    if body.geometries is not None:
        geometry_repository = InMemoryRepository([geometry.payload() for geometry in body.geometries])
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
    if target["type"] == "edge":
        edge = next(
            (candidate for candidate in flow_template.get("flowEdges", []) if candidate.get("edgeId") == target["previewEdgeId"]),
            None,
        )
        if edge is None:
            raise ValueError(f"Preview edge not found: {target['previewEdgeId']}")
        if edge.get("source", {}).get("sourceType") == "geometryRef":
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
            return


def find_field_value(step_value_sets: list[JsonObject], step_ref_id: str, field_id: str) -> Any:
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
    preview_id = target.get("previewEdgeId") if target.get("type") == "edge" else f"step-output-{target.get('stepRefId')}"
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


def generated_geometry_id(payload: JsonObject) -> str:
    base = slug(payload.get("name") or payload.get("entityType") or "geometry")
    return f"geom_{base}_{uuid.uuid4().hex[:12]}"


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", str(value).lower()).strip("_")
    return normalized or "geometry"


app = create_app()
