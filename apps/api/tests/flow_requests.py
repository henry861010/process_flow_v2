"""Explicitly turn persisted instances into create/preview parameter snapshots."""
from copy import deepcopy


def template_create_payload(template):
    return {key: value for key, value in template.items() if key != "id"}


def instance_configuration(instance):
    stations = {}
    for key, station in instance.get("stepConfigurations", {}).items():
        if "parameterValues" in station:
            stations[key] = deepcopy(station)
        else:
            recipe = next((item for item in station["recipes"] if item["id"] == station.get("activeRecipeId")), None)
            if recipe is not None:
                stations[key] = {"parameterValues": deepcopy(recipe["parameterValues"])}
    return {"inputBindings": deepcopy(instance.get("inputBindings", {})), "stepConfigurations": stations,
            "embeddedGeometries": deepcopy(instance.get("embeddedGeometries", {}))}


def station_values(instance, step):
    station = instance["stepConfigurations"][step]
    if "parameterValues" in station:
        return station["parameterValues"]
    return next(item for item in station["recipes"] if item["id"] == station["activeRecipeId"])["parameterValues"]


def instance_create_payload(instance, *, for_new_template=False):
    keys = {"schemaVersion", "name", "version", "owner", "description"}
    if not for_new_template:
        keys.add("processFlowTemplateId")
    result = {key: value for key, value in instance.items() if key in keys}
    result["initialConfiguration"] = instance.get("initialConfiguration", instance_configuration(instance))
    return result
