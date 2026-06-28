from __future__ import annotations

from ..serialization.schema import deep_copy
from ..utils.math_utils import math
from ..utils.polygon import validate_polygon_loops


class Geometry:
    def z_min(self):
        raise NotImplementedError

    def z_max(self):
        raise NotImplementedError

    def thk(self):
        raise NotImplementedError

    def copy(self):
        raise NotImplementedError

    def copy_with_thk(self, thk):
        raise NotImplementedError

    def copy_with_xy_inset(self, inset):
        raise NotImplementedError

    def move(self, x=0, y=0, z=0):
        raise NotImplementedError

    def clip_top_to(self, to_z):
        raise NotImplementedError

    def clip_xy_to_box(self, bounds):
        raise NotImplementedError

    def flip(self, around_z=0):
        raise NotImplementedError

    def json(self):
        raise NotImplementedError


class BoxGeometry(Geometry):
    def __init__(self, bottom_left, top_right, thk):
        if bottom_left[2] != top_right[2]:
            raise ValueError("BoxGeometry bottom_left and top_right must be on the same xy plane.")
        self._bottom_left = deep_copy(bottom_left)
        self._top_right = deep_copy(top_right)
        self._thk = thk

    def bottom_left(self):
        return deep_copy(self._bottom_left)

    def top_right(self):
        return deep_copy(self._top_right)

    def z_min(self):
        return min(self._bottom_left[2], self._top_right[2])

    def z_max(self):
        return self.z_min() + self._thk

    def thk(self):
        return self._thk

    def copy(self):
        return BoxGeometry(self._bottom_left, self._top_right, self._thk)

    def copy_with_thk(self, thk):
        return BoxGeometry(self._bottom_left, self._top_right, thk)

    def copy_with_xy_inset(self, inset):
        amount = _finite_number(inset, "inset")
        x_min = min(self._bottom_left[0], self._top_right[0]) + amount
        x_max = max(self._bottom_left[0], self._top_right[0]) - amount
        y_min = min(self._bottom_left[1], self._top_right[1]) + amount
        y_max = max(self._bottom_left[1], self._top_right[1]) - amount
        if x_min >= x_max or y_min >= y_max:
            raise ValueError("BoxGeometry XY inset collapses the footprint")
        return BoxGeometry([x_min, y_min, self.z_min()], [x_max, y_max, self.z_min()], self._thk)

    def move(self, x=0, y=0, z=0):
        self._bottom_left[0] += x
        self._top_right[0] += x
        self._bottom_left[1] += y
        self._top_right[1] += y
        self._bottom_left[2] += z
        self._top_right[2] += z

    def clip_top_to(self, to_z):
        z_bottom = self.z_min()
        z_top = z_bottom + self._thk
        if math.f_le(to_z, z_bottom):
            return False
        if math.f_lt(z_bottom, to_z) and math.f_lt(to_z, z_top):
            self._thk = to_z - z_bottom
        return True

    def clip_xy_to_box(self, bounds):
        crop = _normalize_crop_box(bounds)
        x_min = max(min(self._bottom_left[0], self._top_right[0]), crop["xMin"])
        x_max = min(max(self._bottom_left[0], self._top_right[0]), crop["xMax"])
        y_min = max(min(self._bottom_left[1], self._top_right[1]), crop["yMin"])
        y_max = min(max(self._bottom_left[1], self._top_right[1]), crop["yMax"])
        if math.f_le(x_max, x_min) or math.f_le(y_max, y_min):
            return False
        z = self.z_min()
        self._bottom_left = [x_min, y_min, z]
        self._top_right = [x_max, y_max, z]
        return True

    def flip(self, around_z=0):
        flipped_z = 2 * around_z - self.z_max()
        self._bottom_left[2] = flipped_z
        self._top_right[2] = flipped_z

    def json(self):
        return {
            "type": "BoxGeometry",
            "bottom_left": deep_copy(self._bottom_left),
            "top_right": deep_copy(self._top_right),
            "thk": self._thk,
        }


class PolygonGeometry(Geometry):
    def __init__(self, polys, thk):
        validate_polygon_loops(polys)
        self._polys = deep_copy(polys)
        self._thk = thk

    def polygons(self):
        return deep_copy(self._polys)

    def z_min(self):
        return self._polys[0][0][2]

    def z_max(self):
        return self.z_min() + self._thk

    def thk(self):
        return self._thk

    def copy(self):
        return PolygonGeometry(self._polys, self._thk)

    def copy_with_thk(self, thk):
        return PolygonGeometry(self._polys, thk)

    def copy_with_xy_inset(self, inset):
        amount = _finite_number(inset, "inset")
        if amount == 0:
            return self.copy()
        raise ValueError("PolygonGeometry does not support non-zero XY inset")

    def move(self, x=0, y=0, z=0):
        for poly in self._polys:
            for node in poly:
                node[0] += x
                node[1] += y
                node[2] += z

    def clip_top_to(self, to_z):
        z_bottom = self.z_min()
        z_top = z_bottom + self._thk
        if math.f_le(to_z, z_bottom):
            return False
        if math.f_lt(z_bottom, to_z) and math.f_lt(to_z, z_top):
            self._thk = to_z - z_bottom
        return True

    def clip_xy_to_box(self, bounds):
        crop = _normalize_crop_box(bounds)
        clipped = []
        for poly in self._polys:
            loop = _clip_loop_to_box(poly, crop)
            if len(loop) >= 3:
                clipped.append(loop)
        if len(clipped) == 0:
            return False
        validate_polygon_loops(clipped)
        self._polys = clipped
        return True

    def flip(self, around_z=0):
        flipped_z = 2 * around_z - self.z_max()
        for poly in self._polys:
            for node in poly:
                node[2] = flipped_z

    def json(self):
        return {
            "type": "PolygonGeometry",
            "polys": deep_copy(self._polys),
            "thk": self._thk,
        }


