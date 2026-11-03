"""Envelope-based placement and joint planning, independent of serialized state."""
from __future__ import annotations

from dataclasses import dataclass
from math import hypot

from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

from .container import Container
from .features import Bump
from .geometry import BoxGeometry, ConeGeometry, CylinderGeometry, PolygonGeometry
from ..utils.math_utils import math
from ..utils.polygon import classify_polygon_loops


UNJOINED_STAGES = ("deposited", "reflowed")


@dataclass(frozen=True, slots=True)
class _BumpJointPlan:
    child: Container
    offset: float
    replacements: tuple[tuple[Bump, Bump], ...]
    actual_height: float
    support_materials: tuple[str, ...]


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
            and footprints_overlap(bump.geometry(), geometry)
        ]
        if len(lower) > 1:
            raise ValueError("PnP: bottom bump has multiple overlapping main bumps")
        heights.append(lower[0].thk() if lower else 0)
    if heights and any(math.f_ne(height, heights[0]) for height in heights[1:]):
        raise ValueError("PnP: source bottom bumps require different placement heights")
    return main_z + (heights[0] if heights else 0)


def plan_bump_joint(root, joined_height):
    """Validate the whole batch and prepare replacements before any mutation."""
    plans = []
    layer = None
    bodies = None
    for child in root.children():
        uppers = _joint_bottom_bumps(child)
        pairs = []
        for upper in uppers:
            lowers = [
                lower for lower in root.bumps()
                if lower.stage() == "reflowed"
                and math.f_eq(lower.z_max(), upper.z_min())
                and footprints_overlap(lower.geometry(), upper.geometry())
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
        for upper, lower in pairs:
            if math.f_ne(upper.z_max(), body_bottom):
                raise ValueError("Bump Joint: a child has inconsistent joint heights")
            pair_layer = (lower.z_min(), lower.z_max())
            if layer is None:
                layer = pair_layer
            elif any(math.f_ne(a, b) for a, b in zip(layer, pair_layer)):
                raise ValueError("Bump Joint: all matched bumps must be on the same layer")

        if bodies is None:
            bodies = tuple(_assembly_bodies(root))
        support_materials = tuple(sorted({
            body.material()
            for body in bodies
            if any(
                math.f_gt(min(body.z_max(), upper.z_max()), max(body.z_min(), lower.z_min()))
                and footprints_overlap(body.geometry(), upper.geometry())
                for upper, lower in pairs
            )
        }))
        actual_height = body_bottom - pairs[0][1].z_min() if support_materials else joined_height
        replacements = []
        for upper, lower in pairs:
            # A supported component keeps its exact position and upper surface,
            # including the tolerated differences between paired bump planes.
            height = upper.z_max() - lower.z_min() if support_materials else joined_height
            replacement = upper.copy_with_thk(height).copy_with_stage("joined")
            replacement.move(z=lower.z_min() - replacement.z_min())
            replacements.append((upper, replacement))
        offset = 0 if support_materials else pairs[0][1].z_min() + joined_height - body_bottom
        plans.append(_BumpJointPlan(child, offset, tuple(replacements), actual_height, support_materials))
    return plans


def _joint_bottom_bumps(container):
    """Fill bodies may extend below bumps without changing their bottom layer.

    Anchor to all direct bump stages so a repeated Joint cannot select a higher
    reflowed layer after the original bottom layer has become joined.
    """
    bumps = container.bumps()
    if not bumps:
        return []
    bottom = min(bump.z_min() for bump in bumps)
    return [bump for bump in bumps if bump.stage() == "reflowed" and math.f_eq(bump.z_min(), bottom)]


def _assembly_bodies(container):
    yield from container.bodies()
    for child in container.children():
        yield from _assembly_bodies(child)


def footprints_overlap(left, right):
    """Require positive XY overlap area; holes and exact circular bounds matter.

    Do not buffer footprints: touching at a point or edge is not a joint.
    Cone footprints retain the existing maximum-radius envelope semantics.
    """
    circular = (CylinderGeometry, ConeGeometry)
    if isinstance(left, circular):
        center, radius = _circle(left)
        if isinstance(right, circular):
            other_center, other_radius = _circle(right)
            return hypot(center[0] - other_center[0], center[1] - other_center[1]) < radius + other_radius
        return _region(right).distance(Point(center[:2])) < radius
    if isinstance(right, circular):
        return footprints_overlap(right, left)
    return _region(left).intersection(_region(right)).area > 0


def _circle(geometry):
    radius = geometry.bottom_radius()
    if isinstance(geometry, ConeGeometry):
        radius = max(radius, geometry.top_radius())
    return geometry.center(), radius


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
