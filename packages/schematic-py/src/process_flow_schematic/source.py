"""Adapt physical source snapshots to semantic scenes without retaining geometry.

This is also the canonical component selection policy for abstract steps. Empty
imported wrappers can gain a body without a fake geometry marker; placing them
then promotes their own structure to a representative component.
"""
from __future__ import annotations

import hashlib
from dataclasses import replace
from collections.abc import Mapping

from .contracts import Bounds, SchematicContext
from .composer import _signature, _freeze
from .geometry import geometry_bounds, walk_containers, material_color
from .scene import AnchorSpec, SceneObject, SceneRegion, SceneState, namespace_id, validate_scene


def _class_key(container):
    return hashlib.sha256(repr(_signature(container)).encode()).hexdigest()[:24]


def normalize_scene_members(state: SceneState) -> SceneState:
    """Select outer component boundaries using semantics, never process names."""
    children = {}
    for obj in state.objects:
        children.setdefault(obj.parent_id, []).append(obj)
    selected = set()
    objects = state.object_map

    def visit(obj, ancestor_member=False):
        own_children = children.get(obj.id, ())
        has_direct = any(child.kind in ("body", "feature") for child in own_children)
        explicit_child = any(child.kind == "component" and child.role != "component" for child in own_children)
        eligible = obj.kind == "component" and (
            obj.role != "component" or (obj.parent_id is not None and has_direct and not explicit_child))
        if eligible and not ancestor_member:
            selected.add(obj.id)
        for child in own_children:
            visit(child, ancestor_member or (obj.id in selected and obj.nesting == "structural"))

    for root in children.get(None, ()):
        visit(root)
    updated = []
    for obj in state.objects:
        if obj.kind != "component":
            updated.append(obj)
            continue
        if obj.id in selected:
            # Existing cloned group identity must survive new thickness/stage.
            group = obj.group_key or namespace_id(state.phase_id, f"{obj.region_id}:{obj.class_key or obj.id}")
            updated.append(replace(obj, layout="member", group_key=group))
        else:
            updated.append(replace(obj, layout="group"))
    result = replace(state, objects=tuple(updated))
    validate_scene(result)
    return result


def describe_source_scene(structure: Mapping, registry, *, source_id: str) -> tuple[SceneState, dict[str, str]]:
    frozen = _freeze(structure)
    # Physical IDs are source-qualified and stable; payload child order is not
    # a layout priority. Parents precede descendants for bounds aggregation.
    containers = sorted(walk_containers(frozen), key=lambda item: (len(item[1]), str(item[0]["id"])))
    root = frozen["root"]
    root_id = namespace_id(source_id, str(root["id"]))
    region_id = namespace_id(source_id, "mount-region")
    bindings = {}
    objects = []
    regions = [SceneRegion(region_id, root_id)]
    content_regions = {}
    bounds_by_container = {}
    for container, _ in reversed(containers):
        bounds = [geometry_bounds(node.get("geometry", {})) for name in ("bodies", "vias", "circuits", "bumps")
                  for node in container.get(name, ())]
        bounds.extend(bounds_by_container.get(str(child["id"])) for child in container.get("children", ()))
        bounds = [bound for bound in bounds if bound is not None and bound.thickness > 0]
        if bounds:
            bounds_by_container[str(container["id"])] = Bounds(
                min(b.x_min for b in bounds), min(b.y_min for b in bounds), min(b.z_min for b in bounds),
                max(b.x_max for b in bounds), max(b.y_max for b in bounds), max(b.z_max for b in bounds))
    queries = {}

    def query(key, build):
        if key not in queries:
            queries[key] = build()
        return queries[key]

    for container, ancestors in containers:
        physical_id = str(container["id"])
        logical_id = namespace_id(source_id, physical_id)
        bindings[physical_id] = logical_id
        ref = f"input:{source_id}:{physical_id}"
        bounds = bounds_by_container.get(physical_id, Bounds(0, 0, 0, 0, 0, 0))
        parent_id = namespace_id(source_id, str(ancestors[-1]["id"])) if ancestors else None
        container_region = content_regions[str(ancestors[-1]["id"])] if ancestors else region_id
        presenter = registry.resolve("container", container.get("key"))
        hints = []
        if presenter is not None:
            try:
                context = SchematicContext(frozen, container, container, ancestors, "container", bounds,
                                           str(frozen.get("unitSystem", "um")), query)
                hints = [part.component for part in presenter(context) if part.component is not None]
            except Exception:
                presenter = None
        hint = hints[0] if hints else None
        kind = "assembly" if presenter is not None and hint is None else "component"
        role = (hint.role or str(container.get("key") or "component")) if hint else (
            str(container.get("key") or "assembly") if kind == "assembly" else "component")
        label = hint.label if hint else str(container.get("key") or "Component")
        nesting = hint.nesting if hint else "structural"
        contents = container_region
        if nesting == "arranged":
            contents = namespace_id(source_id, f"{physical_id}:contents")
            regions.append(SceneRegion(contents, logical_id, parent_region_id=container_region))
        content_regions[physical_id] = contents
        objects.append(SceneObject(
            logical_id, kind, role, label, parent_id=parent_id, source_ref=ref,
            class_key=_class_key(container), layout="group", region_id=container_region, nesting=nesting,
            diagram_label=hint.diagram_label if hint else None,
            anchors=(AnchorSpec("lower", source_ref=ref, side="lower"),
                     AnchorSpec("upper", source_ref=ref, side="upper"),
                     AnchorSpec("mount", kind="region-boundary", source_ref=region_id, side="upper"))))
        for collection, node_kind in (("bodies", "body"), ("vias", "via"), ("circuits", "circuit"), ("bumps", "bump")):
            for node in container.get(collection, ()):
                node_id = str(node["id"])
                object_id = namespace_id(source_id, node_id)
                bindings[node_id] = object_id
                node_bounds = geometry_bounds(node.get("geometry", {}))
                if node_bounds is None or node_bounds.thickness <= 0:
                    continue
                node_ref = f"input:{source_id}:{node_id}"
                layout = "span"
                symbol = node_kind
                fill = material_color(str(node.get("material", "")))
                diagram_label = None
                renderer = registry.resolve(node_kind, node.get("key"))
                if renderer is None and node_kind != "body" and node.get("density", 0) <= 0:
                    continue
                if renderer:
                    try:
                        context = SchematicContext(frozen, node, container, ancestors, node_kind, node_bounds,
                                                   str(frozen.get("unitSystem", "um")), query)
                        parts = renderer(context)
                        if any(part.layout == "distributed" for part in parts):
                            layout = "distributed"
                        if parts:
                            fill = parts[0].fill
                            diagram_label = parts[0].diagram_label
                    except Exception:
                        pass  # The renderer emits a warning when composing the selected snapshot.
                objects.append(SceneObject(
                    object_id, "body" if node_kind == "body" else "feature",
                    str(node.get("key") or node_kind), str(node.get("key") or node.get("material") or node_kind),
                    parent_id=logical_id, source_ref=node_ref, class_key=object_id,
                    layout=layout, region_id=contents, symbol=symbol,
                    color_role="generic", fill_override=fill, diagram_label=diagram_label,
                    anchors=(AnchorSpec("lower", source_ref=node_ref, side="lower"),
                             AnchorSpec("upper", source_ref=node_ref, side="upper"))))
    state = SceneState(tuple(objects), tuple(regions), cursor_region_id=region_id,
                       phase_id=namespace_id(source_id, "input-scene"))
    state = normalize_scene_members(state)
    return state, bindings