class CylinderGeometry(Geometry):
    def __init__(self, center, bottom_radius, thk):
        self._center = deep_copy(center)
        self._bottom_radius = bottom_radius
        self._thk = thk

    def center(self):
        return deep_copy(self._center)

    def bottom_radius(self):
        return self._bottom_radius

    def z_min(self):
        return self._center[2]

    def z_max(self):
        return self.z_min() + self._thk

    def thk(self):
        return self._thk

    def copy(self):
        return CylinderGeometry(self._center, self._bottom_radius, self._thk)

    def copy_with_thk(self, thk):
        return CylinderGeometry(self._center, self._bottom_radius, thk)

    def copy_with_xy_inset(self, inset):
        radius = self._bottom_radius - _finite_number(inset, "inset")
        if radius <= 0:
            raise ValueError("CylinderGeometry XY inset collapses the footprint")
        return CylinderGeometry(self._center, radius, self._thk)

    def move(self, x=0, y=0, z=0):
        self._center[0] += x
        self._center[1] += y
        self._center[2] += z

    def clip_top_to(self, to_z):
        z_bottom = self.z_min()
        z_top = z_bottom + self._thk
        if math.f_le(to_z, z_bottom):
            return False
        if math.f_lt(z_bottom, to_z) and math.f_lt(to_z, z_top):
            self._thk = to_z - z_bottom
        return True

    def clip_xy_to_box(self, bounds):
        return _clip_circular_footprint_to_box(
            bounds=bounds,
            center=self._center,
            radius=self._bottom_radius,
            type_name="CylinderGeometry",
        )

    def flip(self, around_z=0):
        self._center[2] = 2 * around_z - self.z_max()

    def json(self):
        return {
            "type": "CylinderGeometry",
            "center": deep_copy(self._center),
            "bottom_radius": self._bottom_radius,
            "thk": self._thk,
        }


class ConeGeometry(Geometry):
    def __init__(self, center, bottom_radius, top_radius, thk):
        self._center = deep_copy(center)
        self._bottom_radius = bottom_radius
        self._top_radius = top_radius
        self._thk = thk

    def center(self):
        return deep_copy(self._center)

    def bottom_radius(self):
        return self._bottom_radius

    def top_radius(self):
        return self._top_radius

    def z_min(self):
        return self._center[2]

    def z_max(self):
        return self.z_min() + self._thk

    def thk(self):
        return self._thk

    def copy(self):
        return ConeGeometry(self._center, self._bottom_radius, self._top_radius, self._thk)

    def copy_with_thk(self, thk):
        return ConeGeometry(self._center, self._bottom_radius, self._top_radius, thk)

    def copy_with_xy_inset(self, inset):
        amount = _finite_number(inset, "inset")
        bottom_radius = self._bottom_radius - amount
        top_radius = self._top_radius - amount
        if bottom_radius <= 0 or top_radius <= 0:
            raise ValueError("ConeGeometry XY inset collapses the footprint")
        return ConeGeometry(self._center, bottom_radius, top_radius, self._thk)

    def move(self, x=0, y=0, z=0):
        self._center[0] += x
        self._center[1] += y
        self._center[2] += z

    def clip_top_to(self, to_z):
        z_bottom = self.z_min()
        z_top = z_bottom + self._thk
        if math.f_le(to_z, z_bottom):
            return False
        if math.f_lt(z_bottom, to_z) and math.f_lt(to_z, z_top):
            self._thk = to_z - z_bottom
        return True

    def clip_xy_to_box(self, bounds):
        return _clip_circular_footprint_to_box(
            bounds=bounds,
            center=self._center,
            radius=max(self._bottom_radius, self._top_radius),
            type_name="ConeGeometry",
        )

    def flip(self, around_z=0):
        self._center[2] = 2 * around_z - self.z_max()
        self._bottom_radius, self._top_radius = self._top_radius, self._bottom_radius

    def json(self):
        return {
            "type": "ConeGeometry",
            "center": deep_copy(self._center),
            "bottom_radius": self._bottom_radius,
            "top_radius": self._top_radius,
            "thk": self._thk,
        }


