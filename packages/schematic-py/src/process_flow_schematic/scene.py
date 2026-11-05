"""Immutable schematic semantics, independent of physical geometry execution.

Objects describe what occupies a region; only the layout kernel gives them X
coordinates. Physical samples are bound from the selected snapshot, never from
the abstract lookahead state.
"""
from __future__ import annotations

import hashlib
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Literal

SCENE_VERSION = 1


@dataclass(frozen=True)
class AnchorSpec:
    name: str
    kind: Literal["physical-face", "region-boundary"] = "physical-face"
    source_ref: str | None = None
    side: Literal["lower", "upper", "left", "right"] | None = None


@dataclass(frozen=True)
class AnchorRef:
    object_id: str
    anchor: str = "surface"


@dataclass(frozen=True)
class SchematicObject:
    id: str
    kind: Literal["assembly", "component", "body", "feature"]
    role: str
    label: str
    parent_id: str | None = None
    source_ref: str | None = None
    class_key: str | None = None
    group_key: str | None = None
    layout: Literal["group", "member", "span", "distributed", "boundary"] = "group"
    region_id: str | None = None
    nesting: Literal["structural", "arranged"] = "structural"
    symbol: str | None = None
    color_role: str = "generic"
    anchors: tuple[AnchorSpec, ...] = ()
    symbol_version: int = 1
    fill_override: str | None = None
    diagram_label: str | None = None

    def __post_init__(self):
        object.__setattr__(self, "anchors", tuple(self.anchors))

    @property
    def physical_ref(self) -> str | None:
        return self.source_ref


SceneObject = SchematicObject


@dataclass(frozen=True)
class LayoutRegion:
    id: str
    owner_id: str
    anchor: str = "mount"
    parent_region_id: str | None = None


SceneRegion = LayoutRegion


@dataclass(frozen=True)
class SceneRelation:
    id: str
    kind: Literal["attached_to", "connects", "inside", "excludes", "fills", "surrounds", "covers"]
    subject_id: str
    targets: tuple[AnchorRef, ...] = ()
    region_id: str | None = None

    def __post_init__(self):
        object.__setattr__(self, "targets", tuple(self.targets))


@dataclass(frozen=True)
class SceneDerivation:
    source_object_id: str
    target_object_id: str
    input_port_id: str | None = None
    kind: Literal["copy", "crop", "split", "merge", "preserve", "transform"] = "copy"


@dataclass(frozen=True)
class SceneReparent:
    object_id: str
    parent_id: str | None


@dataclass(frozen=True)
class SceneState:
    objects: tuple[SchematicObject, ...] = ()
    regions: tuple[LayoutRegion, ...] = ()
    relations: tuple[SceneRelation, ...] = ()
    cursor_region_id: str | None = None
    orientation: int = 1
    phase_id: str = "default"
    derivations: tuple[SceneDerivation, ...] = ()
    notes: tuple[str, ...] = ()

    def __post_init__(self):
        for name in ("objects", "regions", "relations", "derivations", "notes"):
            object.__setattr__(self, name, tuple(getattr(self, name)))

    @property
    def object_map(self) -> Mapping[str, SchematicObject]:
        return MappingProxyType({obj.id: obj for obj in self.objects})

    @property
    def region_map(self) -> Mapping[str, LayoutRegion]:
        return MappingProxyType({region.id: region for region in self.regions})

    @property
    def relation_map(self) -> Mapping[str, SceneRelation]:
        return MappingProxyType({relation.id: relation for relation in self.relations})


