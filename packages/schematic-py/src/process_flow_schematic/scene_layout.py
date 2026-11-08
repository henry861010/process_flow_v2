"""Deterministic horizontal planning for semantic schematic scenes.

The planner knows member, span, distribution and boundary intents. It never
imports process programs, runs geometry operations, or predicts physical Z.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from .layout import representation_for_role
from .scene import SceneState, SchematicObject, validate_scene

SCENE_LAYOUT_POLICY_VERSION = 4


@dataclass(frozen=True)
class SceneLayoutPolicy:
    minimum_width: float = 1000.0
    support_margin: float = 36.0
    member_width: float = 320.0
    edge_member_width: float = 224.0
    member_gap: float = 36.0
    region_inset: float = 144.0
    local_inset: float = 36.0
    feature_clearance: float = 12.0
    feature_width: float = 12.0
    feature_count: int = 9
    boundary_width: float = 24.0
    edge_inset: float = 36.0
    # Adapter-only compatibility for callers of the original flat layout API.
    # Counts remain policy data; semantic scene objects never carry quantities.
    group_representations: tuple[tuple[str, int, str], ...] = ()

    def __post_init__(self):
        object.__setattr__(self, "group_representations", tuple(tuple(value) for value in self.group_representations))
        keys = set()
        for entry in self.group_representations:
            if len(entry) != 3:
                raise ValueError("Invalid group representation policy")
            key, count, placement = entry
            if (not isinstance(key, str) or not key or key in keys or isinstance(count, bool)
                    or not isinstance(count, int) or count < 1 or placement not in ("center", "edges")):
                raise ValueError("Invalid group representation policy")
            keys.add(key)
        for name, value in vars(self).items():
            if name == "group_representations":
                continue
            if name == "feature_count":
                if isinstance(value, bool) or not isinstance(value, int) or value < 1:
                    raise ValueError("Feature count must be a positive integer")
            elif isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError(f"Invalid scene layout policy: {name}")


@dataclass(frozen=True)
class SceneMemberSlot:
    id: str
    object_id: str
    group_key: str
    region_id: str
    x: float
    width: float
    object_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class SceneRegionPlacement:
    region_id: str
    x: float
    width: float


@dataclass(frozen=True)
class SceneFeaturePlacement:
    object_id: str
    source_ref: str | None
    region_id: str
    layout: str
    intervals: tuple[tuple[float, float], ...]
    centers: tuple[float, ...] = ()
    width: float = 0.0


@dataclass(frozen=True)
class SceneRelationPlacement:
    relation_id: str
    subject_id: str
    kind: str
    intervals: tuple[tuple[float, float], ...]


@dataclass(frozen=True)
class SceneLayoutPlan:
    slots: tuple[SceneMemberSlot, ...]
    features: tuple[SceneFeaturePlacement, ...]
    regions: tuple[SceneRegionPlacement, ...]
    width: float
    fingerprint: str = ""
    notes: tuple[str, ...] = ()
    relations: tuple[SceneRelationPlacement, ...] = ()


def merge_scene_states(states: Sequence[SceneState]) -> SceneState:
    """Reserve all objects seen in one phase, including subsequently removed ones."""
    objects, regions, relations = {}, {}, {}
    notes, derivations = [], []
    phase_id = None
    for state in states:
        validate_scene(state)
        if phase_id is not None and state.phase_id != phase_id:
            raise ValueError("Plan different assembly phases separately")
        phase_id = state.phase_id
        for obj in state.objects:
            objects[obj.id] = obj
        for region in state.regions:
            existing = regions.get(region.id)
            if existing is not None and (existing.owner_id, existing.parent_region_id) != (region.owner_id, region.parent_region_id):
                raise ValueError(f"Region identity changed within a phase: {region.id}")
            regions[region.id] = region
        for relation in state.relations:
            relations[relation.id] = relation
        notes.extend(state.notes)
        derivations.extend(state.derivations)
    merged = SceneState(objects=tuple(objects.values()), regions=tuple(regions.values()),
                        relations=tuple(relations.values()), phase_id=phase_id or "default",
                        notes=tuple(dict.fromkeys(notes)), derivations=tuple(dict.fromkeys(derivations)))
    validate_scene(merged)
    return merged


def subtract_intervals(intervals: Sequence[tuple[float, float]],
                       exclusions: Sequence[tuple[float, float]]) -> tuple[tuple[float, float], ...]:
    """Subtract ordered or overlapping intervals; retain only positive spans."""
    for lower, upper in (*intervals, *exclusions):
        if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
                   for value in (lower, upper)) or upper < lower:
            raise ValueError("Invalid horizontal interval")
    remaining = [(lower, upper) for lower, upper in intervals if upper > lower]
    for cut_lower, cut_upper in sorted(exclusions):
        next_remaining = []
        for lower, upper in remaining:
            if cut_upper <= lower or cut_lower >= upper:
                next_remaining.append((lower, upper))
            else:
                if lower < cut_lower:
                    next_remaining.append((lower, cut_lower))
                if cut_upper < upper:
                    next_remaining.append((cut_upper, upper))
        remaining = next_remaining
    return tuple(sorted(remaining))


def _centers(intervals, count, symbol_width):
    """Equal cumulative-length centers, projected only when geometry requires it.

    Complete symbols need half-width clearance at each interval endpoint. A
    forward/backward feasible envelope preserves the requested count whenever
    it fits at the minimum pitch, including isolated symbol-width intervals.
    """
    merged = []
    for lower, upper in sorted(intervals):
        if merged and lower <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(upper, merged[-1][1]))
        else:
            merged.append((lower, upper))
    available = [(lower, upper) for lower, upper in merged if upper - lower >= symbol_width]
    domains = [(lower + symbol_width / 2, upper - symbol_width / 2) for lower, upper in available]
    pitch = symbol_width * 1.5
    tolerance = 1e-12 * max((abs(value) for interval in available for value in interval), default=1.0)

    def next_allowed(value):
        for lower, upper in domains:
            if value <= upper + tolerance:
                return min(upper, max(lower, value))
        return None

    def previous_allowed(value):
        for lower, upper in reversed(domains):
            if value >= lower - tolerance:
                return max(lower, min(upper, value))
        return None

    earliest = []
    for _ in range(count):
        center = next_allowed(earliest[-1] + pitch if earliest else -math.inf)
        if center is None:
            break
        earliest.append(center)
    count = len(earliest)
    if not count:
        return ()
    latest = []
    for _ in range(count):
        latest.append(previous_allowed(latest[-1] - pitch if latest else math.inf))
    latest.reverse()
    total_length = sum(upper - lower for lower, upper in available)
    result = []
    for index in range(count):
        distance = (index + 0.5) * total_length / count
        ideal = available[-1][1]
        for lower, upper in available:
            if distance <= upper - lower:
                ideal = lower + distance
                break
            distance -= upper - lower
        lower_bound = max(earliest[index], result[-1] + pitch if result else -math.inf)
        upper_bound = latest[index]
        candidates = [min(upper, max(lower, min(upper_bound, max(ideal, lower_bound))))
                      for lower, upper in domains if max(lower, lower_bound) <= min(upper, upper_bound) + tolerance]
        # Earliest/latest bounds guarantee a candidate and enough remaining
        # room for every later symbol. Ties choose the leftmost valid center.
        result.append(min(candidates, key=lambda value: (abs(value - ideal), value)))
    return tuple(result)


def make_scene_layout_plan(scene: SceneState | Sequence[SceneState], *, fingerprint: str = "",
                           policy: SceneLayoutPolicy | None = None) -> SceneLayoutPlan:
    """Pack each region once and distribute features around its reserved slots.

    Declaration order is retained; callers supply deterministic topological
    order. Physical placement counts and recipe XY never enter this function.
    """
    state = scene if isinstance(scene, SceneState) else merge_scene_states(scene)
    validate_scene(state)
    policy = policy or SceneLayoutPolicy()
    representations = {key: (count, placement) for key, count, placement in policy.group_representations}

    def representation(obj):
        return representations.get(obj.group_key or obj.id, representation_for_role(obj.role))

    objects, regions = state.object_map, state.region_map
    groups: dict[str, dict[str, list[SchematicObject]]] = {region.id: {} for region in state.regions}

    def structural_ancestor(obj):
        parent_id = obj.parent_id
        while parent_id is not None:
            parent = objects[parent_id]
            if parent.layout == "member" and parent.nesting == "structural":
                return parent
            parent_id = parent.parent_id
        return None

    for obj in state.objects:
        if obj.layout == "member" and structural_ancestor(obj) is None:
            groups[obj.region_id].setdefault(obj.group_key or obj.id, []).append(obj)
    relations_by_subject = {}
    for relation in state.relations:
        relations_by_subject.setdefault(relation.subject_id, []).append(relation)

    def is_local_region(region_id):
        owner = objects[regions[region_id].owner_id]
        while True:
            if owner.layout == "member":
                return True
            if owner.parent_id is None:
                return False
            owner = objects[owner.parent_id]

    def region_inset(region_id):
        inset = policy.local_inset if is_local_region(region_id) else policy.region_inset
        # Free distributions need enough room beside reserved members. Holding
        # this much space at each edge guarantees the full symbol budget even
        # when every inter-member gap is too narrow for a symbol.
        has_free_distribution = any(obj.region_id == region_id and obj.layout == "distributed"
                                    and structural_ancestor(obj) is None
                                    and not any(relation.kind in ("attached_to", "connects")
                                                for relation in relations_by_subject.get(obj.id, ()))
                                    for obj in state.objects)
        if has_free_distribution:
            inset = max(inset, policy.feature_clearance
                        + math.ceil(policy.feature_count / 2) * policy.feature_width * 1.5)
        return inset
    owned_regions: dict[str, list[str]] = {}
    for region in state.regions:
        owned_regions.setdefault(region.owner_id, []).append(region.id)
    preferred: dict[str, float] = {}
    active: set[str] = set()

    def member_width(obj):
        _, placement = representation(obj)
        base = policy.edge_member_width if placement == "edges" else policy.member_width
        if obj.nesting == "arranged":
            base = max([base, *(preferred_width(region_id) for region_id in owned_regions.get(obj.id, ())
                               if region_id != obj.region_id)])
        return base

    def preferred_width(region_id):
        if region_id in preferred:
            return preferred[region_id]
        if region_id in active:
            raise ValueError("Cyclic region ownership layout")
        active.add(region_id)
        members = [members[0] for members in groups[region_id].values()]
        widths = [(member_width(obj), representation(obj)[0]) for obj in members]
        count = sum(count for _, count in widths)
        is_local = is_local_region(region_id)
        inset = region_inset(region_id)
        needed = sum(width * count for width, count in widths) + max(0, count - 1) * policy.member_gap + 2 * inset
        if any(representation(obj)[1] == "edges" for obj in members):
            needed += 2 * policy.edge_inset
        # Non-member-owned surfaces share their parent's horizontal frame.
        # A coating/RDL surface can carry more members than the lower surface;
        # propagate that demand through a compound's local content region.
        needed = max([needed, *(preferred_width(child.id) for child in state.regions
                                if child.parent_region_id == region_id
                                and objects[child.owner_id].layout != "member")])
        preferred[region_id] = max(policy.member_width if is_local else policy.minimum_width - 2 * policy.support_margin, needed)
        active.remove(region_id)
        return preferred[region_id]

    for region in state.regions:
        preferred_width(region.id)
    root_regions = [region for region in state.regions if region.parent_region_id is None
                    and objects[region.owner_id].layout != "member"]
    # A later deposition region can need more slots than the initial root.
    # Every region sharing the assembly frame contributes to its fixed width.
    width = max([policy.minimum_width, *(preferred[region.id] + 2 * policy.support_margin
                                         for region in state.regions if not is_local_region(region.id)
                                         or region.parent_region_id is None)])
    region_placements: dict[str, SceneRegionPlacement] = {}
    slots: list[SceneMemberSlot] = []
    object_slots: dict[str, list[SceneMemberSlot]] = {}
    edge_keepouts: dict[str, tuple[tuple[float, float], ...]] = {}
    planning: set[str] = set()

    def plan_region(region_id, x, region_width):
        if region_id in region_placements:
            return
        if region_id in planning:
            raise ValueError("Cyclic scene layout")
        planning.add(region_id)
        region_placements[region_id] = SceneRegionPlacement(region_id, x, region_width)
        inset = region_inset(region_id)
        left, right = x + inset, x + region_width - inset
        members = list(groups[region_id].items())
        edge = [(key, cohort) for key, cohort in members if representation(cohort[0])[1] == "edges"]
        center = [(key, cohort) for key, cohort in members if representation(cohort[0])[1] != "edges"]
        if edge:
            # Leave a small empty wafer rim outside the warpage-control pair.
            # Reserve the remaining inset space inside for free features.
            left, right = x + policy.edge_inset, x + region_width - policy.edge_inset
            edge_keepouts[region_id] = ((x, left), (right, x + region_width))

        def append(key, cohort, index, slot_x, slot_width):
            obj = cohort[0]
            slot = SceneMemberSlot(f"{key}:representative:{index + 1}", obj.id, key, region_id,
                                   slot_x, slot_width, tuple(item.id for item in cohort))
            slots.append(slot)
            for item in cohort:
                object_slots.setdefault(item.id, []).append(slot)

        for key, cohort in edge:
            slot_width = member_width(cohort[0])
            for index in range(representation(cohort[0])[0]):
                if index % 2 == 0:
                    append(key, cohort, index, left, slot_width)
                    left += slot_width + policy.member_gap
                else:
                    right -= slot_width
                    append(key, cohort, index, right, slot_width)
                    right -= policy.member_gap
        center_count = sum(representation(cohort[0])[0] for _, cohort in center)
        center_width = sum(member_width(cohort[0]) * representation(cohort[0])[0] for _, cohort in center)
        center_width += max(0, center_count - 1) * policy.member_gap
        cursor = left + max(0.0, (right - left - center_width) / 2)
        for key, cohort in center:
            slot_width = member_width(cohort[0])
            for index in range(representation(cohort[0])[0]):
                append(key, cohort, index, cursor, slot_width)
                cursor += slot_width + policy.member_gap
        # Regions owned by a representative are local. A repeated representative
        # has one canonical internal plan; a renderer repeats its local content.
        for _, cohort in members:
            owner_slots = object_slots.get(cohort[0].id, ())
            if not owner_slots:
                continue
            owner_slot = owner_slots[0]
            for obj in cohort:
                for child_region_id in owned_regions.get(obj.id, ()):
                    if child_region_id != region_id:
                        plan_region(child_region_id, owner_slot.x, owner_slot.width)
        for child_region in state.regions:
            if child_region.parent_region_id == region_id and child_region.id not in region_placements:
                owner = objects[child_region.owner_id]
                owner_slot = next(iter(object_slots.get(owner.id, ())), None)
                plan_region(child_region.id, owner_slot.x if owner_slot else x,
                            owner_slot.width if owner_slot else region_width)
        planning.remove(region_id)

    for region in root_regions:
        plan_region(region.id, policy.support_margin, width - 2 * policy.support_margin)
    # A standalone component can own the only region in a scene.
    for region in state.regions:
        if region.id not in region_placements:
            owner_slot = next(iter(object_slots.get(region.owner_id, ())), None)
            plan_region(region.id, owner_slot.x if owner_slot else policy.support_margin,
                        owner_slot.width if owner_slot else width - 2 * policy.support_margin)

    def object_intervals(object_id):
        own_slots = object_slots.get(object_id)
        if own_slots:
            return tuple((slot.x, slot.x + slot.width) for slot in own_slots)
        obj = objects[object_id]
        ancestor = structural_ancestor(obj)
        if ancestor is not None and object_slots.get(ancestor.id):
            return object_intervals(ancestor.id)
        region_id = obj.region_id or next(iter(owned_regions.get(obj.id, ())), None)
        if region_id in region_placements:
            region = region_placements[region_id]
            return ((region.x, region.x + region.width),)
        return ()

    features = []
    relation_placements = []
    notes = list(state.notes)
    for obj in state.objects:
        if obj.layout not in ("span", "distributed", "boundary"):
            continue
        region = region_placements[obj.region_id]
        intervals = ((region.x, region.x + region.width),)
        ancestor = structural_ancestor(obj)
        if ancestor is not None:
            intervals = object_intervals(ancestor.id) or intervals
        relations = relations_by_subject.get(obj.id, ())
        attached = any(relation.kind in ("attached_to", "connects") for relation in relations)
        occupied = [(slot.x, slot.x + slot.width) for slot in slots if slot.region_id == obj.region_id
                    and not attached and (ancestor is None or ancestor.id not in slot.object_ids)]
        explicit_exclusions = []
        for relation in relations:
            target_intervals = tuple(interval for target in relation.targets for interval in object_intervals(target.object_id))
            if relation.kind in ("covers", "surrounds", "fills", "inside") and relation.region_id is not None:
                target_region = region_placements[relation.region_id]
                intervals = ((target_region.x, target_region.x + target_region.width),)
            if relation.kind in ("excludes", "fills"):
                explicit_exclusions.extend(target_intervals)
            elif relation.kind in ("attached_to", "connects") and target_intervals:
                intervals = ((min(lower for lower, _ in target_intervals), max(upper for _, upper in target_intervals)),)
            relation_placements.append(SceneRelationPlacement(relation.id, obj.id, relation.kind, intervals))
        if obj.layout == "distributed":
            blockers = [(lower - policy.feature_clearance, upper + policy.feature_clearance)
                        for lower, upper in (*occupied, *explicit_exclusions,
                                             *edge_keepouts.get(obj.region_id, ()))]
            intervals = subtract_intervals(intervals, blockers)
            center_intervals = intervals
            ancestor_slots = object_slots.get(ancestor.id, ()) if ancestor is not None else ()
            if len(ancestor_slots) > 1:
                # Repeated representatives share one local motif. Transport
                # consumers translate these canonical centers into each slot;
                # including all slots here would repeat the other slots again.
                canonical = ancestor_slots[0]
                center_intervals = tuple((max(lower, canonical.x), min(upper, canonical.x + canonical.width))
                                         for lower, upper in intervals
                                         if lower < canonical.x + canonical.width and upper > canonical.x)
            centers = _centers(center_intervals, policy.feature_count, policy.feature_width)
            if len(centers) < policy.feature_count:
                notes.append(f"Feature {obj.id} has explicit spatial constraints that leave room for only {len(centers)} symbols.")
            features.append(SceneFeaturePlacement(obj.id, obj.source_ref, obj.region_id, obj.layout,
                                                   intervals, centers, policy.feature_width))
        elif obj.layout == "boundary":
            lower, upper = intervals[0]
            thickness = min(policy.boundary_width, (upper - lower) / 4)
            intervals = ((lower, lower + thickness), (upper - thickness, upper))
            features.append(SceneFeaturePlacement(obj.id, obj.source_ref, obj.region_id, obj.layout, intervals))
        else:
            if any(relation.kind == "fills" for relation in relations):
                explicit_exclusions.extend(occupied)
            intervals = subtract_intervals(intervals, explicit_exclusions)
            features.append(SceneFeaturePlacement(obj.id, obj.source_ref, obj.region_id, obj.layout, intervals))
    return SceneLayoutPlan(tuple(slots), tuple(features), tuple(region_placements.values()), width,
                           fingerprint, tuple(dict.fromkeys(notes)), tuple(relation_placements))
