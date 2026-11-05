"""Render semantic scenes using only selected-snapshot measurements.

The scene planner owns horizontal placement; symbols return local primitives.
No process name, physical placement count, or future geometry enters rendering.
"""
from __future__ import annotations

import hashlib
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from .composer import _ZDisplay, _validate_parts
from .contracts import Bounds, Primitive, SchematicDocument, SchematicPart
from .geometry import material_color
from .palette import (
    ADHESIVE_FILL, CONDUCTOR_FILL, GENERIC_FILL, MATRIX_FILL, OUTLINE, RDL_DIELECTRIC_FILL,
    SILICON_FILL, SUPPORT_FILL, UNDERFILL_FILL,
)
from .scene import (
    AnchorRef, PhysicalSample, ResolvedPhysicalData, SceneState,
    SchematicObject, resolve_physical_data, validate_scene,
)
from .scene_layout import SceneLayoutPlan, _centers, make_scene_layout_plan


@dataclass(frozen=True)
class SceneSymbolContext:
    object: SchematicObject
    sample: PhysicalSample
    samples: tuple[PhysicalSample, ...]


SceneSymbol = Callable[[SceneSymbolContext], Sequence[Primitive]]


class SceneSymbolRegistry:
    """Versioned local symbols; callbacks never receive display coordinates."""

    def __init__(self):
        self._symbols: dict[tuple[str, int], SceneSymbol] = {}

    def register(self, symbol: str, callback: SceneSymbol, *, version: int = 1):
        if not isinstance(symbol, str) or not symbol or not callable(callback):
            raise ValueError("A symbol needs a name and callable renderer")
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise ValueError("Symbol version must be a positive integer")
        key = (symbol, version)
        if key in self._symbols:
            raise ValueError(f"Duplicate scene symbol: {symbol}@{version}")
        self._symbols[key] = callback

    def resolve(self, symbol: str, version: int = 1) -> SceneSymbol | None:
        return self._symbols.get((symbol, version))


_COLORS = {
    "silicon": SILICON_FILL, "adhesive": ADHESIVE_FILL, "matrix": MATRIX_FILL,
    "rdl_dielectric": RDL_DIELECTRIC_FILL,
    "underfill": UNDERFILL_FILL, "conductor": CONDUCTOR_FILL,
    "support": SUPPORT_FILL, "generic": GENERIC_FILL,
}


def _id(prefix, *values):
    return f"{prefix}-{hashlib.sha256(repr(values).encode()).hexdigest()[:20]}"


