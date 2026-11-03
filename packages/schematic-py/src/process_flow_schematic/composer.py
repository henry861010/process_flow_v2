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
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any

from .contracts import Bounds, ComponentHint, Primitive, SchematicContext, SchematicDocument, SchematicLayoutPlan, SchematicPart, SchematicRegistry
from .geometry import base_material, geometry_bounds, material_color, walk_containers
from .layout import _validate_layout_plan
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


class _ZDisplay:
    def __init__(self, bounds):
        self.z = sorted({value for b in bounds for value in (b.z_min, b.z_max)})
        self.distances = [0.0]
        for lower, upper in zip(self.z, self.z[1:]):
            self.distances.append(self.distances[-1] + max(10.0, min(110.0, math.sqrt(upper - lower) * 5)))
        self.height = self.distances[-1] if self.distances else 0

    def y(self, value):
        if len(self.z) < 2:
            return 48.0
        index = min(max(bisect.bisect_right(self.z, value) - 1, 0), len(self.z) - 2)
        fraction = (value - self.z[index]) / (self.z[index + 1] - self.z[index])
        distance = self.distances[index] + fraction * (self.distances[index + 1] - self.distances[index])
        return 48 + self.height - distance


def _validate_parts(parts):
    if not isinstance(parts, (list, tuple)) or not all(isinstance(part, SchematicPart) for part in parts):
        raise ValueError("Invalid presenter result")
    for part in parts:
        if part.component is not None:
            hint = part.component
            if not isinstance(hint, ComponentHint) or not isinstance(hint.representative_count, int) or hint.representative_count < 1:
                raise ValueError("Invalid component hint")
        if part.layout not in ("node", "bridges", "gaps"):
            raise ValueError("Unsupported schematic layout")
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
) -> SchematicDocument:
    return _compose_schematic(structure, registry, layout_plan=layout_plan, component_bindings=component_bindings)


def describe_schematic_components(
    structure: Mapping[str, Any], registry: SchematicRegistry,
) -> dict[str, ComponentHint]:
    """Describe exactly the components selected by normal snapshot composition."""
    return _compose_schematic(structure, registry, describe_only=True)


