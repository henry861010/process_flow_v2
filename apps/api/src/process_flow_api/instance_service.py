"""Creation and narrow, revision-checked mutations for tracked flow instances."""
from .configuration_materialization import materialize_embedded_bindings
from .identifiers import generated_flow_instance_id
from .instance_data import new_recipe
from .models import ProcessFlowInstance
from .repository import NotFoundError


def validate_bindings(store, template, configuration, generators):
    known = {item["flowInputId"] for item in template["flowInputs"]}
    for key, binding in configuration.get("inputBindings", {}).items():
        if key not in known:
            raise ValueError(f"Unknown flow input binding: {key}")
        if binding["kind"] == "catalog" and store.get_geometry(binding["geometryId"]) is None:
            raise NotFoundError(binding["geometryId"])
        if binding["kind"] == "generator":
            try:
                generators.definition(binding["generatorId"], binding["generatorVersion"])
            except KeyError as error:
                raise ValueError(f"Geometry generator {binding['generatorId']} version {binding['generatorVersion']} is not available") from error
        if binding["kind"] == "embedded" and binding["localId"] not in configuration.get("embeddedGeometries", {}):
            raise ValueError(f"Embedded geometry not found: {binding['localId']}")


def prepare_instance(store, template, payload, generators):
    initial = payload.get("initialConfiguration") or {}
    validate_bindings(store, template, initial, generators)
    stations = {step["stepRefId"]: {"recipes": [], "activeRecipeId": None} for step in template["stepRefs"]}
    for key, value in initial.get("stepConfigurations", {}).items():
        if key not in stations:
            raise ValueError(f"Unknown step configuration: {key}")
        recipe = new_recipe(value.get("parameterValues", {}), name="Default")
        stations[key] = {"recipes": [recipe], "activeRecipeId": recipe["id"]}
    geometries, bindings = materialize_embedded_bindings(initial)
    instance = {
        **{key: payload[key] for key in ("schemaVersion", "name", "version", "owner", "description")},
        "id": generated_flow_instance_id(), "revision": 1,
        "processFlowTemplateId": template["id"], "inputBindings": bindings,
        "stepConfigurations": stations,
    }
    return ProcessFlowInstance.model_validate(instance).payload(), geometries


def add_instance_recipe(store, instance_id, step_ref_id, body):
    def mutate(instance):
        station = instance["stepConfigurations"].get(step_ref_id)
        if station is None:
            raise NotFoundError(step_ref_id)
        recipe = new_recipe(body.parameterValues, name=body.name, description=body.description)
        first = not station["recipes"]
        station["recipes"].append(recipe)
        if first or body.activate:
            station["activeRecipeId"] = recipe["id"]
        return instance, []
    return store.update_process_flow_instance(instance_id, body.revision, mutate)


def set_instance_active_recipe(store, instance_id, step_ref_id, body):
    def mutate(instance):
        station = instance["stepConfigurations"].get(step_ref_id)
        if station is None:
            raise NotFoundError(step_ref_id)
        if not any(recipe["id"] == body.recipeId for recipe in station["recipes"]):
            raise NotFoundError(body.recipeId)
        station["activeRecipeId"] = body.recipeId
        return instance, []
    return store.update_process_flow_instance(instance_id, body.revision, mutate)


def update_instance_bindings(store, instance_id, body, generators):
    def mutate(instance):
        template = store.get_process_flow_template(instance["processFlowTemplateId"])
        if template is None:
            raise NotFoundError(instance["processFlowTemplateId"])
        configuration = body.model_dump(mode="json")
        validate_bindings(store, template, configuration, generators)
        geometries, bindings = materialize_embedded_bindings(configuration)
        instance["inputBindings"] = bindings
        return instance, geometries
    return store.update_process_flow_instance(instance_id, body.revision, mutate)
