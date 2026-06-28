from __future__ import annotations

from ..utils.math_utils import math

TYPE_EMPTY = 0
TYPE_DIE = 1
TYPE_TARGET = 2


class Region:
    def __init__(self, face_list=None, ref_face_list=None):
        self.cell_type = []
        self.cell_num_x = 0
        self.cell_num_y = 0
        self.table_x_dim = []
        self.table_y_dim = []
        self.face_list = []
        self.ref_face_list = []
        if face_list:
            self.set(face_list, ref_face_list or [])

    def _signed_area2(self, points):
        total = 0
        for index, (x1, y1) in enumerate(points):
            x2, y2 = points[(index + 1) % len(points)]
            total += x1 * y2 - x2 * y1
        return total

    def _is_clockwise(self, polygon):
        return self._signed_area2(polygon) < 0

    def _ensure_orientation(self, points, want_clockwise):
        if len(points) < 3:
            return points
        return points if want_clockwise == self._is_clockwise(points) else list(reversed(points))

    def _set_point_x(self, target_x):
        x = _finite_number(target_x, "x")
        for index, current in enumerate(self.table_x_dim):
            if math.f_eq(current, x):
                return
            if math.f_lt(current, x):
                continue
            new_column = [TYPE_EMPTY] * self.cell_num_y if index == 0 else list(self.cell_type[index - 1])
            self.cell_type.insert(index, new_column)
            self.table_x_dim.insert(index, x)
            self.cell_num_x += 1
            return
        self.cell_type.append([TYPE_EMPTY] * self.cell_num_y)
        self.table_x_dim.append(x)
        self.cell_num_x += 1

    def _set_point_y(self, target_y):
        y = _finite_number(target_y, "y")
        for index, current in enumerate(self.table_y_dim):
            if math.f_eq(current, y):
                return
            if math.f_lt(current, y):
                continue
            for x_index in range(len(self.cell_type)):
                value = TYPE_EMPTY if index == 0 else self.cell_type[x_index][index - 1]
                self.cell_type[x_index].insert(index, value)
            self.table_y_dim.insert(index, y)
            self.cell_num_y += 1
            return
        for column in self.cell_type:
            column.append(TYPE_EMPTY)
        self.table_y_dim.append(y)
        self.cell_num_y += 1

    def _set_point(self, x, y):
        self._set_point_x(x)
        self._set_point_y(y)

    def set(self, face_list=None, ref_face_list=None):
        face_list = face_list or []
        ref_face_list = ref_face_list or []
        for face in [*face_list, *ref_face_list]:
            if face.get("type") not in ("BOX", "POLYGON"):
                raise ValueError(f"[Region] the face type {face.get('type')} is not supported")

        self.face_list = [_normalize_face(face) for face in face_list]
        self.ref_face_list = [_normalize_face(face) for face in ref_face_list]

        x_values = {}
        y_values = {}
        for face in [*self.face_list, *self.ref_face_list]:
            if face["type"] == "BOX":
                x0, y0, x1, y1 = face["dim"]
                x_values[x0] = x0
                x_values[x1] = x1
                y_values[y0] = y0
                y_values[y1] = y1
                continue
            for x, y in face["dim"]:
                x_values[x] = x
                y_values[y] = y

        self.table_x_dim = sorted(x_values.values())
        self.table_y_dim = sorted(y_values.values())
        self.cell_num_x = max(0, len(self.table_x_dim) - 1)
        self.cell_num_y = max(0, len(self.table_y_dim) - 1)
        self.cell_type = [[TYPE_EMPTY] * self.cell_num_y for _ in range(self.cell_num_x)]
        if self.cell_num_x == 0 or self.cell_num_y == 0:
            return

        hull_polygons = []
        hole_polygons = []
        for face in self.face_list:
            if face["type"] == "BOX":
                self._mark_box(face["dim"], TYPE_DIE)
                continue
            if self._is_clockwise(face["dim"]):
                hull_polygons.append(face["dim"])
            else:
                hole_polygons.append(face["dim"])
        self._mark_polygons(hull_polygons, hole_polygons, TYPE_DIE)

    def set_gap(self, gap, *, set_to=TYPE_TARGET, target_mask=TYPE_DIE, is_recursive=False):
        max_gap = _finite_number(gap, "gap")
        if max_gap < 0:
            raise ValueError("gap must be non-negative")

        iteration_count = 0
        while True:
            did_change = False
            for i in range(self.cell_num_x):
                for j in range(self.cell_num_y):
                    if (self.cell_type[i][j] & target_mask) == 0:
                        if i > 0 and (self.cell_type[i - 1][j] & target_mask) != 0:
                            right = i + 1
                            while True:
                                if right >= self.cell_num_x:
                                    right = -1
                                    break
                                if (self.cell_type[right][j] & target_mask) != 0:
                                    break
                                right += 1
                            if right != -1 and math.f_le(self.table_x_dim[right] - self.table_x_dim[i], max_gap):
                                for k in range(i, right):
                                    did_change = self._set_cell_flag(k, j, set_to) or did_change

                        if j > 0 and (self.cell_type[i][j - 1] & target_mask) != 0:
                            upper = j + 1
                            while True:
                                if upper >= self.cell_num_y:
                                    upper = -1
                                    break
                                if (self.cell_type[i][upper] & target_mask) != 0:
                                    break
                                upper += 1
                            if upper != -1 and math.f_le(self.table_y_dim[upper] - self.table_y_dim[j], max_gap):
                                for k in range(j, upper):
                                    did_change = self._set_cell_flag(i, k, set_to) or did_change

                    if (self.cell_type[i][j] & set_to) != 0:
                        left = i - 1
                        while True:
                            if left < 0:
                                left = -1
                                break
                            if (self.cell_type[left][j] & target_mask) != 0:
                                left += 1
                                break
                            left -= 1
                        if left != -1 and math.f_le(self.table_x_dim[i] - self.table_x_dim[left], max_gap):
                            for k in range(left, i):
                                did_change = self._set_cell_flag(k, j, set_to) or did_change

            if not is_recursive:
                return did_change
            if not did_change:
                break
            iteration_count += 1
        return iteration_count != 0

    def get_outline(self, target_mask=TYPE_TARGET, is_detail=False):
        loops = [
            _remove_collinear_points(loop)
            for loop in _boundary_loops_from_cells(
                cell_type=self.cell_type,
                cell_num_x=self.cell_num_x,
                cell_num_y=self.cell_num_y,
                table_x_dim=self.table_x_dim,
                table_y_dim=self.table_y_dim,
                target_mask=target_mask,
            )
        ]
        valid_loops = [loop for loop in loops if len(loop) >= 3]
        oriented = _orient_nested_loops(valid_loops, self)
        if not is_detail:
            return oriented
        return [{"type": "POLYGON", "dim": loop, "holes": []} for loop in oriented]

    def _mark_box(self, box, set_to):
        for i in range(self.cell_num_x):
            cx = (self.table_x_dim[i] + self.table_x_dim[i + 1]) / 2
            for j in range(self.cell_num_y):
                cy = (self.table_y_dim[j] + self.table_y_dim[j + 1]) / 2
                if box[0] < cx < box[2] and box[1] < cy < box[3]:
                    self.cell_type[i][j] |= set_to

    def _mark_polygons(self, hull_polygons, hole_polygons, set_to):
        if len(hull_polygons) == 0:
            return
        for i in range(self.cell_num_x):
            cx = (self.table_x_dim[i] + self.table_x_dim[i + 1]) / 2
            for j in range(self.cell_num_y):
                cy = (self.table_y_dim[j] + self.table_y_dim[j + 1]) / 2
                point = [cx, cy]
                if not any(_point_in_loop(point, polygon) for polygon in hull_polygons):
                    continue
                if not any(_point_in_loop(point, polygon) for polygon in hole_polygons):
                    self.cell_type[i][j] |= set_to

    def _set_cell_flag(self, i, j, flag):
        if (self.cell_type[i][j] & flag) != 0:
            return False
        self.cell_type[i][j] |= flag
        return True


