"""Pure horizontal layout planning, independent of process execution."""
from __future__ import annotations

import math
from collections.abc import Sequence

from .contracts import ComponentHint, SchematicLayoutGroup, SchematicLayoutPlan, SchematicSlot


def _positive_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def _validate_layout_plan(plan: SchematicLayoutPlan) -> None:
    if not isinstance(plan, SchematicLayoutPlan) or not _positive_number(plan.width):
        raise ValueError("Invalid schematic layout plan width")
    support_width = plan.width - 72.0 if plan.support_width is None else plan.support_width
    if (not isinstance(plan.support_x, (int, float)) or not math.isfinite(plan.support_x)
            or plan.support_x < 0 or not _positive_number(support_width)
            or plan.support_x + support_width > plan.width):
        raise ValueError("Invalid schematic layout support span")
    if not isinstance(plan.fingerprint, str) or not all(isinstance(note, str) for note in plan.notes):
        raise ValueError("Invalid schematic layout metadata")
    ids = set()
    for slot in plan.slots:
        if (not isinstance(slot, SchematicSlot) or not isinstance(slot.id, str) or not slot.id
                or slot.id in ids or not isinstance(slot.group_key, str) or not slot.group_key
                or not isinstance(slot.x, (int, float)) or not math.isfinite(slot.x)
                or isinstance(slot.x, bool) or slot.x < 0 or not _positive_number(slot.width)
                or slot.x + slot.width > plan.width):
            raise ValueError("Invalid schematic layout slot")
        ids.add(slot.id)
    previous_right = None
    for slot in sorted(plan.slots, key=lambda item: item.x):
        if previous_right is not None and slot.x < previous_right:
            raise ValueError("Overlapping schematic layout slots")
        previous_right = slot.x + slot.width


def make_layout_plan(
    groups: Sequence[SchematicLayoutGroup], *, fingerprint: str = "", notes: Sequence[str] = (),
) -> SchematicLayoutPlan:
    """Reserve every cohort before rendering any individual snapshot."""
    groups = tuple(groups)
    keys = set()
    for group in groups:
        if (not isinstance(group, SchematicLayoutGroup) or not isinstance(group.key, str) or not group.key
                or group.key in keys or not isinstance(group.hint, ComponentHint)
                or not isinstance(group.hint.representative_count, int)
                or isinstance(group.hint.representative_count, bool) or group.hint.representative_count < 1):
            raise ValueError("Invalid schematic layout group")
        keys.add(group.key)
    edge_groups = [group for group in groups if group.hint.placement == "edges"]
    center_groups = [group for group in groups if group.hint.placement != "edges"]
    die_width, edge_die_width, gap = 320.0, 224.0, 24.0
    # Reserve the larger edge for odd counts as well as the common two-edge case.
    edge_space = sum(((min(12, group.hint.representative_count) + 1) // 2) * (edge_die_width + gap)
                     for group in edge_groups)
    center_count = sum(min(12, group.hint.representative_count) for group in center_groups)
    width = max(1000.0, 96.0 + edge_space * 2 + center_count * (die_width + gap))
    slots = []
    left, right = 48.0, width - 48.0
    for group in edge_groups:
        for index in range(min(12, group.hint.representative_count)):
            if index % 2 == 0:
                x = left
                left += edge_die_width + gap
            else:
                right -= edge_die_width
                x = right
                right -= gap
            slots.append(SchematicSlot(f"{group.key}:representative:{index + 1}", group.key, x, edge_die_width))
    center_width = center_count * die_width + max(center_count - 1, 0) * gap
    cursor = left + max(0, (right - left - center_width) / 2)
    for group in center_groups:
        for index in range(min(12, group.hint.representative_count)):
            slots.append(SchematicSlot(f"{group.key}:representative:{index + 1}", group.key, cursor, die_width))
            cursor += die_width + gap
    plan = SchematicLayoutPlan(tuple(sorted(slots, key=lambda slot: slot.x)), width,
                               fingerprint=fingerprint, notes=tuple(notes))
    _validate_layout_plan(plan)
    return plan