@dataclass(frozen=True)
class SchematicDelta:
    creates: tuple[SchematicObject, ...] = ()
    updates: tuple[SchematicObject, ...] = ()
    removes: tuple[str, ...] = ()
    reparents: tuple[SceneReparent, ...] = ()
    add_regions: tuple[LayoutRegion, ...] = ()
    add_relations: tuple[SceneRelation, ...] = ()
    remove_relations: tuple[str, ...] = ()
    cursor_region_id: str | None = None
    orientation: int | None = None
    phase_id: str | None = None
    derivations: tuple[SceneDerivation, ...] = ()
    clear_cursor: bool = False
    notes: tuple[str, ...] = ()
    update_regions: tuple[LayoutRegion, ...] = ()
    remove_regions: tuple[str, ...] = ()
    update_relations: tuple[SceneRelation, ...] = ()

    def __post_init__(self):
        for name in ("creates", "updates", "removes", "reparents", "add_regions", "add_relations", "remove_relations",
                     "derivations", "notes", "update_regions", "remove_regions", "update_relations"):
            object.__setattr__(self, name, tuple(getattr(self, name)))


def _name(value: object, label: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty string")


def _optional_name(value: object, label: str) -> None:
    if value is not None:
        _name(value, label)


def _unique(values: Sequence, label: str) -> dict:
    result = {}
    for value in values:
        _name(value.id, f"{label} id")
        if value.id in result:
            raise ValueError(f"Duplicate {label} id: {value.id}")
        result[value.id] = value
    return result


def _acyclic(parents: Mapping[str, str | None], label: str) -> None:
    complete: set[str] = set()
    for start in parents:
        visiting: set[str] = set()
        current: str | None = start
        while current is not None and current not in complete:
            if current in visiting:
                raise ValueError(f"Cyclic {label}: {current}")
            visiting.add(current)
            current = parents[current]
        complete.update(visiting)


def validate_scene(state: SceneState) -> None:
    if not isinstance(state, SceneState):
        raise ValueError("Expected SceneState")
    if any(not isinstance(obj, SchematicObject) for obj in state.objects):
        raise ValueError("Invalid schematic object")
    if any(not isinstance(region, LayoutRegion) for region in state.regions):
        raise ValueError("Invalid schematic region")
    if any(not isinstance(relation, SceneRelation) for relation in state.relations):
        raise ValueError("Invalid schematic relation")
    objects = _unique(state.objects, "object")
    regions = _unique(state.regions, "region")
    _unique(state.relations, "relation")
    _name(state.phase_id, "phase id")
    if not all(isinstance(note, str) for note in state.notes):
        raise ValueError("Scene notes must be strings")
    if isinstance(state.orientation, bool) or state.orientation not in (-1, 1):
        raise ValueError("Scene orientation must be -1 or 1")
    if state.cursor_region_id is not None and state.cursor_region_id not in regions:
        raise ValueError("Unknown cursor region")
    for obj in state.objects:
        if obj.kind not in ("assembly", "component", "body", "feature"):
            raise ValueError(f"Unknown object kind: {obj.kind}")
        if obj.layout not in ("group", "member", "span", "distributed", "boundary"):
            raise ValueError(f"Unknown layout intent: {obj.layout}")
        if obj.nesting not in ("structural", "arranged"):
            raise ValueError(f"Unknown nesting: {obj.nesting}")
        for name in ("role", "label", "color_role"):
            _name(getattr(obj, name), name)
        for name in ("parent_id", "source_ref", "class_key", "group_key", "region_id", "symbol", "fill_override", "diagram_label"):
            _optional_name(getattr(obj, name), name)
        if isinstance(obj.symbol_version, bool) or not isinstance(obj.symbol_version, int) or obj.symbol_version < 1:
            raise ValueError("Symbol version must be a positive integer")
        if obj.parent_id is not None and obj.parent_id not in objects:
            raise ValueError(f"Unknown parent for {obj.id}: {obj.parent_id}")
        if obj.region_id is not None and obj.region_id not in regions:
            raise ValueError(f"Unknown region for {obj.id}: {obj.region_id}")
        if obj.layout != "group" and obj.region_id is None:
            raise ValueError(f"Layout object {obj.id} needs a region")
        names = set()
        for anchor in obj.anchors:
            if not isinstance(anchor, AnchorSpec):
                raise ValueError("Invalid anchor specification")
            _name(anchor.name, "anchor name")
            if anchor.name in names:
                raise ValueError(f"Duplicate anchor: {obj.id}/{anchor.name}")
            names.add(anchor.name)
            if anchor.kind not in ("physical-face", "region-boundary") or anchor.side not in (None, "lower", "upper", "left", "right"):
                raise ValueError("Invalid anchor specification")
            _optional_name(anchor.source_ref, "anchor source")
            if anchor.kind == "region-boundary" and anchor.source_ref is not None and anchor.source_ref not in regions:
                raise ValueError(f"Unknown anchor region: {obj.id}/{anchor.name}")
    for region in state.regions:
        if region.owner_id not in objects:
            raise ValueError(f"Unknown region owner: {region.owner_id}")
        _name(region.anchor, "region anchor")
        if region.parent_region_id is not None and region.parent_region_id not in regions:
            raise ValueError(f"Unknown parent region: {region.parent_region_id}")
    _acyclic({obj.id: obj.parent_id for obj in state.objects}, "object hierarchy")
    _acyclic({region.id: region.parent_region_id for region in state.regions}, "region hierarchy")
    for relation in state.relations:
        if relation.kind not in ("attached_to", "connects", "inside", "excludes", "fills", "surrounds", "covers"):
            raise ValueError(f"Unknown relation kind: {relation.kind}")
        if relation.subject_id not in objects:
            raise ValueError(f"Unknown relation subject: {relation.subject_id}")
        if relation.region_id is not None and relation.region_id not in regions:
            raise ValueError(f"Unknown relation region: {relation.region_id}")
        for target in relation.targets:
            if not isinstance(target, AnchorRef) or target.object_id not in objects:
                raise ValueError("Unknown relation target")
            _name(target.anchor, "target anchor")
            anchors = objects[target.object_id].anchors
            if anchors and target.anchor not in {anchor.name for anchor in anchors}:
                raise ValueError(f"Unknown anchor: {target.object_id}/{target.anchor}")
        if relation.kind == "attached_to" and len(relation.targets) != 1:
            raise ValueError("attached_to requires exactly one target")
        if relation.kind == "connects" and len(relation.targets) < 2:
            raise ValueError("connects requires at least two targets")
        if relation.kind in ("inside", "fills", "surrounds", "covers") and relation.region_id is None:
            raise ValueError(f"{relation.kind} requires a region")
        if relation.kind == "excludes" and not relation.targets and relation.region_id is None:
            raise ValueError("excludes requires targets or a region")
    for derivation in state.derivations:
        if not isinstance(derivation, SceneDerivation) or derivation.kind not in ("copy", "crop", "split", "merge", "preserve", "transform"):
            raise ValueError("Invalid scene derivation")
        _name(derivation.source_object_id, "derivation source")
        _name(derivation.target_object_id, "derivation target")
        _optional_name(derivation.input_port_id, "derivation input port")
        # Sources can belong to another input; historical targets may have been
        # removed by a later operation. Neither must be alive in this state.


def apply_delta(state: SceneState, delta: SchematicDelta) -> SceneState:
    """Apply an atomic semantic update. Removal recursively removes children.

    Derived source references are history, not visible objects. Region removal
    cascades through its descendants and dependent relations; surviving objects
    must explicitly move their region references in the same atomic delta.
    """
    validate_scene(state)
    if not isinstance(delta, SchematicDelta):
        raise ValueError("Expected SchematicDelta")
    for name, expected in (("creates", SchematicObject), ("updates", SchematicObject),
                           ("reparents", SceneReparent), ("add_regions", LayoutRegion),
                           ("update_regions", LayoutRegion), ("add_relations", SceneRelation),
                           ("update_relations", SceneRelation), ("derivations", SceneDerivation)):
        if any(not isinstance(value, expected) for value in getattr(delta, name)):
            raise ValueError(f"Invalid delta {name}")
    for name in ("removes", "remove_relations", "remove_regions"):
        for value in getattr(delta, name):
            _name(value, f"delta {name}")
    if not isinstance(delta.clear_cursor, bool) or (delta.clear_cursor and delta.cursor_region_id is not None):
        raise ValueError("Invalid delta cursor update")
    objects = dict(state.object_map)
    for obj in delta.creates:
        if obj.id in objects:
            raise ValueError(f"Object already exists: {obj.id}")
        objects[obj.id] = obj
    seen_updates = set()
    for obj in delta.updates:
        if obj.id not in objects or obj.id in seen_updates:
            raise ValueError(f"Unknown or duplicate updated object: {obj.id}")
        seen_updates.add(obj.id)
        objects[obj.id] = obj
    for change in delta.reparents:
        if change.object_id not in objects:
            raise ValueError(f"Unknown reparented object: {change.object_id}")
        objects[change.object_id] = replace(objects[change.object_id], parent_id=change.parent_id)
    removed = set(delta.removes)
    if not removed <= objects.keys():
        raise ValueError("Cannot remove an unknown object")
    while True:
        descendants = {obj.id for obj in objects.values() if obj.parent_id in removed}
        if descendants <= removed:
            break
        removed.update(descendants)
    objects = {key: obj for key, obj in objects.items() if key not in removed}
    regions = dict(state.region_map)
    for region in delta.add_regions:
        if region.id in regions:
            raise ValueError(f"Region already exists: {region.id}")
        regions[region.id] = region
    seen_region_updates = set()
    for region in delta.update_regions:
        if region.id not in state.region_map or region.id in seen_region_updates:
            raise ValueError(f"Unknown or duplicate updated region: {region.id}")
        if region.id in delta.remove_regions:
            raise ValueError(f"Cannot update and remove region: {region.id}")
        seen_region_updates.add(region.id)
        regions[region.id] = region
    explicitly_removed_regions = set(delta.remove_regions)
    if len(explicitly_removed_regions) != len(delta.remove_regions):
        raise ValueError("Duplicate removed region")
    if not explicitly_removed_regions <= regions.keys():
        raise ValueError("Cannot remove an unknown region")
    removed_regions = explicitly_removed_regions | {key for key, region in regions.items() if region.owner_id in removed}
    while True:
        children = {key for key, region in regions.items() if region.parent_region_id in removed_regions}
        if children <= removed_regions:
            break
        removed_regions.update(children)
    regions = {key: region for key, region in regions.items() if key not in removed_regions}
    relations = dict(state.relation_map)
    seen_relation_updates = set()
    for relation in delta.update_relations:
        if relation.id not in relations or relation.id in seen_relation_updates:
            raise ValueError(f"Unknown or duplicate updated relation: {relation.id}")
        if relation.id in delta.remove_relations:
            raise ValueError(f"Cannot update and remove relation: {relation.id}")
        seen_relation_updates.add(relation.id)
        relations[relation.id] = relation
    for key in delta.remove_relations:
        if key not in relations:
            raise ValueError(f"Unknown removed relation: {key}")
        del relations[key]
    for relation in delta.add_relations:
        if relation.id in relations:
            raise ValueError(f"Relation already exists: {relation.id}")
        relations[relation.id] = relation
    relations = {key: relation for key, relation in relations.items()
                 if relation.subject_id not in removed and relation.region_id not in removed_regions
                 and all(target.object_id not in removed for target in relation.targets)}
    cursor = None if delta.clear_cursor else delta.cursor_region_id or state.cursor_region_id
    if cursor in removed_regions:
        cursor = None
    result = SceneState(tuple(objects.values()), tuple(regions.values()), tuple(relations.values()), cursor,
                        state.orientation if delta.orientation is None else delta.orientation,
                        state.phase_id if delta.phase_id is None else delta.phase_id,
                        tuple(dict.fromkeys((*state.derivations, *delta.derivations))),
                        tuple(dict.fromkeys((*state.notes, *delta.notes))))
    validate_scene(result)
    return result


def namespace_id(namespace: str, object_id: str) -> str:
    _name(namespace, "namespace")
    _name(object_id, "source object id")
    return hashlib.sha256(f"{namespace}\0{object_id}".encode()).hexdigest()[:24]


def clone_scene(state: SceneState, namespace: str, input_port_id: str | None = None, *,
                attach_to: str | None = None, region_id: str | None = None) -> SchematicDelta:
    """Declare an attached copy without copying any physical geometry.

    A structural assembly's outer regions enter the destination region. Regions
    inside a representative component remain local to that component.
    """
    validate_scene(state)
    ids = {obj.id: namespace_id(namespace, obj.id) for obj in state.objects}
    roots = {obj.id for obj in state.objects if obj.parent_id is None}
    structural_roots = {obj.id for obj in state.objects if obj.id in roots and obj.layout == "group"}
    shared_regions = {region.id for region in state.regions
                      if region_id is not None and region.owner_id in structural_roots
                      and region.parent_region_id is None}
    region_ids = {region.id: region_id if region.id in shared_regions else namespace_id(namespace, region.id)
                  for region in state.regions}
    creates = []
    for obj in state.objects:
        target_region = region_ids.get(obj.region_id)
        if obj.id in roots and region_id is not None and obj.layout == "member":
            target_region = region_id
        creates.append(replace(obj, id=ids[obj.id], parent_id=ids.get(obj.parent_id, attach_to),
                               group_key=namespace_id(namespace, obj.group_key or obj.id) if obj.layout == "member" else obj.group_key,
                               region_id=target_region,
                               anchors=tuple(replace(anchor, source_ref=region_ids.get(anchor.source_ref, anchor.source_ref))
                                             if anchor.kind == "region-boundary" else anchor for anchor in obj.anchors)))
    regions = tuple(replace(region, id=region_ids[region.id], owner_id=ids[region.owner_id],
                            parent_region_id=region_ids.get(region.parent_region_id))
                    for region in state.regions if region.id not in shared_regions)
    relations = tuple(replace(relation, id=namespace_id(namespace, relation.id), subject_id=ids[relation.subject_id],
                              targets=tuple(replace(target, object_id=ids[target.object_id]) for target in relation.targets),
                              region_id=region_ids.get(relation.region_id)) for relation in state.relations)
    derivations = tuple(SceneDerivation(obj.id, ids[obj.id], input_port_id) for obj in state.objects)
    return SchematicDelta(creates=tuple(creates), add_regions=regions, add_relations=relations, derivations=derivations)


@dataclass(frozen=True)
class PhysicalSample:
    source_id: str
    z_min: float
    z_max: float
    material: str
    density: float | None = None

    def __post_init__(self):
        _name(self.source_id, "physical source id")
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
               for value in (self.z_min, self.z_max)) or self.z_max < self.z_min:
            raise ValueError("Invalid physical Z interval")
        if not isinstance(self.material, str):
            raise ValueError("Physical material must be a string")
        if self.density is not None and (isinstance(self.density, bool) or not isinstance(self.density, (int, float))
                                         or not math.isfinite(self.density) or not 0 <= self.density <= 100):
            raise ValueError("Invalid physical density")

    @property
    def thickness(self) -> float:
        return self.z_max - self.z_min


@dataclass(frozen=True)
class ResolvedPhysicalData:
    object_id: str
    snapshot_id: str
    unit: str
    samples: tuple[PhysicalSample, ...]

    def __post_init__(self):
        object.__setattr__(self, "samples", tuple(self.samples))
        for name in ("object_id", "snapshot_id", "unit"):
            _name(getattr(self, name), name)
        if any(not isinstance(sample, PhysicalSample) for sample in self.samples):
            raise ValueError("Invalid physical sample")


def resolve_physical_data(state: SceneState, samples: Mapping[str, PhysicalSample],
                          bindings: Mapping[str, Sequence[str]], *, snapshot_id: str,
                          unit: str) -> tuple[ResolvedPhysicalData, ...]:
    """Bind all surviving sources without averaging thickness or density.

    Bindings are keyed by logical object ID. Missing physical nodes are absent
    from the selected snapshot (e.g. after saw); future objects remain invisible.
    """
    validate_scene(state)
    result = []
    for obj in state.objects:
        resolved = tuple(samples[key] for key in dict.fromkeys(bindings.get(obj.id, ())) if key in samples)
        if resolved:
            result.append(ResolvedPhysicalData(obj.id, snapshot_id, unit, resolved))
    return tuple(result)
