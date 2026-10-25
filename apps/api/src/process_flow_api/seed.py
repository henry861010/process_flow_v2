from __future__ import annotations
import json
from importlib.resources import files
from typing import Any
from process_flow_kernel import FlowCompiler, InMemoryGeometryCatalog, validate_geometry_semantic_keys, validate_process_step_template
from .models import ProcessFlow, ProcessStepTemplate, GeometryEntity

JsonObject = dict[str, Any]
FIXTURE_FILES = {
    "processStepTemplates": "process-step-templates.json",
    "processFlows": "process-flows.json",
    "geometries": "geometries.json",
}


def validate_fixtures(result: dict[str, list[JsonObject]]) -> None:
    geometry_ids = {geometry["id"] for geometry in result["geometries"]}
    for geometry in result["geometries"]:
        GeometryEntity.model_validate(geometry)
        validate_geometry_semantic_keys(geometry["structure"])
    steps = result["processStepTemplates"]
    for step in steps:
        ProcessStepTemplate.model_validate(step)
        validate_process_step_template(step)
    compiler = FlowCompiler(InMemoryGeometryCatalog(result["geometries"]))
    for flow in result["processFlows"]:
        ProcessFlow.model_validate(flow)
        compiler.validate_authoring(flow["definition"], flow["configuration"], steps)
        for binding in flow["configuration"]["inputBindings"].values():
            if binding["kind"] == "catalog" and binding["geometryId"] not in geometry_ids:
                raise ValueError(f"Flow {flow['id']} references missing geometry {binding['geometryId']}")


def load_seed_fixtures() -> dict[str, list[JsonObject]]:
    fixture_dir = files("process_flow_api").joinpath("fixtures")
    result = {key: json.loads(fixture_dir.joinpath(filename).read_text(encoding="utf-8"))
              for key, filename in FIXTURE_FILES.items()}
    validate_fixtures(result)
    return result
