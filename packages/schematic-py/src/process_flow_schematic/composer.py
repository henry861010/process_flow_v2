"""Compose a final-state schematic from independently registered presenters.

The composer knows geometry hierarchy and layout hints, never process programs,
die names, material roles or recipe parameters. It produces display coordinates;
all measurements and selection identities remain attached to physical nodes.
"""
from __future__ import annotations

import bisect
import json
import math
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Any

from .contracts import Bounds, ComponentHint, Primitive, SchematicContext, SchematicDocument, SchematicLayoutGroup, SchematicLayoutPlan, SchematicPart, SchematicRegistry
from .geometry import base_material, geometry_bounds, material_color, walk_containers
from .layout import _validate_layout_plan, make_layout_plan, resolve_component_hint
from .palette import OUTLINE


def _freeze(value):
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    return value


def _merge(bounds):
    values = list(bounds)
    if not values:
        return None
    return Bounds(min(b.x_min for b in values), min(b.y_min for b in values), min(b.z_min for b in values),
                  max(b.x_max for b in values), max(b.y_max for b in values), max(b.z_max for b in values))


@dataclass
class _Node:
    id: str
    kind: str
    node: Mapping
    container: Mapping
    ancestors: tuple
    bounds: Bounds
    parts: list[SchematicPart]


@dataclass
class _Group:
    id: str
    containers: list[Mapping]
    hint: ComponentHint
    bounds: Bounds


@dataclass
class _Placement:
    group: _Group
    x: float
    width: float
    slot_id: str | None = None


def _signature(container):
    """Ignore identity, XY placement, repeated count and via/circuit density."""
    layers = []
    for collection in ("bodies", "vias", "circuits", "bumps"):
        for node in container.get(collection, ()):
            bounds = geometry_bounds(node.get("geometry", {}))
            if bounds is None or bounds.thickness <= 0:
                continue
            layers.append((collection, node.get("key"), base_material(node.get("material", "")),
                           bounds.z_min, bounds.z_max, node.get("stage"), node.get("direction"),
                           collection != "bumps" or node.get("density", 0) > 0))
    return (container.get("key"), tuple(sorted(layers, key=repr)),
            tuple(sorted((_signature(c) for c in container.get("children", ())), key=repr)))


_Z_DISPLAY_TOLERANCE_UM = 0.001


class _ZDisplay:
    def __init__(self, bounds, *, display_bounds=()):
        bounds = tuple(bounds)
        self._raw_z = sorted({value for b in (*bounds, *display_bounds) for value in (b.z_min, b.z_max)})
        # Even a computed layer thinner than the display tolerance must survive.
        lower_surfaces = {}
        for bound in bounds:
            if bound.z_max > bound.z_min:
                lower_surfaces.setdefault(bound.z_max, set()).add(bound.z_min)

        self.z = []
        self._canonical = {}
        members = set()
        for value in self._raw_z:
            merge = False
            if self.z:
                lower = self.z[-1]
                margin = 4 * max(math.ulp(lower), math.ulp(value), math.ulp(_Z_DISPLAY_TOLERANCE_UM))
                merge = (value - lower < _Z_DISPLAY_TOLERANCE_UM - margin
                         and members.isdisjoint(lower_surfaces.get(value, ())))
            if not merge:
                self.z.append(value)
                members = set()
            members.add(value)
            self._canonical[value] = self.z[-1]

        self.distances = [0.0]
        for lower, upper in zip(self.z, self.z[1:]):
            self.distances.append(self.distances[-1] + max(10.0, min(110.0, math.sqrt(upper - lower) * 5)))
        self.height = self.distances[-1] if self.distances else 0
        distances = dict(zip(self.z, self.distances))
        self._raw_distances = [distances[self._canonical[value]] for value in self._raw_z]

    def y(self, value):
        if len(self.z) < 2:
            return 48.0
        if value < self._raw_z[0]:
            distance = ((value - self._raw_z[0]) / (self.z[1] - self.z[0])
                        * (self.distances[1] - self.distances[0]))
        elif value > self._raw_z[-1]:
            distance = self.height + ((value - self._raw_z[-1]) / (self.z[-1] - self.z[-2])
                                      * (self.distances[-1] - self.distances[-2]))
        else:
            # Interpolate through the original breakpoints. Merged spans are
            # flat, including interior queries, so the transform stays monotone.
            index = min(max(bisect.bisect_right(self._raw_z, value) - 1, 0), len(self._raw_z) - 2)
            fraction = (value - self._raw_z[index]) / (self._raw_z[index + 1] - self._raw_z[index])
            distance = self._raw_distances[index] + fraction * (self._raw_distances[index + 1] - self._raw_distances[index])
        return 48 + self.height - distance


