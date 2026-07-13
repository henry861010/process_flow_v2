from __future__ import annotations

from typing import Any

from process_flow_kernel import FlowCompiler

from .geometry_resolver import StoreGeometryCatalog
from .configuration_materialization import materialize_embedded_bindings
from .identifiers import generated_workspace_id
from .models import (
    ProcessFlowWorkspaceCreate,
    ProcessFlowWorkspaceUpdate,
    WorkspaceCommitRequest,
)
from .repository import NotFoundError, SQLiteStore, WorkspaceConflictError, utc_now


JsonObject = dict[str, Any]


def create_workspace(store: SQLiteStore, body: ProcessFlowWorkspaceCreate) -> JsonObject:
    configuration = body.payload()
    template = _required_template(store, body.processFlowTemplateId)
    step_templates = _step_templates(store, template)
    _compiler(store).validate_configuration(
        template,
        configuration,
        step_templates,
        require_complete=False,
    )
    now = utc_now()
    payload = {
        "schemaVersion": 2,
        "id": generated_workspace_id(),
        "name": body.name,
        "processFlowTemplateId": body.processFlowTemplateId,
        "revision": 1,
        "status": "draft",
        "createdAt": now,
        "updatedAt": now,
        "inputBindings": configuration.get("inputBindings", {}),
        "stepConfigurations": configuration.get("stepConfigurations", {}),
        "embeddedGeometries": configuration.get("embeddedGeometries", {}),
    }
    return store.insert_process_flow_workspace(payload)


def update_workspace(
    store: SQLiteStore,
    workspace_id: str,
    body: ProcessFlowWorkspaceUpdate,
) -> JsonObject:
    current = _required_workspace(store, workspace_id)
    if current.get("status") != "draft":
        raise WorkspaceConflictError("Committed workspace is read-only")
    if current.get("revision") != body.revision:
        raise WorkspaceConflictError("Workspace revision is stale")
    body_payload = body.payload()
    template = _required_template(store, current["processFlowTemplateId"])
    step_templates = _step_templates(store, template)
    _compiler(store).validate_configuration(
        template,
        body_payload,
        step_templates,
        require_complete=False,
    )
    updated = {
        **current,
        "name": body.name,
        "revision": body.revision + 1,
        "updatedAt": utc_now(),
        "inputBindings": body_payload.get("inputBindings", {}),
        "stepConfigurations": body_payload.get("stepConfigurations", {}),
        "embeddedGeometries": body_payload.get("embeddedGeometries", {}),
    }
    return store.update_process_flow_workspace(
        updated,
        expected_revision=body.revision,
    )


def commit_workspace(
    store: SQLiteStore,
    workspace_id: str,
    body: WorkspaceCommitRequest,
) -> JsonObject:
    workspace = _required_workspace(store, workspace_id)
    if workspace.get("status") == "committed":
        instance_id = workspace.get("committedInstanceId")
        instance = store.get_process_flow_instance(instance_id)
        if instance is None:
            raise WorkspaceConflictError("Committed workspace instance is missing")
        return {"workspace": workspace, "processFlowInstance": instance}
    if workspace.get("revision") != body.revision:
        raise WorkspaceConflictError("Workspace revision is stale")

    template = _required_template(store, workspace["processFlowTemplateId"])
    step_templates = _step_templates(store, template)
    compiler = _compiler(store)
    compiler.compile(template, workspace, step_templates)

    geometries, catalog_bindings = materialize_embedded_bindings(workspace)
    instance = {
        "schemaVersion": 2,
        "id": body.instanceId,
        "name": body.instanceName,
        "processFlowTemplateId": workspace["processFlowTemplateId"],
        "inputBindings": catalog_bindings,
        "stepConfigurations": workspace.get("stepConfigurations", {}),
    }
    committed_workspace = {
        **workspace,
        "revision": body.revision + 1,
        "status": "committed",
        "committedInstanceId": body.instanceId,
        "updatedAt": utc_now(),
        "inputBindings": catalog_bindings,
        "embeddedGeometries": {},
    }
    saved_workspace, saved_instance = store.commit_process_flow_workspace(
        workspace=committed_workspace,
        expected_revision=body.revision,
        geometries=geometries,
        instance=instance,
    )
    return {
        "workspace": saved_workspace,
        "processFlowInstance": saved_instance,
    }


def _compiler(store):
    return FlowCompiler(StoreGeometryCatalog(store))


def _required_template(store, template_id):
    template = store.get_process_flow_template(template_id)
    if template is None:
        raise NotFoundError(template_id)
    return template


def _required_workspace(store, workspace_id):
    workspace = store.get_process_flow_workspace(workspace_id)
    if workspace is None:
        raise NotFoundError(workspace_id)
    return workspace


def _step_templates(store, template):
    result = []
    for template_id in dict.fromkeys(
        step_ref["processStepTemplateId"]
        for step_ref in template.get("stepRefs", [])
    ):
        step_template = store.get_process_step_template(template_id)
        if step_template is None:
            raise NotFoundError(template_id)
        result.append(step_template)
    return result
