"""The only boundary that understands pre-14 flow payloads.

Conversion is pure: the repository writes the validated result in one transaction.
No runtime reader upgrades, fills defaults, or resolves a source flow.
"""
from __future__ import annotations

from copy import deepcopy
import uuid

from process_flow_kernel import FlowCompiler
from .models import FlowDraft, GeometryEntity, ProcessFlow
from .geometry_validation import validate_catalog_structure

LEGACY_TABLES = ("process_flow_templates", "process_flow_instances",
                 "process_flow_template_drafts", "process_flow_instance_drafts", "process_flow_workspaces")


def candidate(values):
    return {"recipeCandidates": [{"recipeId": "recipe_1", "name": "Recipe 1", "description": "",
                                  "parameterValues": deepcopy(values)}], "selectedRecipeId": "recipe_1"}


def definition(template):
    result = {key: deepcopy(template[key]) for key in ("flowInputs", "stepRefs", "flowEdges")}
    for ref in result["stepRefs"]:
        ref.pop("parameterDefaults", None)
    return result


def template_flow(template, steps):
    configs = {}
    for ref in template["stepRefs"]:
        values = ref.get("parameterDefaults")
        if "parameterDefaults" not in ref:
            # Preserve the historical scalar-only fallback, including explicit empty overrides.
            values = {p["id"]: deepcopy(p["defaultValue"])
                      for p in steps[ref["processStepTemplateId"]].get("parameterDefinitions", [])
                      if p.get("valueType") in {"string", "integer", "float", "boolean", "materialRef"}
                      and "defaultValue" in p}
        configs[ref["stepRefId"]] = candidate(values)
    return {"schemaVersion": 3, "revision": 1,
            **{key: template[key] for key in ("id", "name", "version", "owner")},
            "description": template.get("description", ""), "definition": definition(template),
            "configuration": {"inputBindings": {}, "stepConfigurations": configs}}


def configuration(old, refs, geometries, source):
    bindings = deepcopy(old.get("inputBindings", {}))
    embedded_ids = {}
    # Preserve even unbound entries; every conversion must succeed.
    for local_id, document in old.get("embeddedGeometries", {}).items():
        try:
            geometry = GeometryEntity.model_validate({**document, "id": f"geom_{uuid.uuid4().hex}"}).payload()
            geometry["structure"] = validate_catalog_structure(geometry)
        except Exception as error:
            raise ValueError(f"{source}/embeddedGeometries/{local_id}: {error}") from error
        embedded_ids[local_id] = geometry["id"]
        geometries.append(geometry)
    for binding in bindings.values():
        if binding.get("kind") == "embedded":
            local_id = binding["localId"]
            if local_id not in embedded_ids:
                raise ValueError(f"{source}: missing embedded geometry {local_id}")
            binding.clear()
            binding.update(kind="catalog", geometryId=embedded_ids[local_id])
    configs = {key: candidate(value.get("parameterValues", {}))
               for key, value in old.get("stepConfigurations", {}).items()}
    for ref in refs:
        configs.setdefault(ref["stepRefId"], candidate({}))
    return {"inputBindings": bindings, "stepConfigurations": configs}