def _normalize_face(face):
    if face["type"] == "BOX":
        return {"type": "BOX", "dim": _normalize_box(face["dim"])}
    return {"type": "POLYGON", "dim": _normalize_polygon(face["dim"])}


def _normalize_box(box):
    if not isinstance(box, list) or len(box) < 4:
        raise ValueError("BOX dim must be [x0, y0, x1, y1]")
    x0 = _finite_number(box[0], "box[0]")
    y0 = _finite_number(box[1], "box[1]")
    x1 = _finite_number(box[2], "box[2]")
    y1 = _finite_number(box[3], "box[3]")
    if math.f_eq(x0, x1) or math.f_eq(y0, y1):
        raise ValueError("BOX dim must have non-zero width and height")
    return [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]


def _normalize_polygon(polygon):
    if not isinstance(polygon, list) or len(polygon) < 3:
        raise ValueError("POLYGON dim must contain at least three points")
    result = []
    for index, point in enumerate(polygon):
        if not isinstance(point, list) or len(point) < 2:
            raise ValueError(f"POLYGON point {index} must be [x, y]")
        result.append([
            _finite_number(point[0], f"polygon[{index}][0]"),
            _finite_number(point[1], f"polygon[{index}][1]"),
        ])
    if _same_point2(result[0], result[-1]):
        result = result[:-1]
    if len(result) < 3:
        raise ValueError("POLYGON dim must contain at least three unique points")
    return result


