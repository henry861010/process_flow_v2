"""Envelope-based placement and joint planning, independent of serialized state."""
from __future__ import annotations

from math import hypot

from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

from .geometry import BoxGeometry, ConeGeometry, CylinderGeometry, PolygonGeometry
from ..utils.math_utils import math
from ..utils.polygon import classify_polygon_loops


TOLERANCE = 1e-5
UNJOINED_STAGES = ("deposited", "reflowed")


def bottom_bumps(container, stages):
    """Select direct bottom envelopes, leaving internal component joints alone."""
    return [
        bump for bump in container.bumps()
        if bump.stage() in stages and math.f_eq(bump.z_min(), container.z_min())
    ]


def placement_bottom_z(main, source, *, main_z, offset_x, offset_y):
    heights = []
    for upper in bottom_bumps(source, UNJOINED_STAGES):
        geometry = upper.geometry()
        geometry.move(x=offset_x, y=offset_y)
        lower = [
            bump for bump in main.bumps()
            if bump.stage() in UNJOINED_STAGES
            and math.f_eq(bump.z_min(), main_z)
            and footprint_covers(bump.geometry(), geometry)
        ]
        if len(lower) > 1:
            raise ValueError("PnP: bottom bump has multiple covering main bumps")
        heights.append(lower[0].thk() if lower else 0)
    if heights and any(math.f_ne(height, heights[0]) for height in heights[1:]):
        raise ValueError("PnP: source bottom bumps require different placement heights")
    return main_z + (heights[0] if heights else 0)


def plan_bump_joint(root, joined_height):
    """Validate the whole batch and prepare replacements before any mutation."""
    plans = []
    layer = None
    for child in root.children():
        uppers = bottom_bumps(child, ("reflowed",))
        pairs = []
        for upper in uppers:
            lowers = [
                lower for lower in root.bumps()
                if lower.stage() == "reflowed"
                and math.f_eq(lower.z_max(), upper.z_min())
                and footprint_covers(lower.geometry(), upper.geometry())
            ]
            if len(lowers) > 1:
                raise ValueError("Bump Joint: bottom bump has multiple lower matches")
            if lowers:
                pairs.append((upper, lowers[0]))
        if not pairs:
            continue
        # Moving a child must not detach its other bottom reflowed envelopes.
        if len(pairs) != len(uppers):
            raise ValueError("Bump Joint: a child has partially paired bottom bumps")
        body_bottom = pairs[0][0].z_max()
        replacements = []
        for upper, lower in pairs:
            if math.f_ne(upper.z_max(), body_bottom):
                raise ValueError("Bump Joint: a child has inconsistent joint heights")
            pair_layer = (lower.z_min(), lower.z_max())
            if layer is None:
                layer = pair_layer
            elif any(math.f_ne(a, b) for a, b in zip(layer, pair_layer)):
                raise ValueError("Bump Joint: all matched bumps must be on the same layer")
            replacement = upper.copy_with_thk(joined_height).copy_with_stage("joined")
            replacement.move(z=lower.z_min() - replacement.z_min())
            replacements.append((upper, replacement))
        plans.append((child, pairs[0][1].z_min() + joined_height - body_bottom, replacements))
    if not plans:
        raise ValueError("Bump Joint: no paired reflowed bumps")
    return plans


def footprint_covers(outer, inner):
    """Use real XY envelopes (including polygon holes), never just bounds."""
    if isinstance(outer, (CylinderGeometry, ConeGeometry)):
        center, radius = _circle(outer)
        if isinstance(inner, (CylinderGeometry, ConeGeometry)):
            inner_center, inner_radius = _circle(inner)
            return hypot(center[0] - inner_center[0], center[1] - inner_center[1]) + inner_radius <= radius + TOLERANCE
        return all(hypot(x - center[0], y - center[1]) <= radius + TOLERANCE for x, y in _vertices(inner))
    region = _region(outer)
    if isinstance(inner, (CylinderGeometry, ConeGeometry)):
        center, radius = _circle(inner)
        point = Point(center[:2])
        return region.covers(point) and region.boundary.distance(point) + TOLERANCE >= radius
    return region.buffer(TOLERANCE).covers(_region(inner))


def _circle(geometry):
    radius = geometry.bottom_radius()
    if isinstance(geometry, ConeGeometry):
        radius = max(radius, geometry.top_radius())
    return geometry.center(), radius


def _vertices(geometry):
    if isinstance(geometry, BoxGeometry):
        a, b = geometry.bottom_left(), geometry.top_right()
        return [(a[0], a[1]), (a[0], b[1]), (b[0], a[1]), (b[0], b[1])]
    if isinstance(geometry, PolygonGeometry):
        return [point[:2] for loop in geometry.polygons() for point in loop]
    raise ValueError("Unsupported bump footprint")


def _region(geometry):
    if isinstance(geometry, BoxGeometry):
        a, b = geometry.bottom_left(), geometry.top_right()
        return box(min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))
    if isinstance(geometry, PolygonGeometry):
        return unary_union([
            Polygon([point[:2] for point in region.outer], [[point[:2] for point in hole] for hole in region.holes])
            for region in classify_polygon_loops(geometry.polygons())
        ])
    raise ValueError("Unsupported bump footprint")
