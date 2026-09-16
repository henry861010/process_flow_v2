from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

from process_flow_kernel import (
    validate_flow_graph,
    validate_flow_parameter_defaults,
    validate_geometry_semantic_keys,
    validate_process_step_template,
)

JsonObject = dict[str, Any]


FIXTURE_FILES = {
    "processStepTemplates": "process-step-templates.json",
    "processFlowTemplates": "process-flow-templates.json",
    "processFlowInstances": "process-flow-instances.json",
    "geometries": "geometries.json",
}


def load_seed_fixtures() -> dict[str, list[JsonObject]]:
    fixture_dir = files("process_flow_api").joinpath("fixtures")
    result: dict[str, list[JsonObject]] = {}
    for key, filename in FIXTURE_FILES.items():
        with fixture_dir.joinpath(filename).open("r", encoding="utf-8") as file:
            result[key] = json.load(file)
    for geometry in result["geometries"]:
        validate_geometry_semantic_keys(geometry["structure"])
    step_templates = result["processStepTemplates"]
    for step_template in step_templates:
        validate_process_step_template(step_template)
    for flow_template in result["processFlowTemplates"]:
        validate_flow_graph(flow_template, step_templates)
        validate_flow_parameter_defaults(flow_template, step_templates)
    return result