def _boundary_loops_from_cells(*, cell_type, cell_num_x, cell_num_y, table_x_dim, table_y_dim, target_mask):
    edges = []

    def add_edge(start, end, direction):
        edges.append(
            {
                "id": len(edges),
                "start": start,
                "end": end,
                "startKey": _point_key(start),
                "endKey": _point_key(end),
                "direction": direction,
            }
        )

    def is_target(i, j):
        return 0 <= i < cell_num_x and 0 <= j < cell_num_y and (cell_type[i][j] & target_mask) != 0

    for i in range(cell_num_x):
        for j in range(cell_num_y):
            if not is_target(i, j):
                continue
            x0 = table_x_dim[i]
            x1 = table_x_dim[i + 1]
            y0 = table_y_dim[j]
            y1 = table_y_dim[j + 1]
            if not is_target(i, j - 1):
                add_edge([x0, y0], [x1, y0], 0)
            if not is_target(i + 1, j):
                add_edge([x1, y0], [x1, y1], 1)
            if not is_target(i, j + 1):
                add_edge([x1, y1], [x0, y1], 2)
            if not is_target(i - 1, j):
                add_edge([x0, y1], [x0, y0], 3)

    by_start = {}
    for edge in edges:
        by_start.setdefault(edge["startKey"], []).append(edge)

    used = set()
    loops = []
    for first_edge in edges:
        if first_edge["id"] in used:
            continue
        loop = []
        edge = first_edge
        start_key = first_edge["startKey"]
        while edge and edge["id"] not in used:
            used.add(edge["id"])
            loop.append(edge["start"])
            if edge["endKey"] == start_key:
                break
            candidates = [candidate for candidate in by_start.get(edge["endKey"], []) if candidate["id"] not in used]
            edge = _choose_next_edge(edge, candidates)
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def _choose_next_edge(previous, candidates):
    if len(candidates) == 0:
        return None
    if len(candidates) == 1:
        return candidates[0]
    priority = {1: 0, 0: 1, 3: 2, 2: 3}
    return sorted(
        candidates,
        key=lambda candidate: priority[(candidate["direction"] - previous["direction"] + 4) % 4],
    )[0]


def _orient_nested_loops(loops, region):
    result = []
    for loop in loops:
        depth = sum(1 for other in loops if other is not loop and _point_in_loop(loop[0], other))
        result.append(region._ensure_orientation(loop, depth % 2 == 0))
    return result


def _remove_collinear_points(loop):
    result = []
    for index, current in enumerate(loop):
        previous = loop[(index - 1 + len(loop)) % len(loop)]
        next_point = loop[(index + 1) % len(loop)]
        if not _is_collinear(previous, current, next_point):
            result.append(current)
    return result


def _is_collinear(a, b, c):
    return math.f_eq((b[0] - a[0]) * (c[1] - a[1]), (b[1] - a[1]) * (c[0] - a[0]))


def _point_in_loop(point, loop):
    x, y = point
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


def _point_on_segment(a, b, c):
    return _orientation(a, c, b) == 0 and _on_segment(a, b, c)


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


def _same_point2(left, right):
    return math.f_eq(left[0], right[0]) and math.f_eq(left[1], right[1])


def _point_key(point):
    return f"{point[0]},{point[1]}"


def _finite_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if number in (float("inf"), float("-inf")) or number != number:
        raise ValueError(f"{label} must be a finite number")
    return number