def _validate_parts(parts):
    if not isinstance(parts, (list, tuple)) or not all(isinstance(part, SchematicPart) for part in parts):
        raise ValueError("Invalid presenter result")
    for part in parts:
        if part.component is not None:
            hint = part.component
            if (not isinstance(hint, ComponentHint) or not isinstance(hint.representative_count, int)
                    or hint.representative_count < 1 or hint.nesting not in ("structural", "arranged")):
                raise ValueError("Invalid component hint")
        for label in (part.diagram_label, part.component.diagram_label if part.component else None):
            if label is not None and (not isinstance(label, str) or not label.strip()):
                raise ValueError("Invalid diagram label")
        if part.layout not in ("node", "span", "distributed"):
            raise ValueError("Unsupported schematic layout")
        if (not isinstance(part.distribution_count, int) or isinstance(part.distribution_count, bool)
                or not 1 <= part.distribution_count <= 100):
            raise ValueError("Invalid distribution count")
        for reference in (part.source_id, part.repeat_group):
            if reference is not None and (not isinstance(reference, str) or not reference):
                raise ValueError("Invalid schematic reference")
        if part.display_bounds is not None:
            bounds = part.display_bounds
            if (not isinstance(bounds, Bounds) or not all(math.isfinite(value) for value in vars(bounds).values())
                    or bounds.x_max < bounds.x_min or bounds.y_max < bounds.y_min or bounds.z_max <= bounds.z_min):
                raise ValueError("Invalid display bounds")
        for primitive in part.primitives:
            if not isinstance(primitive, Primitive) or primitive.kind not in ("rect", "circle", "path"):
                raise ValueError("Unsupported schematic primitive")
            numbers = (primitive.x, primitive.y, primitive.width, primitive.height, primitive.cx,
                       primitive.cy, primitive.r, primitive.stroke_width,
                       *(value for point in primitive.points for value in point))
            if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in numbers):
                raise ValueError("Non-finite schematic coordinates")
            if min(primitive.width, primitive.height, primitive.r, primitive.stroke_width) < 0:
                raise ValueError("Negative schematic dimensions")
            if not isinstance(primitive.repeat_x, bool) or (
                primitive.repeat_x and (primitive.kind not in ("circle", "path") or primitive.r <= 0
                                        or (primitive.kind == "path" and len(primitive.points) < 2))
            ):
                raise ValueError("Horizontal repetition requires a circle or path with positive radius")


def compose_schematic(
    structure: Mapping[str, Any], registry: SchematicRegistry, *,
    layout_plan: SchematicLayoutPlan | None = None,
    component_bindings: Mapping[str, str] | None = None,
    polygon_lookup=None,
) -> SchematicDocument:
    return _compose_schematic(structure, registry, layout_plan=layout_plan, component_bindings=component_bindings, polygon_lookup=polygon_lookup)


def describe_schematic_components(
    structure: Mapping[str, Any], registry: SchematicRegistry, *, polygon_lookup=None,
) -> dict[str, ComponentHint]:
    """Describe exactly the components selected by normal snapshot composition."""
    return _compose_schematic(structure, registry, describe_only=True, polygon_lookup=polygon_lookup)


