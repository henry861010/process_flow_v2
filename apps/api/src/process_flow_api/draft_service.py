from __future__ import annotations

from process_flow_geometry_generators import GeometryGeneratorRegistry

from .identifiers import generated_draft_id
from .models import (
    TemplateEditorDraftCommit,
    TemplateEditorDraftCreate,
    TemplateEditorDraftUpdate,
    TemplateInstanceCreateRequest,
)
from .repository import SQLiteStore, utc_now
from .services import prepare_flow_template, prepare_template_instance


def create_draft(store: SQLiteStore, kind: str,
                 body: TemplateEditorDraftCreate):
    now = utc_now()
    return store.insert_editor_draft(kind, {
        **body.payload(), "id": generated_draft_id(), "revision": 1,
        "createdAt": now, "updatedAt": now,
    })


def update_draft(store: SQLiteStore, kind: str, id_: str,
                 body: TemplateEditorDraftUpdate):
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
