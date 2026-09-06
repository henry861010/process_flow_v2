from __future__ import annotations

from ..serialization.schema import deep_copy
from ..utils.math_utils import math
from ..utils.polygon import clip_polygon_loops_to_box, validate_polygon_loops


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

    def resize_xy_by(self, delta_x, delta_y):
        raise NotImplementedError

    def clip_top_to(self, to_z):
        raise NotImplementedError

    def clip_xy_to_box(self, bounds):
        """Return the retained geometry, or None when the crop removes it."""
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

    def resize_xy_by(self, delta_x, delta_y):
        resized_x = self._top_right[0] + _finite_number(delta_x, "deltaX")
        resized_y = self._top_right[1] + _finite_number(delta_y, "deltaY")
        if math.f_le(resized_x, self._bottom_left[0]) or math.f_le(
            resized_y, self._bottom_left[1]
        ):
            raise ValueError("BoxGeometry XY resize collapses the footprint")
        self._top_right[0] = resized_x
        self._top_right[1] = resized_y

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
            return None
        z = self.z_min()
        self._bottom_left = [x_min, y_min, z]
        self._top_right = [x_max, y_max, z]
        return self

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

    def resize_xy_by(self, delta_x, delta_y):
        _ = delta_x, delta_y
        raise ValueError("PnP XY resize supports only BoxGeometry")

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
        if all(
            math.f_ge(point[0], crop["xMin"])
            and math.f_le(point[0], crop["xMax"])
            and math.f_ge(point[1], crop["yMin"])
            and math.f_le(point[1], crop["yMax"])
            for poly in self._polys
            for point in poly
        ):
            return self
        clipped = clip_polygon_loops_to_box(self._polys, crop)
        if len(clipped) == 0:
            return None
        self._polys = clipped
        return self

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

    def resize_xy_by(self, delta_x, delta_y):
        _ = delta_x, delta_y
        raise ValueError("PnP XY resize supports only BoxGeometry")

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
        relation = _circular_footprint_box_relation(
            crop=crop, center=self._center, radius=self._bottom_radius
        )
        if relation == "circleInsideBox":
            return self
        if relation == "disjoint":
            return None
        if _box_is_inside_circle(crop=crop, center=self._center, radius=self._bottom_radius):
            return BoxGeometry(
                [crop["xMin"], crop["yMin"], self.z_min()],
                [crop["xMax"], crop["yMax"], self.z_min()],
                self._thk,
            )
        raise ValueError("CylinderGeometry does not support partial XY saw clipping")

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

    def resize_xy_by(self, delta_x, delta_y):
        _ = delta_x, delta_y
        raise ValueError("PnP XY resize supports only BoxGeometry")

    def clip_top_to(self, to_z):
        z_bottom = self.z_min()
        z_top = z_bottom + self._thk
        if math.f_le(to_z, z_bottom):
            return False
        if math.f_lt(z_bottom, to_z) and math.f_lt(to_z, z_top):
            self._thk = to_z - z_bottom
        return True

    def clip_xy_to_box(self, bounds):
        relation = _circular_footprint_box_relation(
            crop=_normalize_crop_box(bounds),
            center=self._center,
            radius=max(self._bottom_radius, self._top_radius),
        )
        if relation == "circleInsideBox":
            return self
        if relation == "disjoint":
            return None
        raise ValueError("ConeGeometry does not support partial XY saw clipping")

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


def _circular_footprint_box_relation(*, crop, center, radius):
    r = _finite_number(radius, "radius")
    x = center[0]
    y = center[1]
    if (
        math.f_ge(x - r, crop["xMin"])
        and math.f_le(x + r, crop["xMax"])
        and math.f_ge(y - r, crop["yMin"])
        and math.f_le(y + r, crop["yMax"])
    ):
        return "circleInsideBox"

    closest_x = min(max(x, crop["xMin"]), crop["xMax"])
    closest_y = min(max(y, crop["yMin"]), crop["yMax"])
    dx = x - closest_x
    dy = y - closest_y
    if math.f_ge(dx * dx + dy * dy, r * r):
        return "disjoint"

    return "partial"


def _box_is_inside_circle(*, crop, center, radius):
    r_squared = _finite_number(radius, "radius") ** 2
    x = center[0]
    y = center[1]
    return all(
        math.f_le((corner_x - x) ** 2 + (corner_y - y) ** 2, r_squared)
        for corner_x, corner_y in (
            (crop["xMin"], crop["yMin"]),
            (crop["xMin"], crop["yMax"]),
            (crop["xMax"], crop["yMin"]),
            (crop["xMax"], crop["yMax"]),
        )
    )
