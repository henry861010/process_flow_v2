from __future__ import annotations

from process_flow_geometry_generators import GeometryGeneratorRegistry

from .identifiers import generated_draft_id
from .models import (
    InstanceEditorDraftCommit,
    InstanceEditorDraftCreate,
    InstanceEditorDraftUpdate,
    TemplateEditorDraftCommit,
    TemplateEditorDraftCreate,
    TemplateEditorDraftUpdate,
    TemplateInstanceCreateRequest,
)
from .repository import SQLiteStore, utc_now
from .services import prepare_flow_instance, prepare_flow_template, prepare_template_instance, require_item


def create_draft(store: SQLiteStore, kind: str,
                 body: TemplateEditorDraftCreate | InstanceEditorDraftCreate):
    if kind == "instance":
        require_item(store.get_process_flow_template(body.processFlowTemplateId), body.processFlowTemplateId)
    now = utc_now()
    return store.insert_editor_draft(kind, {
        **body.payload(), "id": generated_draft_id(), "revision": 1,
        "createdAt": now, "updatedAt": now,
    })


def update_draft(store: SQLiteStore, kind: str, id_: str,
                 body: TemplateEditorDraftUpdate | InstanceEditorDraftUpdate):
    return store.update_editor_draft(kind, id_, body.payload())


def commit_template_draft(store: SQLiteStore, id_: str, body: TemplateEditorDraftCommit,
                          generators: GeometryGeneratorRegistry):
    store._required_draft("template", id_, body.revision)
    if body.processFlowInstance is not None:
        template, instance, geometries = prepare_template_instance(store, TemplateInstanceCreateRequest(
            processFlowTemplate=body.processFlowTemplate,
            processFlowInstance=body.processFlowInstance,
        ), generators)
        template, instance = store.insert_template_and_instance(
            template, instance, geometries=geometries, draft=(id_, body.revision),
        )
        return {"processFlowTemplate": template, "processFlowInstance": instance}
    resource = prepare_flow_template(store, body.processFlowTemplate)
    return store.commit_editor_draft("template", id_, body.revision, resource)


def commit_instance_draft(store: SQLiteStore, id_: str, body: InstanceEditorDraftCommit,
                          generators: GeometryGeneratorRegistry):
    store._required_draft("instance", id_, body.revision, body.processFlowInstance.processFlowTemplateId)
    resource, geometries = prepare_flow_instance(store, body.processFlowInstance, generators)
    return store.commit_editor_draft("instance", id_, body.revision, resource, geometries=geometries)