def _compose_schematic(
    structure, registry, *, layout_plan=None, component_bindings=None, describe_only=False, arrange_contents=True, polygon_lookup=None,
    _frozen=None, _queries=None,
):
    if layout_plan is not None:
        _validate_layout_plan(layout_plan)
    process_source_ids = {source_id for fill in getattr(component_bindings, "layer_fills", ())
                          for source_id in fill.source_ids}
    frozen = _freeze(structure) if _frozen is None else _frozen
    unit = str(frozen.get("unitSystem", "um"))
    warnings = []
    containers = list(walk_containers(frozen))
    nodes: list[_Node] = []
    nodes_by_container: dict[int, list[_Node]] = {}
    container_bounds: dict[int, Bounds] = {}
    hints: dict[int, ComponentHint] = {}
    queries = {} if _queries is None else _queries

    def query(key, build):
        if key not in queries:
            queries[key] = build()
        return queries[key]

    def present(context):
        presenter = registry.resolve(context.kind, context.node.get("key"))
        if presenter is None:
            if context.kind == "container":
                return []
            if context.kind != "body" and context.node.get("density", 0) <= 0:
                return []
            label = context.node.get("key") or context.node.get("material") or context.kind.title()
            return [slab_fallback(str(label), context.node.get("material", ""))]
        try:
            parts = presenter(context)
            _validate_parts(parts)
            if any(part.source_id is not None and part.source_id not in nodes_by_id for part in parts):
                raise ValueError("Unknown schematic source")
            # Distributed motifs depict present columns; their density does
            # not change the planned count, but zero means there are none.
            # Other symbols (notably RDL) keep their own visibility contract.
            return [part for part in parts if not (
                part.layout == "distributed" and context.node.get("density") == 0)]
        except Exception:
            warnings.append(f"A presenter could not display {context.node.get('id', context.kind)}; a generic representation is used.")
            if context.kind == "container":
                label = str(context.node.get("key") or "Component")
                return [SchematicPart(label, component=ComponentHint(label))]
            if context.kind != "body" and context.node.get("density", 0) <= 0:
                return []
            return [slab_fallback(str(context.node.get("material", context.kind)), context.node.get("material", ""))]

    for container_index, (container, ancestors) in enumerate(containers):
        for collection, kind in (("bodies", "body"), ("vias", "via"), ("circuits", "circuit"), ("bumps", "bump")):
            for index, node in enumerate(container.get(collection, ())):
                bounds = geometry_bounds(node.get("geometry", {}))
                if bounds is None:
                    warnings.append("An unsupported or invalid geometry was omitted from the schematic.")
                    continue
                if bounds.thickness <= 0:
                    continue
                record = _Node(str(node.get("id", f"node-{container_index}-{collection}-{index}")), kind,
                               node, container, ancestors, bounds, [])
                nodes.append(record)
                nodes_by_container.setdefault(id(container), []).append(record)

    nodes_by_id = {node.id: node for node in nodes}
    for node in nodes:
        context = SchematicContext(frozen, node.node, node.container, node.ancestors,
                                   node.kind, node.bounds, unit, query=query, polygon_lookup=polygon_lookup,
                                   display_replaced=node.id in process_source_ids)
        node.parts = present(context)

    for container, ancestors in reversed(containers):
        children = container.get("children", ())
        bounds = _merge([n.bounds for n in nodes_by_container.get(id(container), ())] +
                        [container_bounds[id(child)] for child in children if id(child) in container_bounds])
        if bounds is None:
            continue
        container_bounds[id(container)] = bounds
        context = SchematicContext(frozen, container, container, ancestors, "container", bounds, unit, query=query, polygon_lookup=polygon_lookup)
        for part in present(context):
            if part.component is not None:
                hints[id(container)] = resolve_component_hint(part.component)

    selected: list[Mapping] = []
    selected_ids = set()
    for container, ancestors in containers:
        if id(container) not in container_bounds or any(
                id(ancestor) in selected_ids and hints.get(id(ancestor), ComponentHint("")).nesting == "structural"
                for ancestor in ancestors):
            continue
        if id(container) in hints:
            selected.append(container)
            selected_ids.add(id(container))
            continue
        # Unlabelled imported components still get one representative. Empty
        # wrapper scopes and relation-only helper scopes do not become dies.
        direct_nodes = nodes_by_container.get(id(container), ())
        has_visible_direct = any(p.primitives and p.layout in ("node", "distributed") for n in direct_nodes for p in n.parts)
        if (ancestors and has_visible_direct and registry.resolve("container", container.get("key")) is None
                and not any(id(child) in hints for child in container.get("children", ()))):
            selected.append(container)
            selected_ids.add(id(container))

    if describe_only:
        return {str(container.get("id", "")): hints.get(
            id(container), ComponentHint(str(container.get("key") or "Component")))
            for container in selected}

    if arrange_contents and layout_plan is None and any(hint.nesting == "arranged" for hint in hints.values()):
        # A standalone compound uses the same local-region plan as a flow.
        # It must not flatten its internal components into sibling packages.
        from .flow import _display_bindings, transport_layout
        from .scene_layout import make_scene_layout_plan
        from .source import describe_source_scene
        scene, logical = describe_source_scene(structure, registry, source_id="snapshot")
        layout_plan = transport_layout(make_scene_layout_plan(scene))
        component_bindings = _display_bindings(scene, logical, structure)

    # A partial binding must never hide current geometry.
    if layout_plan is not None:
        reserved = {slot.group_key for slot in layout_plan.slots}
        logical = getattr(component_bindings, "logical", None)
        missing_sources = logical is not None and any(
            (part.source_id or node.id) not in logical
            for node in nodes for part in node.parts
            if part.primitives)
        missing_members = any((component_bindings or {}).get(str(container.get("id", ""))) not in reserved
                              for container in selected)
        if missing_members or missing_sources:
            document = _compose_schematic(structure, registry, arrange_contents=False, polygon_lookup=polygon_lookup,
                                         component_bindings=component_bindings,
                                         _frozen=frozen, _queries=queries)
            document["notes"] = list(dict.fromkeys((*document["notes"], *layout_plan.notes)))
            document["warnings"].append(
                "A current schematic object cannot be bound to the shared plan; this assembly uses a local layout."
                if missing_sources else
                "A current component has no reserved schematic slot; this assembly uses a local layout.")
            return document

    def presentation_signature(container):
        """Keep relational presentation differences without retaining source IDs or XY placement."""
        bounds = container_bounds.get(id(container))
        signatures = []
        for node in nodes_by_container.get(id(container), ()):
            repeat_groups = {}
            parts = []
            for part in node.parts:
                source = nodes_by_id.get(part.source_id, node)
                display = part.display_bounds
                relative = None
                if display is not None and bounds is not None:
                    width = bounds.x_max - bounds.x_min
                    depth = bounds.y_max - bounds.y_min
                    relative = (round((display.x_min - bounds.x_min) / width, 9) if width else 0,
                                round((display.x_max - bounds.x_min) / width, 9) if width else 1,
                                round((display.y_min - bounds.y_min) / depth, 9) if depth else 0,
                                round((display.y_max - bounds.y_min) / depth, 9) if depth else 1,
                                display.z_min, display.z_max)
                repeat_group = None
                if part.repeat_group is not None:
                    repeat_group = repeat_groups.setdefault(part.repeat_group, len(repeat_groups))
                parts.append((base_material(part.label), part.diagram_label, part.fill, part.primitives, part.layout,
                              source.kind, base_material(str(source.node.get("material", ""))),
                              source.bounds.z_min, source.bounds.z_max, relative, repeat_group))
            signatures.append((node.kind, node.node.get("key"), tuple(parts)))
        return (tuple(sorted(signatures, key=repr)), tuple(sorted(
            (presentation_signature(child) for child in container.get("children", ())), key=repr)))

    groups_by_signature = {}
    planned_groups = {}
    group_signatures = {}
    composition_notes = []
    planned_keys = {slot.group_key for slot in layout_plan.slots} if layout_plan is not None else set()
    for container in selected:
        hint = hints.get(id(container), ComponentHint(str(container.get("key") or "Component")))
        signature = (hint.label, hint.diagram_label, hint.representative_count, hint.placement, _signature(container),
                     presentation_signature(container))
        bound_key = (component_bindings or {}).get(str(container.get("id", ""))) if layout_plan is not None else None
        grouping_key = signature if layout_plan is None else (("cohort", bound_key) if bound_key in planned_keys
                                                             else ("unbound", str(container.get("id", ""))))
        if grouping_key not in groups_by_signature:
            groups_by_signature[grouping_key] = _Group(f"group-{len(groups_by_signature) + 1}", [], hint, container_bounds[id(container)])
        group = groups_by_signature[grouping_key]
        group.containers.append(container)
        if layout_plan is not None:
            group_signatures.setdefault(group.id, set()).add(signature)
            if bound_key in planned_keys:
                planned_groups[bound_key] = group
    groups = list(groups_by_signature.values())
    if layout_plan is not None:
        for group in groups:
            if len(group_signatures[group.id]) > 1:
                composition_notes.append(
                    f"{group.hint.label} contains different instance structures. The first remaining instance is shown; measurements include every instance.")
    label_counts = Counter(group.hint.label for group in groups)
    label_indexes = Counter()
    group_labels = {}
    for group in groups:
        label_indexes[group.hint.label] += 1
        group_labels[group.id] = (group.hint.label if label_counts[group.hint.label] == 1
                                  else f"{group.hint.label} · {label_indexes[group.hint.label]}")
    owner = {}
    source_owner_bounds = {}
    for group in groups:
        for container in group.containers:
            for descendant, _ in walk_containers(container):
                owner[id(descendant)] = group
                source_owner_bounds[id(descendant)] = container_bounds[id(container)]

    def is_representative(container, ancestors):
        group = owner.get(id(container))
        return not group or any(container is first or any(ancestor is first for ancestor in ancestors)
                                for first in group.containers[:1])

    local_plan = make_layout_plan([SchematicLayoutGroup(group.id, group.hint) for group in groups])
    local_groups = {group.id: group for group in groups}
    width = local_plan.width
    placements = [_Placement(local_groups[slot.group_key], slot.x, slot.width)
                  for slot in local_plan.slots]
    placement_sequences = {"": placements}
    support_x, support_width = local_plan.support_x, local_plan.width - 72
    if layout_plan is not None:
        width = layout_plan.width
        support_x = layout_plan.support_x
        support_width = width - 72.0 if layout_plan.support_width is None else layout_plan.support_width
        placement_sequences = {}
        placements = []
        for slot in sorted(layout_plan.slots, key=lambda slot: slot.x):
            placement = (_Placement(planned_groups[slot.group_key], slot.x, slot.width, slot.id)
                         if slot.group_key in planned_groups else None)
            # Different mounting regions can overlap horizontally. Only slots
            # on the same surface can interrupt a relation, including blanks.
            placement_sequences.setdefault(slot.region_id, []).append(placement)
            if placement is not None:
                placements.append(placement)
    cohort_groups = {}
    group_regions = {}
    scene = getattr(component_bindings, "scene", None)
    cohort_regions = {obj.group_key or obj.id: obj.region_id for obj in scene.objects
                      if obj.layout == "member"} if scene is not None else {}
    for group in groups:
        for container in group.containers:
            cohort = (component_bindings or {}).get(str(container.get("id", "")))
            if cohort is not None:
                cohort_groups.setdefault(cohort, set()).add(group.id)
                if cohort in cohort_regions:
                    group_regions[group.id] = cohort_regions[cohort]
    layer_fills = []
    for fill in getattr(component_bindings, "layer_fills", ()):
        group_ids = tuple(sorted({group_id for key in fill.group_keys for group_id in cohort_groups.get(key, ())}))
        layer_fills.append(replace(fill, group_keys=group_ids))
    fill_bounds = [Bounds(0, 0, fill.z_min, 1, 1, fill.z_max) for fill in layer_fills]
    z = _ZDisplay([n.bounds for n in nodes], display_bounds=[*fill_bounds, *[
        part.display_bounds for node in nodes for part in node.parts if part.display_bounds is not None]])
    height = max(240.0, z.height + 112)
    items = []
    item_index = {}
    item_source_ids = {}
    node_items = {}
    for node in nodes:
        group = owner.get(id(node.container))
        for part in node.parts:
            if not part.primitives:
                continue
            source = nodes_by_id.get(part.source_id, node)
            material = str(source.node.get("material", ""))
            label = base_material(part.label)
            key = (group.id if group else "base", source.kind, label, part.diagram_label, base_material(material),
                   source.bounds.z_min, source.bounds.z_max)
            if key not in item_index:
                item = {"id": f"item-{len(items) + 1}", "label": label, "material": base_material(material),
                        "groupLabel": group_labels[group.id] if group else "Structure", "sourceIds": [],
                        "zMin": source.bounds.z_min, "zMax": source.bounds.z_max, "thickness": source.bounds.thickness}
                item_index[key] = item
                if part.diagram_label is not None:
                    item["diagramLabel"] = part.diagram_label
                items.append(item)
                item_source_ids[item["id"]] = set()
            item = item_index[key]
            if source.id not in item_source_ids[item["id"]]:
                item["sourceIds"].append(source.id)
                item_source_ids[item["id"]].add(source.id)
            node_items[(node.id, id(part))] = item["id"]

    # Representative items can combine sources with different or unknown density.
    for item in items:
        sources = [nodes_by_id[source_id] for source_id in item["sourceIds"]]
        if not sources or sources[0].kind not in ("bump", "via", "circuit"):
            continue
        density_values = set()
        for source in sources:
            value = source.node.get("density")
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not 0 <= value <= 100 or not math.isfinite(value)):
                value = None
            density_values.add(value)
        item["densityValues"] = sorted(density_values, key=lambda value: (value is None, 0 if value is None else value))

    def rectangle(bounds, placement=None, source_bounds=None):
        y = z.y(bounds.z_max)
        if placement is None:
            return {"x": support_x, "y": y, "width": support_width, "height": z.y(bounds.z_min) - y}
        source = source_bounds or placement.group.bounds
        span = source.x_max - source.x_min
        x0 = 0.0 if span <= 0 else (bounds.x_min - source.x_min) / span
        x1 = 1.0 if span <= 0 else (bounds.x_max - source.x_min) / span
        return {"x": placement.x + x0 * placement.width, "y": y,
                "width": max(0.5, (x1 - x0) * placement.width), "height": z.y(bounds.z_min) - y}

    # Resolve exclusion targets in display space, including equivalent source
    # instances represented by the same component group.
    display_rects: dict[str, list[dict]] = {}
    mask_targets = {target for node in nodes for part in node.parts for target in part.occluded_by}
    for container, ancestors in containers:
        if str(container.get("id", "")) not in mask_targets:
            continue
        if layout_plan is not None and not is_representative(container, ancestors):
            continue
        bounds = container_bounds.get(id(container))
        if bounds is None:
            continue
        group = owner.get(id(container))
        targets = [p for p in placements if p.group is group] if group else [None]
        for target in targets:
            display_rects.setdefault(str(container.get("id", "")), []).append(
                rectangle(bounds, target, source_owner_bounds.get(id(container))))
    for node in nodes:
        if node.id not in mask_targets:
            continue
        if layout_plan is not None and not is_representative(node.container, node.ancestors):
            continue
        group = owner.get(id(node.container))
        targets = [p for p in placements if p.group is group] if group else [None]
        for target in targets:
            display_rects.setdefault(node.id, []).append(
                rectangle(node.bounds, target, source_owner_bounds.get(id(node.container))))

    # Repeated motifs in a local group share a count and width, including when
    # their physical heights differ. These are generic display hints only.
    repeat_metrics = {}
    for node in nodes:
        for part in node.parts:
            if part.repeat_group is None:
                continue
            display = part.display_bounds or node.bounds
            extent = z.y(display.z_min) - z.y(display.z_max)
            radius = max((primitive.r * extent for primitive in part.primitives if primitive.repeat_x), default=0)
            key = (node.id, part.repeat_group)
            repeat_metrics[key] = max(repeat_metrics.get(key, 0), radius)

    shapes = []

    def repeat_layout(node, part, primitive, rect):
        target = repeat_metrics.get((node.id, part.repeat_group), primitive.r * rect["height"])
        radius = min(target, rect["width"] / 2.8)
        count = max(1, math.floor(rect["width"] / (2 * radius * 1.4)))
        return radius, count, rect["width"] / count

    def append_part(node, part, rect):
        item_id = node_items.get((node.id, id(part)))
        if item_id is None or rect["width"] <= 0 or rect["height"] <= 0:
            return
        exclusions = [cut for target_id in part.occluded_by for cut in display_rects.get(target_id, ())
                      if cut["x"] < rect["x"] + rect["width"] and cut["x"] + cut["width"] > rect["x"]]
        intervals = sorted((max(rect["x"], cut["x"]), min(rect["x"] + rect["width"], cut["x"] + cut["width"]))
                           for cut in exclusions)
        merged = []
        for lower, upper in intervals:
            if merged and lower <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], upper)
            else:
                merged.append([lower, upper])
        clip = {**rect, "exclusions": [{"x": lower, "width": upper - lower,
                                        "y": rect["y"], "height": rect["height"]} for lower, upper in merged]}
        primitives = part.primitives or (Primitive(),)
        for primitive in primitives:
            shape = {"id": f"shape-{len(shapes) + 1}", "itemId": item_id, "kind": primitive.kind,
                     "fill": primitive.fill or part.fill, "stroke": primitive.stroke or OUTLINE,
                     "strokeWidth": primitive.stroke_width, "clip": clip}
            if primitive.kind == "rect":
                shape.update(x=rect["x"] + primitive.x * rect["width"], y=rect["y"] + primitive.y * rect["height"],
                             width=primitive.width * rect["width"], height=primitive.height * rect["height"])
            elif primitive.kind == "circle":
                if primitive.repeat_x:
                    shared_radius, count, cell_width = repeat_layout(node, part, primitive, rect)
                    radius = min(primitive.r * rect["height"], shared_radius)
                    for index in range(count):
                        shapes.append({**shape, "id": f"shape-{len(shapes) + 1}",
                                       "cx": rect["x"] + (index + 0.5) * cell_width,
                                       "cy": rect["y"] + primitive.cy * rect["height"], "r": radius})
                    continue
                shape.update(cx=rect["x"] + primitive.cx * rect["width"], cy=rect["y"] + primitive.cy * rect["height"],
                             r=min(primitive.r * rect["height"], rect["width"] * 0.14))
            elif primitive.kind == "path":
                if primitive.fill is None and not primitive.closed:
                    shape["fill"] = "none"
                    shape["stroke"] = primitive.stroke or part.fill
                if primitive.repeat_x:
                    radius, count, cell_width = repeat_layout(node, part, primitive, rect)
                    for index in range(count):
                        center = rect["x"] + (index + 0.5) * cell_width
                        shapes.append({**shape, "id": f"shape-{len(shapes) + 1}",
                                       "points": [[center + (x - 0.5) * 2 * radius,
                                                   rect["y"] + y * rect["height"]] for x, y in primitive.points],
                                       "closed": primitive.closed})
                    continue
                shape.update(points=[[rect["x"] + x * rect["width"], rect["y"] + y * rect["height"]]
                                     for x, y in primitive.points], closed=primitive.closed)
            else:
                warnings.append("An unsupported schematic primitive was omitted.")
                continue
            shapes.append(shape)

    feature_slots = {feature.object_id: feature for feature in layout_plan.features} if layout_plan is not None else {}

    def append_distributed(node, part, placement, rect):
        from .scene_layout import _centers, subtract_intervals
        feature = feature_slots.get((component_bindings or {}).get(node.id))
        if feature is not None:
            centers, symbol_width = feature.centers, feature.width
            if placement is not None:
                first = next(p for p in placements if p.group is placement.group)
                centers = tuple(center + placement.x - first.x for center in centers)
        else:
            # Standalone mode uses the same interval policy with current state.
            blockers = [(p.x - 12, p.x + p.width + 12) for p in placements
                        if placement is None and min(p.group.bounds.z_max, node.bounds.z_max)
                        > max(p.group.bounds.z_min, node.bounds.z_min)]
            intervals = subtract_intervals(((rect["x"], rect["x"] + rect["width"]),), blockers)
            symbol_width = 12.0
            centers = _centers(intervals, part.distribution_count, symbol_width)
        for center in centers:
            append_part(node, part, {**rect, "x": center - symbol_width / 2, "width": symbol_width})

    for node in sorted(nodes, key=lambda n: (len(n.ancestors), n.kind != "body")):
        group = owner.get(id(node.container))
        # Draw just the first physical instance in each equivalent group. All
        # equivalent source IDs remain in the associated measurement rows.
        representative = is_representative(node.container, node.ancestors)
        for part in node.parts:
            if not representative:
                continue
            for placement in ([p for p in placements if p.group is group] if group else [None]):
                rect = rectangle(part.display_bounds or node.bounds, placement,
                                 source_owner_bounds.get(id(node.container)))
                if part.layout == "distributed":
                    append_distributed(node, part, placement, rect)
                else:
                    append_part(node, part, rect)

    # Layer fills are already resolved from process semantics and vertical
    # operations. Display-slot adjacency is the only horizontal operation.
    for fill in layer_fills:
        eligible = set(fill.group_keys)
        intervals = []
        sequences = (placement_sequences.values() if layout_plan is not None else
                     ([p for p in placements if group_regions.get(p.group.id, fill.region_id) == fill.region_id],))
        for sequence in sequences:
            visible = [placement for placement in sequence if placement is not None]
            for left, right in zip(visible, visible[1:]):
                if left.group.id not in eligible or right.group.id not in eligible:
                    continue
                x = left.x + left.width
                if right.x > x:
                    intervals.append((x, right.x-x))
        if not intervals:
            continue
        item_id = f"item-{len(items) + 1}"
        items.append({"id": item_id, "label": fill.label, "material": base_material(fill.material),
                      "groupLabel": "Structure", "sourceIds": list(fill.source_ids),
                      "zMin": fill.z_min, "zMax": fill.z_max, "thickness": fill.z_max-fill.z_min,
                      "measurementSource": "process", "sourceStepRefId": fill.source_step_ref_id})
        for x, span in dict.fromkeys(intervals):
            shapes.append({"id": f"shape-{len(shapes) + 1}", "itemId": item_id, "kind": "rect",
                           "fill": fill.fill, "stroke": OUTLINE, "strokeWidth": 0.6,
                           "x": x, "width": span, "y": z.y(fill.z_max),
                           "height": z.y(fill.z_min)-z.y(fill.z_max)})

    components = [{"id": placement.slot_id or f"component-{index + 1}", "label": group_labels[placement.group.id],
                   **({"diagramLabel": placement.group.hint.diagram_label} if placement.group.hint.diagram_label is not None else {}),
                   "x": placement.x, "width": placement.width, "y": z.y(placement.group.bounds.z_max),
                   "height": z.y(placement.group.bounds.z_min) - z.y(placement.group.bounds.z_max),
                   "sourceIds": [str(c.get("id", "")) for c in placement.group.containers]}
                  for index, placement in enumerate(placements)]
    total = max((n.bounds.z_max for n in nodes), default=0) - min((n.bounds.z_min for n in nodes), default=0)
    # Assert transport is ordinary finite JSON, independent of frozen input.
    document = {"schemaVersion": 1, "unit": unit, "viewBox": [0, 0, width, height], "shapes": shapes,
                "items": items, "components": components, "totalThickness": total,
                "notes": list(dict.fromkeys(["Schematic · not to scale. Geometry measurements and process schematic thicknesses are identified separately.",
                          "Component count, horizontal positions and feature symbols are illustrative.",
                          *(layout_plan.notes if layout_plan is not None else ()), *composition_notes,
                          *(["UF layer climbs are schematic; their thickness follows the UF recipe and subsequent processing."]
                            if layer_fills else [])])),
                "warnings": list(dict.fromkeys(warnings))}
    json.dumps(document, allow_nan=False)
    return document


def slab_fallback(label, material):
    from .contracts import slab
    return slab(label, material_color(str(material)))