def render_scene(
    scene: SceneState,
    physical_data: Sequence[ResolvedPhysicalData] | None = None,
    *,
    samples: Mapping[str, PhysicalSample] | None = None,
    bindings: Mapping[str, Sequence[str]] | None = None,
    snapshot_id: str = "snapshot",
    unit: str = "um",
    layout_plan: SceneLayoutPlan | None = None,
    symbol_registry: SceneSymbolRegistry | None = None,
) -> SchematicDocument:
    """Render a scene with either resolved data or physical samples and bindings.

    Unbound objects reserve layout space but produce no shapes or items. One
    canonical physical sample is drawn for heterogeneous instances; every
    distinct measurement remains a separate item and an explanatory note.
    """
    validate_scene(scene)
    if physical_data is not None and (samples is not None or bindings is not None):
        raise ValueError("Pass resolved data or samples and bindings, not both")
    if physical_data is None:
        physical_data = resolve_physical_data(scene, samples or {}, bindings or {},
                                             snapshot_id=snapshot_id, unit=unit)
    objects = scene.object_map
    data: dict[str, ResolvedPhysicalData] = {}
    for resolved in physical_data:
        if not isinstance(resolved, ResolvedPhysicalData) or resolved.object_id not in objects:
            raise ValueError("Physical data references an unknown scene object")
        if resolved.object_id in data:
            raise ValueError("Duplicate physical data for scene object")
        data[resolved.object_id] = resolved
    units = {resolved.unit for resolved in data.values()}
    snapshots = {resolved.snapshot_id for resolved in data.values()}
    if len(units) > 1 or len(snapshots) > 1:
        raise ValueError("A schematic must use one snapshot and unit")
    unit = next(iter(units), unit)
    plan = layout_plan or make_scene_layout_plan(scene)
    if not isinstance(plan, SceneLayoutPlan) or not math.isfinite(plan.width) or plan.width <= 0:
        raise ValueError("Invalid scene layout plan")
    notes = list(dict.fromkeys((*scene.notes, *plan.notes)))
    warnings: list[str] = []
    measurements = [sample for resolved in data.values() for sample in resolved.samples]
    z = _ZDisplay([Bounds(0, 0, sample.z_min, 1, 1, sample.z_max) for sample in measurements])
    region_map = {region.region_id: region for region in plan.regions}
    feature_map = {feature.object_id: feature for feature in plan.features}
    slots = {}
    for slot in plan.slots:
        for object_id in slot.object_ids or (slot.object_id,):
            slots.setdefault(object_id, []).append(slot)
    children = {}
    for obj in scene.objects:
        children.setdefault(obj.parent_id, []).append(obj)
    relations = {}
    for relation in scene.relations:
        relations.setdefault(relation.subject_id, []).append(relation)

    def arranged_copies(obj, intervals):
        result = tuple(intervals)
        parent_id = obj.parent_id
        while parent_id is not None:
            parent = objects[parent_id]
            parent_slots = slots.get(parent.id, ())
            if parent.nesting == "arranged" and len(parent_slots) > 1:
                first = parent_slots[0].x
                result = tuple((left + slot.x - first, right + slot.x - first)
                               for slot in parent_slots for left, right in result)
            parent_id = parent.parent_id
        return result

    def intervals(obj):
        if obj.id in feature_map:
            feature = feature_map[obj.id]
            centers = feature.centers
            # A structural member repeats one local drawing. Its planned span
            # already covers every representative, whereas distribution has a
            # single object-level motif budget. Apply that budget locally once
            # and repeat identical positions, rather than asymmetric 4/5 pins.
            parent_id = obj.parent_id
            while feature.layout == "distributed" and parent_id is not None:
                parent = objects[parent_id]
                parent_slots = slots.get(parent.id, ())
                if parent.nesting == "structural" and len(parent_slots) > 1:
                    canonical = parent_slots[0]
                    local_intervals = tuple((max(left, canonical.x), min(right, canonical.x + canonical.width))
                                            for left, right in feature.intervals
                                            if right > canonical.x and left < canonical.x + canonical.width)
                    local_centers = _centers(local_intervals, len(centers), feature.width)
                    centers = tuple(center + slot.x - canonical.x
                                    for slot in parent_slots for center in local_centers)
                    break
                parent_id = parent.parent_id
            spans = (tuple((center - feature.width / 2, center + feature.width / 2)
                           for center in centers)
                     if feature.layout == "distributed" else feature.intervals)
            return arranged_copies(obj, spans)
        if obj.id in slots:
            return arranged_copies(obj, tuple((slot.x, slot.x + slot.width) for slot in slots[obj.id]))
        parent_id = obj.parent_id
        while parent_id is not None:
            parent = objects[parent_id]
            if parent.layout == "member":
                return intervals(parent)
            parent_id = parent.parent_id
        region = region_map.get(obj.region_id)
        if region is None:
            owned = next((region for region in scene.regions if region.owner_id == obj.id), None)
            region = region_map.get(owned.id) if owned else None
        return () if region is None else ((region.x, region.x + region.width),)

    def object_samples(object_id):
        if object_id in data and data[object_id].samples:
            return data[object_id].samples
        return tuple(sample for child in children.get(object_id, ()) for sample in object_samples(child.id))

    def rect(left, right, sample):
        top = z.y(sample.z_max)
        return {"x": left, "y": top, "width": right - left,
                "height": z.y(sample.z_min) - top}

    def group_label(obj):
        parent = obj
        while parent is not None:
            if parent.kind in ("component", "assembly"):
                return parent.label
            parent = objects.get(parent.parent_id)
        return "Structure"

    def anchor_point(target: AnchorRef):
        obj = objects[target.object_id]
        source_samples = object_samples(obj.id)
        spans = intervals(obj)
        spec = next((spec for spec in obj.anchors if spec.name == target.anchor), None)
        if spec and spec.kind == "region-boundary":
            region_id = spec.source_ref or obj.region_id
            region = region_map.get(region_id)
            if region is None:
                return None
            spans = ((region.x, region.x + region.width),)
            if not source_samples:
                source_samples = object_samples(scene.region_map[region_id].owner_id)
        elif spec and spec.source_ref:
            # Anchor references are binding keys, not physical node IDs. Prefer
            # the target subtree so two copied assemblies with the same source
            # binding cannot accidentally share their current Z measurements.
            def descendant_ids(object_id):
                yield object_id
                for child in children.get(object_id, ()):
                    yield from descendant_ids(child.id)

            local = set(descendant_ids(obj.id))
            candidates = [candidate for candidate in scene.objects if candidate.source_ref == spec.source_ref]
            scoped = [candidate for candidate in candidates if candidate.id in local]
            bound_samples = tuple(sample for candidate in scoped or candidates
                                  for sample in object_samples(candidate.id))
            source_samples = bound_samples or tuple(sample for sample in source_samples
                                                    if sample.source_id == spec.source_ref)
        if not source_samples or not spans:
            return None
        lower = min(sample.z_min for sample in source_samples)
        upper = max(sample.z_max for sample in source_samples)
        side = spec.side if spec else None
        # Process descriptors already transform physical-face sides on flip.
        # Scene orientation describes the state; applying it again swaps twice.
        left, right = spans[0]
        x = left if side == "left" else right if side == "right" else (left + right) / 2
        return [x, z.y(lower if side == "lower" else upper)]

    items, shapes, components = [], [], []
    canonical_items = {}
    for obj in scene.objects:
        resolved = data.get(obj.id)
        if resolved is None or not resolved.samples:
            continue
        visible_samples = tuple(sample for sample in resolved.samples
                                if obj.kind != "feature" or obj.layout != "distributed" or sample.density != 0)
        if not visible_samples:
            continue
        # Group wrappers organize their children and do not add a material slab.
        if obj.kind in ("assembly", "component") and children.get(obj.id) and obj.symbol is None:
            continue
        groups = {}
        for sample in visible_samples:
            groups.setdefault((sample.material, sample.z_min, sample.z_max), {})[sample.source_id] = sample
        for index, ((material, lower, upper), source_map) in enumerate(groups.items()):
            source_samples = tuple(source_map.values())
            item_id = _id("item", obj.id, material, lower, upper)
            item = {"id": item_id, "label": obj.label, "material": material,
                    "groupLabel": group_label(obj), "sourceIds": list(source_map),
                    "zMin": lower, "zMax": upper, "thickness": upper - lower}
            if obj.kind == "feature":
                item["densityValues"] = sorted({sample.density for sample in source_samples},
                                               key=lambda value: (value is None, value or 0))
            if obj.diagram_label is not None:
                item["diagramLabel"] = obj.diagram_label
            items.append(item)
            if index == 0:
                canonical_items[obj.id] = (item_id, source_samples[0], source_samples)
        if len(groups) > 1:
            notes.append(f"{obj.label} has different source measurements; the first remaining source is drawn and all measurements are retained.")

    for obj in scene.objects:
        if obj.kind != "component":
            continue
        source_samples = object_samples(obj.id)
        if not source_samples:
            continue
        extent = PhysicalSample(obj.id, min(sample.z_min for sample in source_samples),
                                max(sample.z_max for sample in source_samples), "")
        for index, (left, right) in enumerate(intervals(obj)):
            components.append({"id": _id("component", obj.id, index), "label": obj.label,
                               **({"diagramLabel": obj.diagram_label} if obj.diagram_label is not None else {}),
                               "sourceIds": list(dict.fromkeys(sample.source_id for sample in source_samples)),
                               **rect(left, right, extent)})

    def append_primitive(primitive, box, item_id, fill, *, exclusions=()):
        shape = {"id": _id("shape", item_id, len(shapes)), "itemId": item_id,
                 "kind": primitive.kind, "fill": primitive.fill or fill,
                 "stroke": primitive.stroke or OUTLINE, "strokeWidth": primitive.stroke_width,
                 "clip": {**box, "exclusions": list(exclusions)}}
        if primitive.kind == "rect":
            shape.update(x=box["x"] + primitive.x * box["width"],
                         y=box["y"] + primitive.y * box["height"],
                         width=primitive.width * box["width"], height=primitive.height * box["height"])
        elif primitive.kind == "circle":
            shape.update(cx=box["x"] + primitive.cx * box["width"],
                         cy=box["y"] + primitive.cy * box["height"],
                         r=min(primitive.r * box["height"], box["width"] / 2))
        else:
            shape.update(points=[[box["x"] + x * box["width"], box["y"] + y * box["height"]]
                                 for x, y in primitive.points], closed=primitive.closed)
            if not primitive.closed and primitive.fill is None:
                shape["fill"], shape["stroke"] = "none", primitive.stroke or fill
        shapes.append(shape)

    for obj in scene.objects:
        if obj.id not in canonical_items:
            continue
        item_id, sample, source_samples = canonical_items[obj.id]
        if sample.thickness <= 0:
            continue
        fill = obj.fill_override or _COLORS.get(obj.color_role, material_color(sample.material))
        connections = [relation for relation in relations.get(obj.id, ()) if relation.kind == "connects"]
        if connections and obj.symbol is None:
            for connection in connections:
                points = [anchor_point(target) for target in connection.targets]
                if any(point is None for point in points):
                    warnings.append(f"Connection {connection.id} has an unresolved physical endpoint.")
                    continue
                shapes.append({"id": _id("shape", item_id, connection.id), "itemId": item_id,
                               "kind": "path", "fill": "none", "stroke": fill,
                               "strokeWidth": 1.2, "points": points, "closed": False})
            continue
        primitives = (Primitive(),)
        if obj.symbol is not None:
            callback = symbol_registry.resolve(obj.symbol, obj.symbol_version) if symbol_registry else None
            try:
                if callback is None:
                    raise ValueError("Unknown symbol")
                primitives = tuple(callback(SceneSymbolContext(obj, sample, source_samples)))
                _validate_parts((SchematicPart(obj.label, primitives=primitives),))
                if any(primitive.repeat_x for primitive in primitives):
                    raise ValueError("Scene repetition is controlled by layout")
            except Exception:
                primitives = (Primitive(),)
                warnings.append(f"Symbol {obj.symbol}@{obj.symbol_version} could not display {obj.label}; a generic slab is used.")
        cuts = []
        for relation in relations.get(obj.id, ()):
            if relation.kind not in ("fills", "excludes"):
                continue
            for target in relation.targets:
                target_samples = object_samples(target.object_id)
                if target_samples:
                    target_sample = target_samples[0]
                    cuts.extend(rect(left, right, target_sample) for left, right in intervals(objects[target.object_id]))
        for left, right in intervals(obj):
            box = rect(left, right, sample)
            if box["width"] <= 0 or box["height"] <= 0:
                continue
            for primitive in primitives:
                append_primitive(primitive, box, item_id, fill, exclusions=cuts)

    total = (max(sample.z_max for sample in measurements) - min(sample.z_min for sample in measurements)
             if measurements else 0.0)
    return {"schemaVersion": 1, "unit": unit, "viewBox": [0.0, 0.0, plan.width, max(240.0, z.height + 112)],
            "shapes": shapes, "items": items, "components": components, "totalThickness": total,
            "notes": list(dict.fromkeys(notes)), "warnings": list(dict.fromkeys(warnings))}
