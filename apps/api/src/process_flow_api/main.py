from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .file_export_jobs import FileExportJobManager
from .identifiers import generated_geometry_id
from .models import (
    CdbFileExportCreateRequest,
    ExecuteInstanceResponse,
    FileExportCancelRequest,
    FileExportCreateRequest,
    FileExportJobListResponse,
    FileExportJobResponse,
    GeometryEntity,
    GeometryPreviewRequest,
    GeometryPreviewResponse,
    GeometryPreviewStepRequest,
    GeometryPreviewStepResponse,
    ProcessFlowInstance,
    ProcessFlowTemplate,
    ProcessFlowWorkspaceCreate,
    ProcessFlowWorkspaceUpdate,
    ProcessStepTemplate,
    TemplateInstanceCreateRequest,
    WorkspaceCommitRequest,
)
from .repository import DuplicateItemError, NotFoundError, ResourceConflictError, SQLiteStore
from .seed import load_seed_fixtures
from .services import (
    bootstrap_payload,
    create_flow_instance,
    create_flow_template,
    create_template_instance,
    execute_instance,
    preview_geometry,
    preview_step_geometry,
    require_item,
    validate_process_step_template,
)
from .workspace_service import commit_workspace, create_workspace, update_workspace


def create_app(*, db_path: str | Path | None = None) -> FastAPI:
    app = FastAPI(title="Process Flow API", version="0.2.0", lifespan=app_lifespan)
    app.state.store = SQLiteStore(db_path or default_db_path())
    app.state.file_export_jobs = FileExportJobManager()

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

    @app.exception_handler(ResourceConflictError)
    async def resource_conflict_handler(_: Request, error: ResourceConflictError):
        return JSONResponse({"message": str(error)}, status_code=status.HTTP_409_CONFLICT)

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

    @app.post("/api/reset")
    async def reset(request: Request):
        store = get_store(request)
        store.seed(load_seed_fixtures(), reset=True)
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

    @app.post("/api/process-flow-templates", status_code=status.HTTP_201_CREATED)
    async def create_process_flow_template(request: Request, body: ProcessFlowTemplate):
        return create_flow_template(get_store(request), body)

    @app.post("/api/process-flow-template-instances", status_code=status.HTTP_201_CREATED)
    async def create_process_flow_template_instance(request: Request, body: TemplateInstanceCreateRequest):
        return create_template_instance(get_store(request), body)

    @app.get("/api/process-flow-instances")
    async def list_process_flow_instances(request: Request):
        return get_store(request).list_process_flow_instances()

    @app.get("/api/process-flow-instances/{instance_id}")
    async def get_process_flow_instance(request: Request, instance_id: str):
        return require_item(get_store(request).get_process_flow_instance(instance_id), instance_id)

    @app.post("/api/process-flow-instances", status_code=status.HTTP_201_CREATED)
    async def create_process_flow_instance(request: Request, body: ProcessFlowInstance):
        return create_flow_instance(get_store(request), body)

    @app.post("/api/process-flow-instances/{instance_id}/execute", response_model=ExecuteInstanceResponse)
    async def execute_process_flow_instance(request: Request, instance_id: str):
        return execute_instance(get_store(request), instance_id)

    @app.get("/api/process-flow-workspaces")
    async def list_process_flow_workspaces(request: Request):
        return get_store(request).list_process_flow_workspaces()

    @app.get("/api/process-flow-workspaces/{workspace_id}")
    async def get_process_flow_workspace(request: Request, workspace_id: str):
        return require_item(get_store(request).get_process_flow_workspace(workspace_id), workspace_id)

    @app.post("/api/process-flow-workspaces", status_code=status.HTTP_201_CREATED)
    async def create_process_flow_workspace(request: Request, body: ProcessFlowWorkspaceCreate):
        return create_workspace(get_store(request), body)

    @app.put("/api/process-flow-workspaces/{workspace_id}")
    async def update_process_flow_workspace(
        request: Request,
        workspace_id: str,
        body: ProcessFlowWorkspaceUpdate,
    ):
        return update_workspace(get_store(request), workspace_id, body)

    @app.post("/api/process-flow-workspaces/{workspace_id}/commit")
    async def commit_process_flow_workspace(
        request: Request,
        workspace_id: str,
        body: WorkspaceCommitRequest,
    ):
        return commit_workspace(get_store(request), workspace_id, body)

    @app.post("/api/geometry-preview", response_model=GeometryPreviewResponse)
    async def geometry_preview(request: Request, body: GeometryPreviewRequest):
        return await preview_geometry(get_store(request), body)

    @app.post("/api/geometry-preview/step", response_model=GeometryPreviewStepResponse)
    async def geometry_preview_step(body: GeometryPreviewStepRequest):
        return await preview_step_geometry(body)

    @app.post("/api/geometry-preview/cdb-jobs", response_model=FileExportJobResponse)
    async def create_geometry_preview_cdb_file_export(body: CdbFileExportCreateRequest):
        job = await app.state.file_export_jobs.create_cdb_file_export(
            client_id=body.clientId,
            geometry_structure=body.geometryStructure,
            element_size=body.elementSize,
            output_path=body.outputPath,
            source_label=body.sourceLabel,
        )
        return {"job": job}

    @app.post("/api/geometry-preview/export-jobs", response_model=FileExportJobResponse)
    async def create_geometry_preview_file_export(body: FileExportCreateRequest):
        job = await app.state.file_export_jobs.create_file_export_job(
            client_id=body.clientId,
            kind=body.kind,
            output_path=body.outputPath,
            source_label=body.sourceLabel,
            geometry_structure=body.geometryStructure,
            geometry_entity_json=body.geometryEntityJson,
            element_size=body.elementSize,
        )
        return {"job": job}

    @app.get("/api/export-jobs", response_model=FileExportJobListResponse)
    async def list_file_export_jobs(clientId: str):
        jobs = await app.state.file_export_jobs.list_jobs(client_id=clientId)
        return {"jobs": jobs}

    @app.get("/api/export-jobs/{job_id}", response_model=FileExportJobResponse)
    async def get_file_export_job(job_id: str, clientId: str):
        job = await app.state.file_export_jobs.get_job(job_id=job_id, client_id=clientId)
        if job is None:
            raise NotFoundError(job_id)
        return {"job": job}

    @app.post("/api/export-jobs/{job_id}/cancel", response_model=FileExportJobResponse)
    async def cancel_file_export_job(job_id: str, body: FileExportCancelRequest):
        job = await app.state.file_export_jobs.cancel_job(job_id=job_id, client_id=body.clientId)
        if job is None:
            raise NotFoundError(job_id)
        return {"job": job}

    return app


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    app.state.store.seed(load_seed_fixtures(), reset=False)
    try:
        yield
    finally:
        await app.state.file_export_jobs.shutdown()


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


app = create_app()
