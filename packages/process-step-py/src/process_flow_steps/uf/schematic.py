"""Underfill display policy follows the retained cavity and gap bodies."""

from process_flow_kernel import classify_polygon_loops
from process_flow_schematic import (
    Bounds, SchematicContext, SchematicPart, UNDERFILL_FILL, base_material, geometry_bounds, slab,
)
from shapely import set_precision
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from .._schematic_helpers import walk


_SUPPORT_KEYS = {"carrier", "carrier.panel", "carrier.wafer", "frame"}
_TOLERANCE = 1e-5


def _is_gap_scope(context):
    scope = context.container
    bodies = scope.get("bodies", ())
    return (bool(context.ancestors) and scope.get("key") is None and bool(bodies)
            and not scope.get("children")
            and not any(scope.get(collection) for collection in ("bumps", "vias", "circuits"))
            and all(body.get("key") == "uf"
                    and body.get("geometry", {}).get("type") == "PolygonGeometry" for body in bodies))


def _component_bounds(scope):
    # Earlier UF operations must not enlarge the component used to determine
    # which dies touch the current retained gap body.
    bounds = [geometry_bounds(node.get("geometry", {}))
              for descendant in walk(scope)
              for collection in ("bodies", "bumps", "vias", "circuits")
              for node in descendant.get(collection, ()) if node.get("key") != "uf"]
    bounds = [bound for bound in bounds if bound is not None and bound.thickness > _TOLERANCE]
    if not bounds:
        return None
    return Bounds(min(bound.x_min for bound in bounds), min(bound.y_min for bound in bounds),
                  min(bound.z_min for bound in bounds), max(bound.x_max for bound in bounds),
                  max(bound.y_max for bound in bounds), max(bound.z_max for bound in bounds))


def _connected_regions(geometry):
    region = set_precision(unary_union([
        Polygon([point[:2] for point in loop.outer],
                [[point[:2] for point in hole] for hole in loop.holes])
        for loop in classify_polygon_loops(geometry["polys"])
    ]), _TOLERANCE)
    if region.is_empty:
        return ()
    regions = (region,) if region.geom_type == "Polygon" else region.geoms
    return tuple(sorted(regions, key=lambda polygon: (*polygon.bounds, polygon.area)))


def _touches(region, bounds, gap_bounds):
    if min(bounds.z_max, gap_bounds.z_max) - max(bounds.z_min, gap_bounds.z_min) <= _TOLERANCE:
        return False
    footprint = set_precision(box(bounds.x_min, bounds.y_min, bounds.x_max, bounds.y_max), _TOLERANCE)
    contact = region.intersection(footprint)
    # A corner alone does not connect a die to the underfill region.
    return contact.area > _TOLERANCE ** 2 or contact.length > _TOLERANCE


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    label = "UF · " + base_material(context.node.get("material", "Underfill"))
    if not _is_gap_scope(context):
        return [slab(label, UNDERFILL_FILL)]

    assembly = context.ancestors[-1]
    candidates = context.query((__name__, "participants", id(assembly)), lambda: tuple(
        (str(scope["id"]), bounds)
        for scope in assembly.get("children", ()) if scope.get("key") not in _SUPPORT_KEYS
        if (bounds := _component_bounds(scope)) is not None))
    regions = context.query((__name__, "regions", id(context.node)),
                            lambda: _connected_regions(context.node["geometry"]))
    groups = tuple(tuple(container_id for container_id, bounds in candidates
                         if _touches(region, bounds, context.bounds)) for region in regions)
    return [SchematicPart(label=label, fill=UNDERFILL_FILL, layout="bridges", bridge_groups=groups or ((),))]
