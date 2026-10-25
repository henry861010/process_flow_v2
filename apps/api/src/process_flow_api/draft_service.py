from __future__ import annotations
from process_flow_geometry_generators import GeometryGeneratorRegistry
from .identifiers import generated_draft_id
from .models import FlowDraftCreate, FlowDraftUpdate, FlowDraftCommit
from .repository import SQLiteStore, utc_now
from .services import prepare_flow


def create_draft(store: SQLiteStore, body: FlowDraftCreate):
    now = utc_now()
    return store.insert_flow_draft({**body.payload(), "id": generated_draft_id(), "revision": 1,
                                   "createdAt": now, "updatedAt": now})


def update_draft(store: SQLiteStore, id_: str, body: FlowDraftUpdate):
    return store.update_flow_draft(id_, body.payload())


def commit_draft(store: SQLiteStore, id_: str, body: FlowDraftCommit, generators: GeometryGeneratorRegistry):
    store._required_draft(id_, body.revision)
    current = store._required_flow(body.target.flowId, body.target.revision) if body.target else None
    resource = prepare_flow(store, body.flow, generators, current=current)
    return store.commit_flow_draft(id_, body.revision, resource,
                                  target_revision=body.target.revision if body.target else None)