def _finite_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if number in (float("inf"), float("-inf")) or number != number:
        raise ValueError(f"{label} must be a finite number")
    return number


def _normalize_crop_box(bounds):
    x_min = _finite_number(bounds.get("xMin"), "bounds.xMin")
    x_max = _finite_number(bounds.get("xMax"), "bounds.xMax")
    y_min = _finite_number(bounds.get("yMin"), "bounds.yMin")
    y_max = _finite_number(bounds.get("yMax"), "bounds.yMax")
    if math.f_le(x_max, x_min) or math.f_le(y_max, y_min):
        raise ValueError("clipXYToBox requires a non-empty XY box")
    return {"xMin": x_min, "xMax": x_max, "yMin": y_min, "yMax": y_max}


def _clip_circular_footprint_to_box(*, bounds, center, radius, type_name):
    crop = _normalize_crop_box(bounds)
    r = _finite_number(radius, "radius")
    x = center[0]
    y = center[1]
    if (
        math.f_ge(x - r, crop["xMin"])
        and math.f_le(x + r, crop["xMax"])
        and math.f_ge(y - r, crop["yMin"])
        and math.f_le(y + r, crop["yMax"])
    ):
        return True

    closest_x = min(max(x, crop["xMin"]), crop["xMax"])
    closest_y = min(max(y, crop["yMin"]), crop["yMax"])
    dx = x - closest_x
    dy = y - closest_y
    if math.f_ge(dx * dx + dy * dy, r * r):
        return False

    raise ValueError(f"{type_name} does not support partial XY saw clipping")


def _clip_loop_to_box(loop, bounds):
    z = loop[0][2]
    result = [list(point) for point in loop]
    result = _clip_loop_against_boundary(result, bounds, _inside_left, _intersect_left)
    result = _clip_loop_against_boundary(result, bounds, _inside_right, _intersect_right)
    result = _clip_loop_against_boundary(result, bounds, _inside_bottom, _intersect_bottom)
    result = _clip_loop_against_boundary(result, bounds, _inside_top, _intersect_top)
    return _clean_loop([[math.f_zero(x), math.f_zero(y), z] for x, y, _ in result])


def _clip_loop_against_boundary(loop, bounds, inside, intersect):
    if len(loop) == 0:
        return []
    result = []
    previous = loop[-1]
    previous_inside = inside(previous, bounds)
    for current in loop:
        current_inside = inside(current, bounds)
        if current_inside:
            if not previous_inside:
                result.append(intersect(previous, current, bounds))
            result.append(current)
        elif previous_inside:
            result.append(intersect(previous, current, bounds))
        previous = current
        previous_inside = current_inside
    return _clean_adjacent_duplicates(result)


def _inside_left(point, bounds):
    return math.f_ge(point[0], bounds["xMin"])


def _inside_right(point, bounds):
    return math.f_le(point[0], bounds["xMax"])


def _inside_bottom(point, bounds):
    return math.f_ge(point[1], bounds["yMin"])


def _inside_top(point, bounds):
    return math.f_le(point[1], bounds["yMax"])


def _intersect_left(start, end, bounds):
    return _intersect_at_x(start, end, bounds["xMin"])


def _intersect_right(start, end, bounds):
    return _intersect_at_x(start, end, bounds["xMax"])


def _intersect_bottom(start, end, bounds):
    return _intersect_at_y(start, end, bounds["yMin"])


def _intersect_top(start, end, bounds):
    return _intersect_at_y(start, end, bounds["yMax"])


def _intersect_at_x(start, end, x):
    dx = end[0] - start[0]
    if math.f_eq(dx, 0):
        return [x, start[1], start[2]]
    t = (x - start[0]) / dx
    return [x, start[1] + t * (end[1] - start[1]), start[2]]


def _intersect_at_y(start, end, y):
    dy = end[1] - start[1]
    if math.f_eq(dy, 0):
        return [start[0], y, start[2]]
    t = (y - start[1]) / dy
    return [start[0] + t * (end[0] - start[0]), y, start[2]]


def _clean_loop(loop):
    cleaned = _clean_adjacent_duplicates(loop)
    if len(cleaned) > 1 and _same_point2(cleaned[0], cleaned[-1]):
        cleaned.pop()
    if len(cleaned) < 3 or math.f_eq(_signed_area2(cleaned), 0):
        return []
    return cleaned


def _clean_adjacent_duplicates(loop):
    result = []
    for point in loop:
        if len(result) == 0 or not _same_point2(result[-1], point):
            result.append(point)
    return result


def _signed_area2(loop):
    area = 0
    for index, point in enumerate(loop):
        next_point = loop[(index + 1) % len(loop)]
        area += point[0] * next_point[1] - next_point[0] * point[1]
    return area / 2


def _same_point2(left, right):
    return math.f_eq(left[0], right[0]) and math.f_eq(left[1], right[1])
