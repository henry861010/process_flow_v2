"""JSON transfer and structural comparison for process step templates."""
from __future__ import annotations

import copy
import json
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import ValidationError
from process_flow_kernel import validate_process_step_template

from .models import ProcessStepTemplate

MAX_STEP_TEMPLATE_JSON_BYTES = 25 * 1024 * 1024


def build_step_template_json(templates: Sequence[dict[str, Any]]) -> bytes:
    return (json.dumps(templates, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def load_step_template_json(content: bytes) -> list[dict[str, Any]]:
    if len(content) > MAX_STEP_TEMPLATE_JSON_BYTES:
        raise ValueError("Step template JSON exceeds the 25 MiB upload limit")
    try:
        items = json.loads(content.decode("utf-8-sig"), parse_constant=_reject_json_constant)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Step templates must contain valid UTF-8 JSON") from error
    if not isinstance(items, list):
        raise ValueError("Step templates must contain a JSON array")
    result = []
    ids: set[str] = set()
    for index, item in enumerate(items):
        try:
            validated = ProcessStepTemplate.model_validate(item)
            payload = validated.model_dump(mode="json", exclude_unset=True)
            payload.setdefault("status", validated.status)
            validate_process_step_template(payload)
            json.dumps(payload, allow_nan=False)
        except (ValidationError, ValueError) as error:
            raise ValueError(f"process-step-templates[{index}]: {error}") from error
        if validated.id in ids:
            raise ValueError(f"Step templates contain duplicate id: {validated.id}")
        ids.add(validated.id)
        result.append(payload)
    return result


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"Invalid JSON number: {value}")


def locked_process_step_template(
    template: dict[str, Any], *, allow_description: bool = False,
) -> dict[str, Any]:
    locked = copy.deepcopy(template)
    for field in ("status", "owner", "category", "program"):
        locked.pop(field, None)
    if allow_description:
        locked.pop("description", None)
    # Input declaration order is presentation metadata.
    locked["inputPorts"] = sorted(locked["inputPorts"], key=lambda port: port["portId"])
    _remove_parameter_defaults(locked.get("parameterDefinitions", []))
    return locked


def _remove_parameter_defaults(definitions: Any) -> None:
    if not isinstance(definitions, list):
        return
    for definition in definitions:
        if not isinstance(definition, Mapping):
            continue
        definition.pop("defaultValue", None)
        repeat = definition.get("repeatDefinition")
        if isinstance(repeat, Mapping):
            _remove_parameter_defaults(repeat.get("itemParameterDefinitions", []))
