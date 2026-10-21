"""Shared conversion for schema migrations, fixtures and initial configurations."""
from copy import deepcopy
from datetime import UTC, datetime
import uuid


def new_recipe(values, *, name="Initial recipe", description=""):
    return {
        "id": uuid.uuid4().hex, "name": name, "description": description,
        "createdAt": datetime.now(UTC).isoformat(), "parameterValues": deepcopy(values),
    }


def upgrade_legacy_instance(payload, template=None):
    result = deepcopy(payload)
    result.setdefault("revision", 1)
    stations = result.setdefault("stepConfigurations", {})
    for station in list(stations):
        old = stations[station]
        if "parameterValues" in old:
            recipe = new_recipe(old["parameterValues"])
            stations[station] = {"recipes": [recipe], "activeRecipeId": recipe["id"]}
    if template is not None:
        for step in template.get("stepRefs", []):
            stations.setdefault(step["stepRefId"], {"recipes": [], "activeRecipeId": None})
    return restore_missing_active_recipes(result)


def restore_missing_active_recipes(payload):
    """Normalize legacy data at import/migration boundaries, never at execution."""
    result = deepcopy(payload)
    changed = False
    for station in result.get("stepConfigurations", {}).values():
        if station.get("recipes") and station.get("activeRecipeId") is None:
            station["activeRecipeId"] = station["recipes"][0]["id"]
            changed = True
    if changed:
        result["revision"] = result.get("revision", 1) + 1
    return result
