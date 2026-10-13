"""Shared conversion of the retired Bump Joint catalog and its references."""
from __future__ import annotations

import copy
from collections.abc import Iterable
from typing import Any

from .seed import load_seed_fixtures

LEGACY_JOINT_ID = "step_tpl_bump_joint"
MR_JOINT_ID = "step_tpl_mr_joint"
TCB_JOINT_ID = "step_tpl_tcb_joint"


def migrate_joint_templates(templates: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    templates = copy.deepcopy(list(templates))
    by_id = {template["id"]: template for template in templates}
    canonical = {
        template["id"]: template
        for template in load_seed_fixtures()["processStepTemplates"]
        if template["id"] in (MR_JOINT_ID, TCB_JOINT_ID)
    }
    old = by_id.get(LEGACY_JOINT_ID)
    mr = copy.deepcopy(old if old is not None else canonical[MR_JOINT_ID])
    mr.update(id=MR_JOINT_ID, name="MR joint", category="joint", program="joint/mr_joint")
    for replacement in (mr, canonical[TCB_JOINT_ID]):
        existing = by_id.get(replacement["id"])
        if existing is not None:
            if existing != replacement:
                raise ValueError(f"Joint migration conflict: incompatible template {replacement['id']}")
        else:
            templates.append(replacement)
    return [template for template in templates if template["id"] != LEGACY_JOINT_ID]


def migrate_joint_ref(step_ref: dict[str, Any]) -> bool:
    if step_ref.get("processStepTemplateId") != LEGACY_JOINT_ID:
        return False
    step_ref["processStepTemplateId"] = MR_JOINT_ID
    if step_ref.get("stepLabel") == "Bump Joint":
        step_ref["stepLabel"] = "MR joint"
    return True


def migrate_joint_flow(flow: dict[str, Any]) -> bool:
    changed = False
    for step_ref in flow.get("stepRefs", []):
        changed = migrate_joint_ref(step_ref) or changed
    return changed


def migrate_joint_draft(draft: dict[str, Any]) -> bool:
    changed = False
    for node in draft["state"].get("nodes", []):
        if node.get("kind") == "processStep":
            changed = migrate_joint_ref(node["stepRef"]) or changed
    return changed
