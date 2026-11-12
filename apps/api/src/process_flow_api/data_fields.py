"""Shared collection fields. These values never enter geometry parameterValues."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import uuid
from typing import Any

from fastapi import APIRouter, Request

from .models import DataFieldWrite, DataFieldAction, RecipeDataWrite
from .repository import SQLiteStore, NotFoundError, ResourceConflictError, utc_now

router = APIRouter(prefix="/api")


def template_fields(template):
    return template.get("dataFieldDefinitions", [])


def finite_number(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def value_issue(field, value):
    kind = field["valueType"]
    if kind == "string" and not isinstance(value, str):
        return "Expected text"
    if kind == "boolean" and not isinstance(value, bool):
        return "Expected true or false"
    if kind in ("integer", "float"):
        if not finite_number(value):
            return "Expected a finite number"
        if kind == "integer" and int(value) != value:
            return "Expected an integer"
        if field.get("min") is not None and value < field["min"]:
            return f"Minimum is {field['min']}"
        if field.get("max") is not None and value > field["max"]:
            return f"Maximum is {field['max']}"
    return None


def validate_values(template, values):
    if not isinstance(values, dict):
        raise ValueError("dataValues must be an object")
    fields = {f["id"]: f for f in template_fields(template)}
    result = {}
    for key, value in values.items():
        if key not in fields:
            raise ResourceConflictError(f"Data field {key} no longer exists. Refresh the fields before saving.")
        if type(value) not in (str, int, float, bool) or (type(value) in (int, float) and not finite_number(value)):
            raise ValueError(f"Data field {key} accepts only text, finite numbers, or booleans")
        if value == "":
            continue
        issue = value_issue(fields[key], value)
        if fields[key]["status"] == "formal" and issue:
            raise ValueError(f"{fields[key]['name']}: {issue}")
        result[key] = value
    return result


def recipes(document):
    """Stable identities work identically for saved flows and editor drafts."""
    content = document.get("state", document)
    refs = content.get("definition", {}).get("stepRefs", []) if "state" not in document else [
        n["stepRef"] for n in content.get("nodes", []) if n.get("kind") == "processStep"
    ]
    for ref in refs:
        config = content.get("configuration", {}).get("stepConfigurations", {}).get(ref["stepRefId"], {})
        for recipe in config.get("recipeCandidates", []):
            yield ref, recipe


def validate_document(store, payload, current=None):
    content = payload.get("state", payload)
    known_steps = {ref["stepRefId"] for ref, _ in recipes(payload)}
    for step_id, config in content.get("configuration", {}).get("stepConfigurations", {}).items():
        if step_id not in known_steps and any(r.get("dataValues") for r in config.get("recipeCandidates", [])):
            raise ValueError(f"Data values require an existing process step: {step_id}")
    previous = {(ref["stepRefId"], ref["processStepTemplateId"], recipe["recipeId"]): recipe
                for ref, recipe in recipes(current or {})}
    for ref, recipe in recipes(payload):
        values = recipe.get("dataValues", {})
        old = previous.get((ref["stepRefId"], ref["processStepTemplateId"], recipe["recipeId"]))
        if not values and not (old or {}).get("dataValues"):
            continue
        template = _template(store, ref["processStepTemplateId"])
        # Reject removed IDs even from a stale whole-document client.
        validate_values(template, values)
        if old is not None:
            values = copy.deepcopy(old.get("dataValues", {}))
        recipe["dataValues"] = validate_values(template, values)


def _template(store, template_id):
    template = store.get_process_step_template(template_id)
    if template is None:
        raise NotFoundError(template_id)
    return template


def _field(template, field_id):
    field = next((f for f in template_fields(template) if f["id"] == field_id), None)
    if field is None:
        raise NotFoundError(field_id)
    return field


def _documents(store):
    for kind, table in (("flow", "process_flows"), ("draft", "process_flow_drafts")):
        for document in store._list(table, [], [], "id ASC"):
            yield kind, table, document


def review_field(store, template_id, field_id):
    template = _template(store, template_id)
    field = _field(template, field_id)
    usages = []
    for kind, _, document in _documents(store):
        for ref, recipe in recipes(document):
            if ref["processStepTemplateId"] != template_id or field_id not in recipe.get("dataValues", {}):
                continue
            value = recipe["dataValues"][field_id]
            usages.append({"kind": kind, "id": document["id"], "name": document["name"],
                           "revision": document["revision"], "stepRefId": ref["stepRefId"],
                           "stepLabel": ref.get("stepLabel") or template["name"],
                           "recipeId": recipe["recipeId"], "recipeName": recipe["name"],
                           "value": value, "issue": value_issue(field, value)})
    token_data = {"field": field, "revision": template.get("dataFieldsRevision", 1), "usages": usages}
    token = hashlib.sha256(json.dumps(token_data, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    return {"templateId": template_id, "templateName": template["name"], "field": field,
            "dataFieldsRevision": template.get("dataFieldsRevision", 1), "reviewToken": token,
            "usages": usages, "valueCount": len(usages),
            "flowCount": len({u["id"] for u in usages if u["kind"] == "flow"}),
            "draftCount": len({u["id"] for u in usages if u["kind"] == "draft"}),
            "issueCount": sum(u["issue"] is not None for u in usages)}


def write_field(store, template_id, body, field_id=None):
    with store._connection:
        store._connection.execute("BEGIN IMMEDIATE")
        template = _template(store, template_id)
        if template.get("dataFieldsRevision", 1) != body.revision:
            raise ResourceConflictError("Fields changed. Refresh before saving.")
        field = _field(template, field_id) if field_id else None
        if field and field["status"] != "proposed":
            raise ResourceConflictError("Formal field definitions cannot be changed here")
        if any(f["id"] != field_id and f["name"].strip().casefold() == body.name.strip().casefold()
               for f in template_fields(template)):
            raise ResourceConflictError("A field with this name already exists. Use the existing field.")
        now = utc_now()
        spec = body.model_dump(mode="json", exclude={"revision", "actor"}, exclude_none=True)
        updated = {**spec, "id": field_id or f"field_{uuid.uuid4().hex}", "status": "proposed",
                   "createdBy": field["createdBy"] if field else body.actor,
                   "createdAt": field["createdAt"] if field else now,
                   "updatedBy": body.actor, "updatedAt": now}
        template["dataFieldDefinitions"] = [updated if f["id"] == field_id else f for f in template_fields(template)]
        if field is None:
            template["dataFieldDefinitions"].append(updated)
        template["dataFieldsRevision"] = body.revision + 1
        store._upsert_process_step_template_in_transaction(template)
    return template


def _write_document(store, table, document):
    document["revision"] += 1
    if table == "process_flow_drafts":
        document["updatedAt"] = utc_now()
        store._connection.execute("UPDATE process_flow_drafts SET revision=?, updated_at=?, payload=? WHERE id=?",
            (document["revision"], document["updatedAt"], json.dumps(document, allow_nan=False), document["id"]))
    else:
        store._connection.execute("UPDATE process_flows SET revision=?, payload=? WHERE id=?",
            (document["revision"], json.dumps(document, allow_nan=False), document["id"]))


def act_on_field(store, template_id, field_id, body, *, remove=False):
    with store._connection:
        store._connection.execute("BEGIN IMMEDIATE")
        review = review_field(store, template_id, field_id)
        if review["reviewToken"] != body.reviewToken:
            raise ResourceConflictError("The field or its usage changed. Refresh the review before continuing.")
        template = _template(store, template_id)
        field = _field(template, field_id)
        if field["status"] != "proposed":
            raise ResourceConflictError("Only proposed fields can be approved or removed")
        if remove:
            template["dataFieldDefinitions"] = [f for f in template_fields(template) if f["id"] != field_id]
            for _, table, document in _documents(store):
                changed = False
                for ref, recipe in recipes(document):
                    if ref["processStepTemplateId"] == template_id and field_id in recipe.get("dataValues", {}):
                        del recipe["dataValues"][field_id]
                        changed = True
                if changed:
                    _write_document(store, table, document)
        else:
            if review["issueCount"]:
                raise ResourceConflictError("Correct all invalid values before approving this field")
            field.update(status="formal", approvedBy=body.actor, approvedAt=utc_now(),
                         updatedBy=body.actor, updatedAt=utc_now())
        template["dataFieldsRevision"] = template.get("dataFieldsRevision", 1) + 1
        store._upsert_process_step_template_in_transaction(template)
    return template


def save_recipe_data(store, kind, document_id, step_id, recipe_id, body):
    table = "process_flows" if kind == "flow" else "process_flow_drafts"
    with store._connection:
        store._connection.execute("BEGIN IMMEDIATE")
        document = (store._required_flow if kind == "flow" else store._required_draft)(document_id, body.revision)
        match = next(((ref, recipe) for ref, recipe in recipes(document)
                      if ref["stepRefId"] == step_id and recipe["recipeId"] == recipe_id), None)
        if match is None:
            raise NotFoundError("Save the recipe in its flow or draft before saving data")
        ref, recipe = match
        template = _template(store, ref["processStepTemplateId"])
        if template.get("dataFieldsRevision", 1) != body.dataFieldsRevision:
            raise ResourceConflictError("Field definitions changed. Refresh the fields before saving.")
        recipe["dataValues"] = validate_values(template, body.dataValues)
        _write_document(store, table, document)
    return document


@router.get("/data-field-reviews")
async def list_reviews(request: Request):
    store = request.app.state.store
    return [review_field(store, t["id"], f["id"]) for t in store.list_process_step_templates()
            for f in template_fields(t)]


@router.get("/process-step-templates/{template_id}/data-fields/{field_id}/review")
async def get_review(request: Request, template_id: str, field_id: str):
    return review_field(request.app.state.store, template_id, field_id)


@router.post("/process-step-templates/{template_id}/data-fields", status_code=201)
async def create_field(request: Request, template_id: str, body: DataFieldWrite):
    return write_field(request.app.state.store, template_id, body)


@router.put("/process-step-templates/{template_id}/data-fields/{field_id}")
async def update_field(request: Request, template_id: str, field_id: str, body: DataFieldWrite):
    return write_field(request.app.state.store, template_id, body, field_id)


@router.post("/process-step-templates/{template_id}/data-fields/{field_id}/approve")
async def approve_field(request: Request, template_id: str, field_id: str, body: DataFieldAction):
    return act_on_field(request.app.state.store, template_id, field_id, body)


@router.post("/process-step-templates/{template_id}/data-fields/{field_id}/remove")
async def remove_field(request: Request, template_id: str, field_id: str, body: DataFieldAction):
    return act_on_field(request.app.state.store, template_id, field_id, body, remove=True)


@router.put("/process-flows/{document_id}/steps/{step_id}/recipes/{recipe_id}/data-values")
async def update_flow_data(request: Request, document_id: str, step_id: str, recipe_id: str, body: RecipeDataWrite):
    return save_recipe_data(request.app.state.store, "flow", document_id, step_id, recipe_id, body)


@router.put("/process-flow-drafts/{document_id}/steps/{step_id}/recipes/{recipe_id}/data-values")
async def update_draft_data(request: Request, document_id: str, step_id: str, recipe_id: str, body: RecipeDataWrite):
    return save_recipe_data(request.app.state.store, "draft", document_id, step_id, recipe_id, body)
