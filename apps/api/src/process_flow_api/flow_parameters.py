from __future__ import annotations

import copy
from collections.abc import Iterable, Mapping
from typing import Any

from process_flow_kernel import normalize_parameter_values_for_storage


def normalize_flow_parameter_values(
    flow: Mapping[str, Any], step_templates: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Canonicalize recipe missing values using their step's parameter schema.

    This is a compatibility projection for formal flows and inline execution
    requests, never for raw editor drafts. Unknown keys and malformed structures
    remain available to the existing validators; no array element is removed.
    """
    result = copy.deepcopy(dict(flow))
    templates = {step["id"]: step for step in step_templates}
    configurations = result["configuration"].get("stepConfigurations", {})
    for ref in result["definition"]["stepRefs"]:
        step = templates.get(ref["processStepTemplateId"])
        configuration = configurations.get(ref["stepRefId"])
        if step is None or not isinstance(configuration, Mapping):
            continue
        candidates = configuration.get("recipeCandidates", [])
        if not isinstance(candidates, list):
            continue
        for recipe in candidates:
            if not isinstance(recipe, dict) or not isinstance(recipe.get("parameterValues"), Mapping):
                continue
            recipe["parameterValues"] = normalize_parameter_values_for_storage(
                step.get("parameterDefinitions", []), recipe["parameterValues"],
            )
    return result
