#!/usr/bin/env python3
"""Validate and execute the canonical PnP example in docs/data-model.md."""

from __future__ import annotations

import json
import re
from pathlib import Path

from process_flow_api.models import (
    ProcessFlowInstance,
    ProcessFlowTemplate,
    ProcessStepTemplate,
)
from process_flow_kernel import (
    FlowCompiler,
    GeometryKernel,
    validate_flow_graph,
    validate_process_step_template,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_MODEL = REPO_ROOT / "docs/data-model.md"
GEOMETRY_FIXTURES = (
    REPO_ROOT / "apps/api/src/process_flow_api/fixtures/geometries.json"
)
SECTION_START = "## 14. 可完整執行的 PnP golden example"
SECTION_END = "## 15."


class FixtureGeometryCatalog:
    def __init__(self, geometries: list[dict]) -> None:
        self._geometries = {item["id"]: item for item in geometries}

    def get_geometry(self, geometry_id: str) -> dict | None:
        return self._geometries.get(geometry_id)


def load_golden_documents() -> tuple[dict, dict, dict]:
    text = DATA_MODEL.read_text(encoding="utf-8")
    if SECTION_START not in text or SECTION_END not in text.split(SECTION_START, 1)[1]:
        raise AssertionError("PnP golden-example section markers are missing")
    section = text.split(SECTION_START, 1)[1].split(SECTION_END, 1)[0]
    blocks = [
        json.loads(block)
        for block in re.findall(r"```json\n(.*?)\n```", section, re.DOTALL)
    ]
    if len(blocks) != 3:
        raise AssertionError(
            f"Expected 3 JSON documents in the PnP golden example, found {len(blocks)}"
        )
    return blocks[0], blocks[1], blocks[2]


def main() -> int:
    raw_step, raw_template, raw_instance = load_golden_documents()
    step = ProcessStepTemplate.model_validate(raw_step).payload()
    template = ProcessFlowTemplate.model_validate(raw_template).payload()
    instance = ProcessFlowInstance.model_validate(raw_instance).payload()

    validate_process_step_template(step)
    validate_flow_graph(template, [step])

    fixtures = json.loads(GEOMETRY_FIXTURES.read_text(encoding="utf-8"))
    plan = FlowCompiler(FixtureGeometryCatalog(fixtures)).compile(
        template,
        instance,
        [step],
    )
    assert tuple(plan.terminal_step_ref_ids) == ("pnp",)
    assert [item.step_ref_id for item in plan.steps] == ["pnp"]
    assert set(plan.external_geometries) == {"incoming_panel", "incoming_die"}

    result = GeometryKernel().execute(plan)
    assert result.terminal_step_ref_ids() == ["pnp"]
    assert set(result.step_outputs()) == {"pnp"}

    geometry = result.geometry()
    assert geometry["schemaVersion"] == "1.0.0"
    assert geometry["unitSystem"] == "um"
    assert len(geometry["root"]["children"]) == 2
    print("PnP golden example passed Pydantic, graph, compiler, and kernel validation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
