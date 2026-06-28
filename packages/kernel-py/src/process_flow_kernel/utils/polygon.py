from __future__ import annotations

from dataclasses import dataclass

from .math_utils import math


@dataclass(frozen=True)
class PolygonRegion:
    outer: list
    holes: list
    z: float


def validate_polygon_loops(polys):
    loops = [_normalize_loop(poly, index) for index, poly in enumerate(polys)]
    if len(loops) == 0:
        raise ValueError("PolygonGeometry requires at least one polygon loop")

    z_base = loops[0][0][2]
    for loop_index, loop in enumerate(loops):
        for point in loop:
            if math.f_ne(point[2], z_base):
                raise ValueError(
                    f"PolygonGeometry loops must be on the same xy plane (loop {loop_index})"
                )
        _validate_single_loop(loop, loop_index)

    _validate_loop_boundaries_do_not_cross(loops)
    return loops


def classify_polygon_loops(polys):
    loops = validate_polygon_loops(polys)
    depths = []
    for loop in loops:
        probe = loop[0]
        depths.append(
            sum(1 for other in loops if other is not loop and _point_strictly_in_loop(probe, other))
        )

    regions = []
    for index, loop in enumerate(loops):
        if depths[index] % 2 != 0:
            continue

        holes = []
        for hole_index, hole in enumerate(loops):
            if depths[hole_index] != depths[index] + 1:
                continue
            if _point_in_loop(hole[0], loop):
                holes.append(hole)

        regions.append(PolygonRegion(loop, holes, loop[0][2]))

    if len(regions) == 0:
        raise ValueError("PolygonGeometry does not contain any hull loop")
    return regions


def _normalize_loop(poly, index):
    if len(poly) < 3:
        raise ValueError(f"PolygonGeometry loop {index} requires at least 3 points")

    loop = []
    for point_index, point in enumerate(poly):
        if len(point) != 3:
            raise ValueError(
                f"PolygonGeometry points must be [x, y, z] (loop {index}, point {point_index})"
            )
        loop.append([point[0], point[1], point[2]])

    if _same_point(loop[0], loop[-1]):
        loop = loop[:-1]

    if len(loop) < 3:
        raise ValueError(f"PolygonGeometry loop {index} requires at least 3 unique points")
    return loop


def _validate_single_loop(loop, loop_index):
    for left_index, left in enumerate(loop):
        for right_index, right in enumerate(loop):
            if right_index <= left_index:
                continue
            if _same_point(left, right):
                raise ValueError(f"PolygonGeometry loop contains duplicate points (loop {loop_index})")

    edge_count = len(loop)
    for i in range(edge_count):
        a1 = loop[i]
        a2 = loop[(i + 1) % edge_count]
        if _same_point(a1, a2):
            raise ValueError(f"PolygonGeometry loop {loop_index} has zero-length edge")

        for j in range(i + 1, edge_count):
            if _edges_are_adjacent(i, j, edge_count):
                continue
            b1 = loop[j]
            b2 = loop[(j + 1) % edge_count]
            if _segments_intersect(a1, a2, b1, b2):
                raise ValueError(f"PolygonGeometry loop self-intersects (loop {loop_index})")

    if math.f_eq(_signed_area(loop), 0):
        raise ValueError(f"PolygonGeometry loop {loop_index} has zero area")


def _validate_loop_boundaries_do_not_cross(loops):
    for left_index, left in enumerate(loops):
        for right_index, right in enumerate(loops):
            if right_index <= left_index:
                continue
            has_point_touch = False
            for a1, a2 in _edges(left):
                for b1, b2 in _edges(right):
                    if _segments_intersect(a1, a2, b1, b2):
                        if _segments_touch_only_at_endpoints(a1, a2, b1, b2):
                            has_point_touch = True
                            continue
                        raise ValueError(
                            f"PolygonGeometry loops intersect or touch (loops {left_index} and {right_index})"
                        )
            if has_point_touch and _loops_are_nested(left, right):
                raise ValueError(
                    f"PolygonGeometry loops intersect or touch (loops {left_index} and {right_index})"
                )


