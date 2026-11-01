"""PnP owns the display relationship between opposing reflowed bumps."""

from math import cos, pi, sin

from process_flow_kernel.domain.bump_operations import footprints_overlap
from process_flow_kernel.utils.math_utils import math
from process_flow_schematic import Bounds, Primitive, SchematicContext, SchematicPart, base_material, geometry_bounds

from .._schematic_helpers import footprint_geometry, walk


def _paired_lower_bumps(scope):
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
                       and footprints_overlap(footprint_geometry(lower["geometry"]),
                                              footprint_geometry(upper["geometry"]))]
            if len(matches) == 1 and matches[0][0].get("density", 0) > 0:
                pairs[upper["id"]] = matches[0]
    return pairs


def _half_circle(*, upper):
    # Both motifs have a flat edge on their body and meet at their arc tips.
    points = tuple(((1 - cos(pi * index / 32)) / 2,
                    sin(pi * index / 32) if upper else 1 - sin(pi * index / 32))
                   for index in range(33))
    edge = 0.0 if upper else 1.0
    return Primitive(kind="path", points=((0.0, edge), *points[1:-1], (1.0, edge)),
                     closed=True, repeat_x=True, r=1, fill="#d9b85e", stroke="#9a772e")


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    if context.node.get("stage") != "reflowed" or context.node.get("density", 0) <= 0 or not context.ancestors:
        return []
    scope = context.ancestors[-1]
    pairs = context.query((__name__, "pairs", id(scope)), lambda: _paired_lower_bumps(scope))
    match = pairs.get(context.node["id"])
    if match is None:
        return []
    lower, lower_bounds = match
    upper_bounds = context.bounds
    return [SchematicPart(
        label="Reflowed bump · " + base_material(source.get("material", "Bump")),
        fill="#d9b85e", primitives=(_half_circle(upper=is_upper),),
        source_id=source["id"], repeat_group="opposing-bumps",
        display_bounds=Bounds(upper_bounds.x_min, upper_bounds.y_min, bounds.z_min,
                              upper_bounds.x_max, upper_bounds.y_max,
                              bounds.z_max if is_upper else upper_bounds.z_min),
    ) for source, bounds, is_upper in ((context.node, upper_bounds, True), (lower, lower_bounds, False))]