def canvas(template):
    nodes = [{"id": item["flowInputId"], "kind": "flowInput", "definition": deepcopy(item),
              "position": {"x": 0, "y": index * 180}} for index, item in enumerate(template["flowInputs"])]
    nodes += [{"id": ref["stepRefId"], "kind": "processStep", "stepRef": ref,
               "position": {"x": (index + 1) * 340, "y": 100}}
              for index, ref in enumerate(definition(template)["stepRefs"])]
    edges = [{"id": edge["edgeId"],
              "source": edge["source"].get("flowInputId", edge["source"].get("stepRefId")),
              "sourceHandle": edge["source"].get("outputPortId", "out"),
              "target": edge["target"]["stepRefId"], "targetHandle": edge["target"]["inputPortId"]}
             for edge in template["flowEdges"]]
    return {"nodes": nodes, "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 1}}


def convert_legacy(data, version):
    steps = {item["id"]: item for item in data["process_step_templates"]}
    templates = {item["id"]: item for item in data.get("process_flow_templates", [])}
    geometries = deepcopy(data["geometries"])
    if version < 10:
        for geometry in geometries:
            geometry.pop("version", None)
            if not isinstance(geometry.get("dim"), str):
                dim, sep, _ = str(geometry.get("description", "")).partition(" — ")
                geometry["dim"] = dim if sep and dim.endswith(" um") else ""
    flows, drafts = [], []
    def source_template(id_, source):
        if id_ not in templates:
            raise ValueError(f"{source}: missing process flow template {id_}")
        return templates[id_]
    for template in templates.values():
        try:
            flows.append(template_flow(template, steps))
        except Exception as error:
            raise ValueError(f"process_flow_templates/{template['id']}: {error}") from error
    for old in data.get("process_flow_instances", []):
        source = f"process_flow_instances/{old['id']}"
        template = source_template(old["processFlowTemplateId"], source)
        try:
            metadata = {key: old[key] for key in ("id", "name")}
            metadata.update(version=old.get("version", "V0.0.0"),
                            owner=old.get("owner", template.get("owner") or "legacy.import"),
                            description=old.get("description", ""))
            flows.append({"schemaVersion": 3, "revision": 1, **metadata,
                          "origin": {"flowId": template["id"], "revision": 1},
                          "definition": definition(template),
                          "configuration": configuration(old, template["stepRefs"], geometries, source)})
        except Exception as error:
            raise ValueError(f"{source}: {error}") from error
    legacy_drafts = [(kind, item) for kind in ("template", "instance")
                     for item in data.get(f"process_flow_{kind}_drafts", [])]
    for old in data.get("process_flow_workspaces", []):
        if old["status"] == "draft":
            legacy_drafts.append(("instance", {
                **{key: old[key] for key in ("id", "name", "revision", "createdAt", "updatedAt", "processFlowTemplateId")},
                "user": "legacy.import", "state": {
                    "metadata": {"name": "", "version": "V0.0.0", "owner": "", "description": ""},
                    "configuration": {key: old.get(key, {}) for key in ("inputBindings", "stepConfigurations", "embeddedGeometries")}}}))
    for kind, old in legacy_drafts:
        source = f"process_flow_{kind}_drafts/{old['id']}"
        try:
            state = deepcopy(old["state"])
            origin = {}
            if kind == "instance":
                template = source_template(old["processFlowTemplateId"], source)
                state.update(canvas(template))
                origin = {"origin": {"flowId": template["id"], "revision": 1}}
            for node in state["nodes"]:
                if node["kind"] == "processStep":
                    node["stepRef"].pop("parameterDefaults", None)
            refs = [node["stepRef"] for node in state["nodes"] if node["kind"] == "processStep"]
            state["configuration"] = configuration(state.get("configuration", {}), refs, geometries, source)
            drafts.append(FlowDraft.model_validate({"schemaVersion": 2, **origin,
                **{key: old[key] for key in ("id", "name", "user", "revision", "createdAt", "updatedAt")},
                "state": state}).payload())
        except Exception as error:
            raise ValueError(f"{source}: {error}") from error
    ids, identities, draft_ids = set(), {}, set()
    class Catalog:
        def get_geometry(self, id_):
            return next((g for g in geometries if g["id"] == id_), None)
    compiler = FlowCompiler(Catalog())
    validated = []
    for flow in flows:
        source = f"flow {flow['id']}"
        try:
            flow = ProcessFlow.model_validate(flow).payload()
            identity = (flow["name"], flow["version"])
            if flow["id"] in ids:
                raise ValueError(f"conflicting ID across legacy flow collections: {flow['id']}")
            if identity in identities:
                raise ValueError(f"conflicting (name, version) {identity!r}: {identities[identity]} and {flow['id']}")
            ids.add(flow["id"])
            identities[identity] = flow["id"]
            compiler.validate_authoring(flow["definition"], flow["configuration"], steps.values())
            for binding in flow["configuration"]["inputBindings"].values():
                if binding["kind"] == "catalog" and Catalog().get_geometry(binding["geometryId"]) is None:
                    raise ValueError(f"missing geometry {binding['geometryId']}")
            validated.append(flow)
        except Exception as error:
            raise ValueError(f"{source}: {error}") from error
    for draft in drafts:
        if draft["id"] in draft_ids:
            raise ValueError(f"Conflicting draft ID {draft['id']}")
        draft_ids.add(draft["id"])
    return {"processFlows": validated, "flowDrafts": drafts, "geometries": geometries}