def _compose_schematic(
    structure, registry, *, layout_plan=None, component_bindings=None, describe_only=False,
):
    if layout_plan is not None:
        _validate_layout_plan(layout_plan)
    frozen = _freeze(structure)
    unit = str(frozen.get("unitSystem", "um"))
    warnings = []
    containers = list(walk_containers(frozen))
    nodes: list[_Node] = []
    nodes_by_container: dict[int, list[_Node]] = {}
    container_bounds: dict[int, Bounds] = {}
    hints: dict[int, ComponentHint] = {}
    queries = {}

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
            return list(parts)
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
                                   node.kind, node.bounds, unit, query=query)
        node.parts = present(context)

    for container, ancestors in reversed(containers):
        children = container.get("children", ())
        bounds = _merge([n.bounds for n in nodes_by_container.get(id(container), ())] +
                        [container_bounds[id(child)] for child in children if id(child) in container_bounds])
        if bounds is None:
            continue
        container_bounds[id(container)] = bounds
        context = SchematicContext(frozen, container, container, ancestors, "container", bounds, unit, query=query)
        for part in present(context):
            if part.component is not None:
                hints[id(container)] = part.component

    selected: list[Mapping] = []
    selected_ids = set()
    for container, ancestors in containers:
        if id(container) not in container_bounds or any(id(ancestor) in selected_ids for ancestor in ancestors):
            continue
        if id(container) in hints:
            selected.append(container)
            selected_ids.add(id(container))
            continue
        # Unlabelled imported components still get one representative. Empty
        # wrapper scopes and relation-only helper scopes do not become dies.
        direct_nodes = nodes_by_container.get(id(container), ())
        has_visible_direct = any(p.primitives and p.layout == "node" for n in direct_nodes for p in n.parts)
        if (ancestors and has_visible_direct and registry.resolve("container", container.get("key")) is None
                and not any(id(child) in hints for child in container.get("children", ()))):
            selected.append(container)
            selected_ids.add(id(container))

    if describe_only:
        return {str(container.get("id", "")): hints.get(
            id(container), ComponentHint(str(container.get("key") or "Component")))
            for container in selected}

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
                parts.append((base_material(part.label), part.fill, part.primitives, part.layout,
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
        signature = (hint.label, hint.representative_count, hint.placement, _signature(container),
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
            else:
                warnings.append("A component has no reserved schematic slot; its measurements are retained without a drawing.")
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

    edge_groups = [g for g in groups if g.hint.placement == "edges"]
    center_groups = [g for g in groups if g.hint.placement != "edges"]
    # Broad footprints keep dies visually wider than their exaggerated layer
    # thicknesses. These dimensions affect presentation only, never geometry.
    die_width, edge_die_width, gap = 320.0, 224.0, 24.0
    edge_space = sum(max(1, g.hint.representative_count // 2) * (edge_die_width + gap) for g in edge_groups)
    center_count = sum(max(1, min(12, g.hint.representative_count)) for g in center_groups)
    width = max(1000.0, 96.0 + edge_space * 2 + center_count * (die_width + gap))
    placements: list[_Placement] = []
    left, right = 48.0, width - 48.0
    for group in edge_groups:
        count = max(1, min(12, group.hint.representative_count))
        for index in range(count):
            if index % 2 == 0:
                placements.append(_Placement(group, left, edge_die_width))
                left += edge_die_width + gap
            else:
                right -= edge_die_width
                placements.append(_Placement(group, right, edge_die_width))
                right -= gap
    center_width = center_count * die_width + max(center_count - 1, 0) * gap
    cursor = left + max(0, (right - left - center_width) / 2)
    for group in center_groups:
        for _ in range(max(1, min(12, group.hint.representative_count))):
            placements.append(_Placement(group, cursor, die_width))
            cursor += die_width + gap
    placements.sort(key=lambda p: p.x)
    placement_sequence = placements
    support_x, support_width = 36.0, width - 72
    if layout_plan is not None:
        width = layout_plan.width
        support_x = layout_plan.support_x
        support_width = width - 72.0 if layout_plan.support_width is None else layout_plan.support_width
        placement_sequence = [
            _Placement(planned_groups[slot.group_key], slot.x, slot.width, slot.id)
            if slot.group_key in planned_groups else None
            for slot in sorted(layout_plan.slots, key=lambda slot: slot.x)
        ]
        placements = [placement for placement in placement_sequence if placement is not None]

    z = _ZDisplay([n.bounds for n in nodes])
    height = max(240.0, z.height + 112)
    items = []
    item_index = {}
    item_source_ids = {}
    node_items = {}
    for node in nodes:
        group = owner.get(id(node.container))
        for part in node.parts:
            if not part.primitives and part.layout not in ("bridges", "gaps"):
                continue
            source = nodes_by_id.get(part.source_id, node)
            material = str(source.node.get("material", ""))
            label = base_material(part.label)
            key = (group.id if group else "base", source.kind, label, base_material(material),
                   source.bounds.z_min, source.bounds.z_max)
            if key not in item_index:
                item = {"id": f"item-{len(items) + 1}", "label": label, "material": base_material(material),
                        "groupLabel": group_labels[group.id] if group else "Structure", "sourceIds": [],
                        "zMin": source.bounds.z_min, "zMax": source.bounds.z_max, "thickness": source.bounds.thickness}
                item_index[key] = item
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

    bridge_requests = []
    for node in sorted(nodes, key=lambda n: (len(n.ancestors), n.kind != "body")):
        group = owner.get(id(node.container))
        # Draw just the first physical instance in each equivalent group. All
        # equivalent source IDs remain in the associated measurement rows.
        if not is_representative(node.container, node.ancestors):
            continue
        for part in node.parts:
            if part.layout in ("bridges", "gaps"):
                bridge_requests.append((node, part))
                continue
            for placement in ([p for p in placements if p.group is group] if group else [None]):
                append_part(node, part, rectangle(part.display_bounds or node.bounds, placement,
                                                  source_owner_bounds.get(id(node.container))))

    seen_bridges = set()
    for node, part in bridge_requests:
        eligible = set(part.eligible_container_ids)
        for left_p, right_p in zip(placement_sequence, placement_sequence[1:]):
            if left_p is None or right_p is None:
                continue
            left_ids = {str(c.get("id")) for c in (left_p.group.containers[:1] if layout_plan is not None
                                                    else left_p.group.containers)}
            right_ids = {str(c.get("id")) for c in (right_p.group.containers[:1] if layout_plan is not None
                                                     else right_p.group.containers)}
            if not eligible.intersection(left_ids) or not eligible.intersection(right_ids):
                continue
            # A relation cannot extend beyond the participating components.
            lower = max(node.bounds.z_min, left_p.group.bounds.z_min, right_p.group.bounds.z_min)
            upper = min(node.bounds.z_max, left_p.group.bounds.z_max, right_p.group.bounds.z_max)
            if upper <= lower:
                continue
            key = (left_p.x, right_p.x, lower, upper, base_material(str(node.node.get("material", ""))))
            if key in seen_bridges:
                continue
            seen_bridges.add(key)
            append_part(node, part, {"x": left_p.x + left_p.width, "width": right_p.x - left_p.x - left_p.width,
                                     "y": z.y(upper), "height": z.y(lower) - z.y(upper)})

    components = [{"id": placement.slot_id or f"component-{index + 1}", "label": group_labels[placement.group.id],
                   "x": placement.x, "width": placement.width, "y": z.y(placement.group.bounds.z_max),
                   "height": z.y(placement.group.bounds.z_min) - z.y(placement.group.bounds.z_max),
                   "sourceIds": [str(c.get("id", "")) for c in placement.group.containers]}
                  for index, placement in enumerate(placements)]
    total = max((n.bounds.z_max for n in nodes), default=0) - min((n.bounds.z_min for n in nodes), default=0)
    # Assert transport is ordinary finite JSON, independent of frozen input.
    document = {"schemaVersion": 1, "unit": unit, "viewBox": [0, 0, width, height], "shapes": shapes,
                "items": items, "components": components, "totalThickness": total,
                "notes": ["Schematic · not to scale. Thickness values reflect the current structure.",
                          "Component count, horizontal positions and feature symbols are illustrative.",
                          *(layout_plan.notes if layout_plan is not None else ()), *composition_notes],
                "warnings": list(dict.fromkeys(warnings))}
    json.dumps(document, allow_nan=False)
    return document


def slab_fallback(label, material):
    from .contracts import slab
    return slab(label, material_color(str(material)))
