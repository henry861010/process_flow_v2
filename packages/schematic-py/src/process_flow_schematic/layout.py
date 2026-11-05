"""Pure horizontal layout planning, independent of process execution."""
from __future__ import annotations

import math
from dataclasses import replace
from collections.abc import Sequence

from .contracts import ComponentHint, SchematicLayoutGroup, SchematicLayoutPlan, SchematicSlot


# Keep 144 display units inside the default support span, which starts at x=36.
COMPONENT_EDGE_INSET = 180.0
COMPONENT_GAP = 36.0


def representation_for_role(role: str) -> tuple[int, str]:
    """The shared display policy, never a physical placement count."""
    return (2, "edges") if role == "wafer-dmy" else (1, "center")


def resolve_component_hint(hint: ComponentHint) -> ComponentHint:
    if not hint.role:
        return hint
    count, placement = representation_for_role(hint.role)
    return replace(hint, representative_count=count, placement=placement)


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
    previous_right = {}
    for slot in sorted(plan.slots, key=lambda item: (item.region_id, item.x)):
        if slot.region_id in previous_right and slot.x < previous_right[slot.region_id]:
            raise ValueError("Overlapping schematic layout slots")
        previous_right[slot.region_id] = slot.x + slot.width
    feature_ids = set()
    for feature in plan.features:
        if (not feature.object_id or feature.object_id in feature_ids
                or not _positive_number(feature.width)
                or any(not isinstance(x, (int, float)) or isinstance(x, bool) or not math.isfinite(x)
                       or x - feature.width / 2 < 0 or x + feature.width / 2 > plan.width
                       for x in feature.centers)):
            raise ValueError("Invalid distributed feature layout")
        feature_ids.add(feature.object_id)


def make_layout_plan(
    groups: Sequence[SchematicLayoutGroup], *, fingerprint: str = "", notes: Sequence[str] = (),
) -> SchematicLayoutPlan:
    """Compatibility adapter over the semantic scene layout kernel.

    Callers with named semantic roles use the same central representation policy
    as flow scenes. Explicit counts on older, untyped hints remain supported as
    adapter policy, never as a second coordinate-allocation implementation.
    """
    from .scene import LayoutRegion, SceneState, SchematicObject, namespace_id
    from .scene_layout import SceneLayoutPolicy, make_scene_layout_plan

    groups = tuple(groups)
    keys = set()
    for group in groups:
        if (not isinstance(group, SchematicLayoutGroup) or not isinstance(group.key, str) or not group.key
                or group.key in keys or not isinstance(group.hint, ComponentHint)
                or not isinstance(group.hint.representative_count, int)
                or isinstance(group.hint.representative_count, bool) or group.hint.representative_count < 1):
            raise ValueError("Invalid schematic layout group")
        keys.add(group.key)
    assembly_id = namespace_id("flat-layout", "assembly")
    region_id = namespace_id("flat-layout", "region")
    members = tuple(SchematicObject(
        namespace_id("flat-layout-member", group.key), "component", group.hint.role or "component",
        group.hint.label or "Component", parent_id=assembly_id, group_key=group.key,
        layout="member", region_id=region_id,
    ) for group in groups)
    state = SceneState(
        objects=(SchematicObject(assembly_id, "assembly", "assembly", "Assembly"), *members),
        regions=(LayoutRegion(region_id, assembly_id),), notes=tuple(notes),
    )
    legacy_rules = tuple((group.key, min(12, group.hint.representative_count),
                          "edges" if group.hint.placement == "edges" else "center")
                         for group in groups if not group.hint.role)
    scene_plan = make_scene_layout_plan(state, fingerprint=fingerprint,
                                        policy=SceneLayoutPolicy(group_representations=legacy_rules))
    plan = SchematicLayoutPlan(
        tuple(SchematicSlot(slot.id, slot.group_key, slot.x, slot.width)
              for slot in sorted(scene_plan.slots, key=lambda slot: slot.x)),
        scene_plan.width, fingerprint=fingerprint, notes=scene_plan.notes,
    )
    _validate_layout_plan(plan)
    return plan
