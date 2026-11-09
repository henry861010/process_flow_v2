"""PnP owns the display relationship between opposing reflowed bumps."""

from math import cos, pi, sin

from process_flow_kernel.domain.bump_operations import footprints_overlap
from process_flow_kernel.utils.math_utils import math
from process_flow_schematic import (
    CONDUCTOR_FILL, CONDUCTOR_OUTLINE, OUTLINE, SOLDER_FILL,
    Bounds, Primitive, SchematicContext, SchematicPart, base_material, geometry_bounds,
)

from .._schematic_helpers import footprint_geometry, polygon_data, walk


def _paired_lower_bumps(scope, context):
    def footprint(node):
        return context.query(("footprint", id(node)), lambda: footprint_geometry(
            node["geometry"], polygon=polygon_data(context, node)
            if node["geometry"].get("type") == "PolygonGeometry" else None))
    pairs = {}
    lowers = [(bump, geometry_bounds(bump.get("geometry", {})))
              for bump in scope.get("bumps", ()) if bump.get("stage") == "reflowed"]
    for child in scope.get("children", ()):
        bounds = [geometry_bounds(node.get("geometry", {}))
                  for descendant in walk(child)
                  for collection in ("bodies", "vias", "circuits", "bumps")
                  for node in descendant.get(collection, ())]
        bottom = min((bound.z_min for bound in bounds if bound is not None), default=None)
        if bottom is None:
            continue
        for upper in child.get("bumps", ()):
            if upper.get("stage") != "reflowed" or upper.get("density", 0) <= 0:
                continue
            upper_bounds = geometry_bounds(upper.get("geometry", {}))
            if upper_bounds is None or upper_bounds.thickness <= 0 or not math.f_eq(upper_bounds.z_min, bottom):
                continue
            matches = [(lower, lower_bounds) for lower, lower_bounds in lowers
                       if lower_bounds is not None and lower_bounds.thickness > 0
                       and math.f_eq(lower_bounds.z_max, upper_bounds.z_min)
                       and footprints_overlap(footprint(lower),
                                              footprint(upper))]
            if len(matches) == 1 and matches[0][0].get("density", 0) > 0:
                pairs[upper["id"]] = matches[0]
    return pairs


def _reflowed_bump(*, upper):
    # One yellow contact above a gray cup; mirror the lower bump so the cups
    # meet. Equal-height pairs have the same overall 1:4:1 color ratio as joints.
    right_arc = tuple((0.7 + 0.3 * cos(pi * index / 32),
                       0.55 + 0.45 * sin(pi * index / 32)) for index in range(17))
    left_arc = tuple((1 - x, y) for x, y in reversed(right_arc))
    solder = ((0.0, 1 / 3), (1.0, 1 / 3), *right_arc, *left_arc)
    contact = ((0.0, 0.0), (1.0, 0.0), (1.0, 1 / 3), (0.0, 1 / 3))
    return tuple(Primitive(
        kind="path", points=tuple((x, y if upper else 1 - y) for x, y in points),
        closed=True, repeat_x=True, r=1, fill=fill, stroke=stroke,
    ) for points, fill, stroke in (
        (solder, SOLDER_FILL, OUTLINE), (contact, CONDUCTOR_FILL, CONDUCTOR_OUTLINE)))


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    if context.node.get("stage") != "reflowed" or context.node.get("density", 0) <= 0 or not context.ancestors:
        return []
    scope = context.ancestors[-1]
    pairs = context.query((__name__, "pairs", id(scope)), lambda: _paired_lower_bumps(scope, context))
    match = pairs.get(context.node["id"])
    if match is None:
        return []
    lower, lower_bounds = match
    upper_bounds = context.bounds
    return [SchematicPart(
        label="Reflowed bump · " + base_material(source.get("material", "Bump")),
        fill=SOLDER_FILL, primitives=_reflowed_bump(upper=is_upper),
        source_id=source["id"], repeat_group="opposing-bumps",
        display_bounds=Bounds(upper_bounds.x_min, upper_bounds.y_min, bounds.z_min,
                              upper_bounds.x_max, upper_bounds.y_max,
                              bounds.z_max if is_upper else upper_bounds.z_min),
    ) for source, bounds, is_upper in ((context.node, upper_bounds, True), (lower, lower_bounds, False))]
