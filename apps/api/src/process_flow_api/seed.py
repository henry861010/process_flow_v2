from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

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
    return result