def _edges(loop):
    for index in range(len(loop)):
        yield loop[index], loop[(index + 1) % len(loop)]


def _edges_are_adjacent(left, right, edge_count):
    return abs(left - right) == 1 or (len({left, right}) == 2 and left + right == edge_count - 1)


def _segments_intersect(a1, a2, b1, b2):
    o1 = _orientation(a1, a2, b1)
    o2 = _orientation(a1, a2, b2)
    o3 = _orientation(b1, b2, a1)
    o4 = _orientation(b1, b2, a2)

    if o1 != o2 and o3 != o4:
        return True
    if o1 == 0 and _on_segment(a1, b1, a2):
        return True
    if o2 == 0 and _on_segment(a1, b2, a2):
        return True
    if o3 == 0 and _on_segment(b1, a1, b2):
        return True
    if o4 == 0 and _on_segment(b1, a2, b2):
        return True
    return False


def _segments_touch_only_at_endpoints(a1, a2, b1, b2):
    shared = [
        a1 if _same_point2(a1, b1) else None,
        a1 if _same_point2(a1, b2) else None,
        a2 if _same_point2(a2, b1) else None,
        a2 if _same_point2(a2, b2) else None,
    ]
    unique = _unique_points([point for point in shared if point is not None])
    if len(unique) != 1:
        return False

    touch_point = unique[0]
    candidates = [
        (a1, b1, b2),
        (a2, b1, b2),
        (b1, a1, a2),
        (b2, a1, a2),
    ]
    return not any(
        not _same_point2(point, touch_point) and _point_on_segment(edge_start, point, edge_end)
        for point, edge_start, edge_end in candidates
    )


def _loops_are_nested(left, right):
    return any(_point_strictly_in_loop(point, right) for point in left) or any(
        _point_strictly_in_loop(point, left) for point in right
    )


def _orientation(a, b, c):
    value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if math.f_eq(value, 0):
        return 0
    return 1 if value > 0 else -1


def _on_segment(a, b, c):
    return (
        math.f_le(min(a[0], c[0]), b[0])
        and math.f_le(b[0], max(a[0], c[0]))
        and math.f_le(min(a[1], c[1]), b[1])
        and math.f_le(b[1], max(a[1], c[1]))
    )


def _point_in_loop(point, loop):
    x, y = point[0], point[1]
    inside = False
    previous = loop[-1]
    for current in loop:
        if _point_on_segment(previous, point, current):
            return True

        yi_above = current[1] > y
        yj_above = previous[1] > y
        if yi_above != yj_above:
            x_at_y = ((previous[0] - current[0]) * (y - current[1])) / (
                previous[1] - current[1]
            ) + current[0]
            if x < x_at_y:
                inside = not inside
        previous = current
    return inside


def _point_strictly_in_loop(point, loop):
    if _point_on_loop_boundary(point, loop):
        return False
    return _point_in_loop(point, loop)


def _point_on_loop_boundary(point, loop):
    previous = loop[-1]
    for current in loop:
        if _point_on_segment(previous, point, current):
            return True
        previous = current
    return False


def _point_on_segment(a, b, c):
    return _orientation(a, c, b) == 0 and _on_segment(a, b, c)


def _signed_area(loop):
    area = 0
    for point, next_point in _edges(loop):
        area += point[0] * next_point[1] - next_point[0] * point[1]
    return area / 2


def _same_point(left, right):
    return math.f_eq(left[0], right[0]) and math.f_eq(left[1], right[1]) and math.f_eq(left[2], right[2])


def _same_point2(left, right):
    return math.f_eq(left[0], right[0]) and math.f_eq(left[1], right[1])


def _unique_points(points):
    unique = []
    for point in points:
        if not any(_same_point2(current, point) for current in unique):
            unique.append(point)
    return unique
