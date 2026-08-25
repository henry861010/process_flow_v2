from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any, Literal, cast

import numpy as np
from mesher.generators import generate_rectilinear_mesh
from mesher.circular import extend_circular_mesh, imprint_circle

from .meshing.extrusion import Dragger
from .models import Mesh3D
from .translation.standard_v1 import StandardV1Translator, _geometry_to_face

JsonObject = dict[str, Any]
ModelType = Literal[
    "Full_Model",
    "Quarter_Model",
    "Half_Model_X",
    "Half_Model_Y",
]
MODEL_TYPES: tuple[ModelType, ...] = (
    "Full_Model",
    "Quarter_Model",
    "Half_Model_X",
    "Half_Model_Y",
)
CIRCLE_CLEARANCE_TOLERANCE = 1e-6
CIRCLE_CENTER_TOLERANCE = 1e-6
CIRCLE_MINIMUM_QUAD_SCALED_JACOBIAN = 0.3


@dataclass(frozen=True, order=True)
class _CirclePattern:
    center_x: float
    center_y: float
    radius: float

    @property
    def center(self) -> tuple[float, float]:
        return (self.center_x, self.center_y)


@dataclass(frozen=True)
class _CircleExtension:
    inner: _CirclePattern
    outer: _CirclePattern
    center: tuple[float, float]


@dataclass(frozen=True)
class _CircleMeshingPlan:
    imprint_patterns: tuple[_CirclePattern, ...]
    extensions: tuple[_CircleExtension, ...]

    @property
    def extended_patterns(self) -> frozenset[_CirclePattern]:
        return frozenset(extension.outer for extension in self.extensions)


@dataclass(frozen=True)
class _ModelDomain:
    model_type: ModelType
    center_x: float | None = None
    center_y: float | None = None

    @property
    def restrict_x(self) -> bool:
        return self.model_type in {"Quarter_Model", "Half_Model_Y"}

    @property
    def restrict_y(self) -> bool:
        return self.model_type in {"Quarter_Model", "Half_Model_X"}


def build_mesh_from_structure(
    geometry_structure: JsonObject,
    *,
    element_size: float,
    model_type: ModelType = "Full_Model",
) -> Mesh3D:
    """Build a full or symmetry-reduced 2.5D mesh from a geometry structure.

    Reduced models use the center of the complete XY footprint bounds as
    their symmetry origin. ``Half_Model_X`` retains the upper half,
    ``Half_Model_Y`` retains the right half, and ``Quarter_Model`` retains the
    upper-right quarter.
    """
    normalized_element_size = _positive_finite_number(element_size, "elementSize")
    normalized_model_type = _normalize_model_type(model_type)
    root = _root_container(geometry_structure)

    # The translator annotates containers with priority during 3D pattern
    # extraction, so keep the caller's preview snapshot immutable.
    container = copy.deepcopy(root)
    translator = StandardV1Translator()
    base_face, faces = translator.get_2D_pattern(container)
    if base_face is None:
        raise ValueError("CDB export requires at least one geometry body or feature.")

    domain = _model_domain(
        normalized_model_type,
        [base_face, *faces],
    )
    if normalized_model_type != "Full_Model":
        _filter_container_to_domain(container, domain)
        base_face, faces = translator.get_2D_pattern(container)
        if base_face is None:
            raise ValueError(
                f"CDB export has no geometry with positive XY area in "
                f"{normalized_model_type}."
            )

    all_faces = [base_face, *faces]
    circle_patterns = _collect_circle_patterns(all_faces)
    planar_element_size = _planar_element_size(
        normalized_element_size,
        circle_patterns,
    )
    circle_band_width = 2.0 * planar_element_size
    _validate_circle_domain_topology(
        circle_patterns,
        domain,
        band_width=circle_band_width,
    )
    circle_plan = _build_circle_meshing_plan(
        base_face,
        all_faces,
        circle_patterns,
        band_width=circle_band_width,
    )
    _validate_circle_clearances(
        list(circle_plan.imprint_patterns),
        circle_band_width,
    )

    x_lines: list[float] = []
    y_lines: list[float] = []
    extended_patterns = circle_plan.extended_patterns
    for face in all_faces:
        if (
            face.get("type") == "CIRCLE"
            and _circle_pattern_from_face(face) in extended_patterns
        ):
            continue
        xs, ys = _face_grid_lines(face)
        x_lines.extend(xs)
        y_lines.extend(ys)

    _add_circle_support_lines(
        list(circle_plan.imprint_patterns),
        circle_band_width,
        x_lines,
        y_lines,
    )
    x_lines, y_lines = _restrict_grid_lines_to_domain(
        x_lines,
        y_lines,
        domain,
    )

    mesh_2d = generate_rectilinear_mesh(
        planar_element_size,
        x_lines,
        y_lines,
    )

    _imprint_circle_patterns(
        mesh_2d,
        list(circle_plan.imprint_patterns),
        band_width=circle_band_width,
        target_edge_size=planar_element_size,
    )
    _extend_circle_patterns(
        mesh_2d,
        circle_plan.extensions,
        element_size=planar_element_size,
    )
    elements_2d = _clockwise_elements(mesh_2d.elements)
    layer_infos = translator.get_3D_pattern(container)

    dragger = Dragger()
    dragger.set_2D(mesh_2d.nodes, elements_2d)
    return dragger.build(layer_infos, normalized_element_size)


def _normalize_model_type(value: Any) -> ModelType:
    if not isinstance(value, str) or value not in MODEL_TYPES:
        allowed = ", ".join(MODEL_TYPES)
        raise ValueError(f"model_type must be one of: {allowed}.")
    return cast(ModelType, value)


def _model_domain(
    model_type: ModelType,
    faces: list[JsonObject],
) -> _ModelDomain:
    if model_type == "Full_Model":
        return _ModelDomain(model_type=model_type)

    bounds = [_face_bounds(face) for face in faces]
    x_min = min(bound[0] for bound in bounds)
    y_min = min(bound[1] for bound in bounds)
    x_max = max(bound[2] for bound in bounds)
    y_max = max(bound[3] for bound in bounds)
    return _ModelDomain(
        model_type=model_type,
        center_x=(x_min + x_max) / 2.0,
        center_y=(y_min + y_max) / 2.0,
    )


def _filter_container_to_domain(
    container: JsonObject,
    domain: _ModelDomain,
) -> None:
    for field in ("bodies", "vias", "circuits", "bumps"):
        items = container.get(field, [])
        if items is None:
            items = []
        if not isinstance(items, list):
            raise ValueError(f"container.{field} must be a list")
        retained = []
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise ValueError(f"container.{field}[{index}] must be an object")
            geometry = item.get("geometry")
            if not isinstance(geometry, dict):
                raise ValueError(
                    f"container.{field}[{index}].geometry must be an object"
                )
            face = _geometry_to_face(geometry)
            if _face_intersects_domain(face, domain):
                retained.append(item)
        container[field] = retained

    children = container.get("children", [])
    if children is None:
        children = []
    if not isinstance(children, list):
        raise ValueError("container.children must be a list")
    for child_index, child in enumerate(children):
        if not isinstance(child, dict):
            raise ValueError(f"container.children[{child_index}] must be an object")
        _filter_container_to_domain(child, domain)


def _face_bounds(face: JsonObject) -> tuple[float, float, float, float]:
    face_type = face.get("type")
    dim = face.get("dim")
    if face_type == "BOX":
        if not isinstance(dim, list) or len(dim) != 4:
            raise ValueError("BOX face dim must be [xMin, yMin, xMax, yMax].")
        x1, y1, x2, y2 = (
            _finite_number(value, "BOX face dim") for value in dim
        )
        return min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)

    if face_type == "CIRCLE":
        pattern = _circle_pattern_from_face(face)
        return (
            pattern.center_x - pattern.radius,
            pattern.center_y - pattern.radius,
            pattern.center_x + pattern.radius,
            pattern.center_y + pattern.radius,
        )

    if face_type == "POLYGON":
        loops = _polygon_loops(face)
        xs = [point[0] for loop in loops for point in loop]
        ys = [point[1] for loop in loops for point in loop]
        return min(xs), min(ys), max(xs), max(ys)

    raise ValueError(f"Face type {face_type} is not supported by CDB export.")


def _face_intersects_domain(
    face: JsonObject,
    domain: _ModelDomain,
) -> bool:
    if domain.model_type == "Full_Model":
        return True

    face_type = face.get("type")
    if face_type == "BOX":
        x_min, y_min, x_max, y_max = _face_bounds(face)
        if domain.restrict_x and x_max <= _domain_center_x(domain):
            return False
        if domain.restrict_y and y_max <= _domain_center_y(domain):
            return False
        return x_max > x_min and y_max > y_min

    if face_type == "CIRCLE":
        pattern = _circle_pattern_from_face(face)
        dx = (
            max(_domain_center_x(domain) - pattern.center_x, 0.0)
            if domain.restrict_x
            else 0.0
        )
        dy = (
            max(_domain_center_y(domain) - pattern.center_y, 0.0)
            if domain.restrict_y
            else 0.0
        )
        return math.hypot(dx, dy) < pattern.radius

    if face_type == "POLYGON":
        return _polygon_intersection_area(face, domain) > _polygon_area_tolerance(face)

    raise ValueError(f"Face type {face_type} is not supported by CDB export.")


def _polygon_loops(face: JsonObject) -> list[list[tuple[float, float]]]:
    dim = face.get("dim")
    if not isinstance(dim, list) or not dim:
        raise ValueError("POLYGON face dim must be a non-empty list of polygon loops.")

    loops: list[list[tuple[float, float]]] = []
    for loop_index, polygon in enumerate(dim):
        if not isinstance(polygon, list) or len(polygon) < 3:
            raise ValueError(
                f"POLYGON face loop {loop_index} must contain at least 3 points."
            )
        loop = []
        for point in polygon:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                raise ValueError("POLYGON face point must be [x, y].")
            loop.append(
                (
                    _finite_number(point[0], "POLYGON face point x"),
                    _finite_number(point[1], "POLYGON face point y"),
                )
            )
        loops.append(loop)
    return loops


def _polygon_intersection_area(
    face: JsonObject,
    domain: _ModelDomain,
) -> float:
    loops = _polygon_loops(face)
    total_area = 0.0
    for loop_index, loop in enumerate(loops):
        depth = sum(
            _point_in_polygon(loop[0], candidate)
            for candidate_index, candidate in enumerate(loops)
            if candidate_index != loop_index
        )
        clipped = loop
        if domain.restrict_x:
            clipped = _clip_polygon_to_lower_bound(
                clipped,
                axis=0,
                bound=_domain_center_x(domain),
            )
        if domain.restrict_y:
            clipped = _clip_polygon_to_lower_bound(
                clipped,
                axis=1,
                bound=_domain_center_y(domain),
            )
        clipped_area = _polygon_area(clipped)
        total_area += clipped_area if depth % 2 == 0 else -clipped_area
    return max(0.0, total_area)


def _clip_polygon_to_lower_bound(
    polygon: list[tuple[float, float]],
    *,
    axis: int,
    bound: float,
) -> list[tuple[float, float]]:
    if not polygon:
        return []

    clipped: list[tuple[float, float]] = []
    start = polygon[-1]
    start_inside = start[axis] >= bound
    for end in polygon:
        end_inside = end[axis] >= bound
        if start_inside != end_inside:
            ratio = (bound - start[axis]) / (end[axis] - start[axis])
            intersection = [
                start[coordinate]
                + ratio * (end[coordinate] - start[coordinate])
                for coordinate in (0, 1)
            ]
            intersection[axis] = bound
            clipped.append((intersection[0], intersection[1]))
        if end_inside:
            clipped.append(end)
        start = end
        start_inside = end_inside
    return clipped


def _point_in_polygon(
    point: tuple[float, float],
    polygon: list[tuple[float, float]],
) -> bool:
    x, y = point
    inside = False
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y):
            x_intersection = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < x_intersection:
                inside = not inside
        previous = current
    return inside


def _polygon_area(polygon: list[tuple[float, float]]) -> float:
    if len(polygon) < 3:
        return 0.0
    return 0.5 * abs(
        sum(
            start[0] * end[1] - start[1] * end[0]
            for start, end in zip(polygon, [*polygon[1:], polygon[0]])
        )
    )


def _polygon_area_tolerance(face: JsonObject) -> float:
    loops = _polygon_loops(face)
    coordinate_scale = max(
        1.0,
        *(abs(value) for loop in loops for point in loop for value in point),
    )
    return 64.0 * np.finfo(np.float64).eps * coordinate_scale**2


def _validate_circle_domain_topology(
    circle_patterns: list[_CirclePattern],
    domain: _ModelDomain,
    *,
    band_width: float,
) -> None:
    if domain.model_type == "Full_Model":
        return

    # The external open-circle mesher supports sectors bounded by rays from
    # the circle center. Include its outer search margin so near-axis bands
    # fail here with a model-specific error instead of a topology error later.
    open_radius_margin = 0.6 * band_width
    for pattern in circle_patterns:
        selection_radius = pattern.radius + open_radius_margin
        boundaries = []
        if domain.restrict_x:
            boundaries.append(("x", pattern.center_x, _domain_center_x(domain)))
        if domain.restrict_y:
            boundaries.append(("y", pattern.center_y, _domain_center_y(domain)))
        for axis, circle_center, boundary in boundaries:
            offset = abs(circle_center - boundary)
            if (
                CIRCLE_CENTER_TOLERANCE < offset
                < selection_radius - CIRCLE_CENTER_TOLERANCE
            ):
                raise ValueError(
                    "Open circle meshing requires each intersecting symmetry "
                    f"boundary to pass through the circle center: modelType="
                    f"{domain.model_type}, circle {_circle_label(pattern)}, "
                    f"boundary {axis}={boundary:.12g}."
                )


def _restrict_grid_lines_to_domain(
    x_lines: list[float],
    y_lines: list[float],
    domain: _ModelDomain,
) -> tuple[list[float], list[float]]:
    if domain.restrict_x:
        center_x = _domain_center_x(domain)
        x_lines = [value for value in x_lines if value > center_x]
        x_lines.append(center_x)
    if domain.restrict_y:
        center_y = _domain_center_y(domain)
        y_lines = [value for value in y_lines if value > center_y]
        y_lines.append(center_y)
    return x_lines, y_lines


def _domain_center_x(domain: _ModelDomain) -> float:
    if domain.center_x is None:
        raise ValueError("The selected model domain does not define center_x.")
    return domain.center_x


def _domain_center_y(domain: _ModelDomain) -> float:
    if domain.center_y is None:
        raise ValueError("The selected model domain does not define center_y.")
    return domain.center_y


def _collect_circle_patterns(faces: list[JsonObject]) -> list[_CirclePattern]:
    patterns: set[_CirclePattern] = set()
    for face in faces:
        if face.get("type") != "CIRCLE":
            continue
        patterns.add(_circle_pattern_from_face(face))
    return sorted(patterns)


def _circle_pattern_from_face(face: JsonObject) -> _CirclePattern:
    dim = face.get("dim")
    if not isinstance(dim, list) or len(dim) != 3:
        raise ValueError("CIRCLE face dim must be [x, y, radius].")
    center_x, center_y, radius = (
        _finite_number(value, "CIRCLE face dim") for value in dim
    )
    if radius <= 0.0:
        raise ValueError("CIRCLE face radius must be greater than 0.")
    return _CirclePattern(center_x, center_y, radius)


def _build_circle_meshing_plan(
    base_face: JsonObject,
    faces: list[JsonObject],
    circle_patterns: list[_CirclePattern],
    *,
    band_width: float,
) -> _CircleMeshingPlan:
    imprint_only = _CircleMeshingPlan(tuple(circle_patterns), ())
    if base_face.get("type") != "CIRCLE" or len(circle_patterns) < 2:
        return imprint_only

    base_circle = _circle_pattern_from_face(base_face)
    if not all(
        _face_is_contained_by_circle(face, base_circle)
        for face in faces
    ):
        return imprint_only

    concentric = sorted(
        (
            pattern
            for pattern in circle_patterns
            if _same_circle_center(pattern, base_circle)
            and pattern.radius <= base_circle.radius + CIRCLE_CENTER_TOLERANCE
        ),
        key=lambda pattern: pattern.radius,
    )
    if len(concentric) < 2 or concentric[-1] != base_circle:
        return imprint_only

    non_concentric = [
        pattern
        for pattern in circle_patterns
        if pattern not in concentric
    ]
    source_index = None
    for index, candidate in enumerate(concentric[:-1]):
        if _line_pattern_crosses_annulus(
            faces,
            center=candidate.center,
            inner_radius=candidate.radius,
            outer_radius=base_circle.radius,
        ):
            continue
        if not all(
            _circle_band_is_inside_circle(
                pattern,
                candidate,
                band_width=band_width,
            )
            for pattern in non_concentric
        ):
            continue
        source_index = index
        break

    if source_index is None:
        return imprint_only

    extension_chain = concentric[source_index:]
    extension_center = extension_chain[0].center
    extensions = tuple(
        _CircleExtension(inner, outer, extension_center)
        for inner, outer in zip(extension_chain, extension_chain[1:])
    )
    extended_patterns = {
        extension.outer for extension in extensions
    }
    imprint_patterns = tuple(
        pattern
        for pattern in circle_patterns
        if pattern not in extended_patterns
    )
    return _CircleMeshingPlan(imprint_patterns, extensions)


def _same_circle_center(
    left: _CirclePattern,
    right: _CirclePattern,
) -> bool:
    return (
        abs(left.center_x - right.center_x) <= CIRCLE_CENTER_TOLERANCE
        and abs(left.center_y - right.center_y) <= CIRCLE_CENTER_TOLERANCE
    )


def _face_is_contained_by_circle(
    face: JsonObject,
    container: _CirclePattern,
) -> bool:
    if face.get("type") == "CIRCLE":
        pattern = _circle_pattern_from_face(face)
        center_distance = math.hypot(
            pattern.center_x - container.center_x,
            pattern.center_y - container.center_y,
        )
        return (
            center_distance + pattern.radius
            <= container.radius + CIRCLE_CENTER_TOLERANCE
        )

    points = [point for segment in _face_boundary_segments(face) for point in segment]
    return all(
        math.hypot(
            point[0] - container.center_x,
            point[1] - container.center_y,
        )
        <= container.radius + CIRCLE_CENTER_TOLERANCE
        for point in points
    )


def _line_pattern_crosses_annulus(
    faces: list[JsonObject],
    *,
    center: tuple[float, float],
    inner_radius: float,
    outer_radius: float,
) -> bool:
    for face in faces:
        if face.get("type") == "CIRCLE":
            continue
        for start, end in _face_boundary_segments(face):
            if _segment_intersects_annulus(
                start,
                end,
                center=center,
                inner_radius=inner_radius,
                outer_radius=outer_radius,
            ):
                return True
    return False


def _face_boundary_segments(
    face: JsonObject,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    face_type = face.get("type")
    dim = face.get("dim")
    loops: list[list[tuple[float, float]]] = []

    if face_type == "BOX":
        if not isinstance(dim, list) or len(dim) != 4:
            raise ValueError("BOX face dim must be [xMin, yMin, xMax, yMax].")
        x1, y1, x2, y2 = (
            _finite_number(value, "BOX face dim") for value in dim
        )
        loops.append([(x1, y1), (x2, y1), (x2, y2), (x1, y2)])
    elif face_type == "POLYGON":
        if not isinstance(dim, list):
            raise ValueError("POLYGON face dim must be a list of polygon loops.")
        for polygon in dim:
            if not isinstance(polygon, list):
                raise ValueError("POLYGON face loop must be a list.")
            loop: list[tuple[float, float]] = []
            for point in polygon:
                if not isinstance(point, (list, tuple)) or len(point) < 2:
                    raise ValueError("POLYGON face point must be [x, y].")
                loop.append(
                    (
                        _finite_number(point[0], "POLYGON face point x"),
                        _finite_number(point[1], "POLYGON face point y"),
                    )
                )
            loops.append(loop)
    else:
        raise ValueError(f"Face type {face_type} is not supported by CDB export.")

    segments = []
    for loop in loops:
        if len(loop) < 2:
            continue
        segments.extend(zip(loop, [*loop[1:], loop[0]]))
    return segments


def _segment_intersects_annulus(
    start: tuple[float, float],
    end: tuple[float, float],
    *,
    center: tuple[float, float],
    inner_radius: float,
    outer_radius: float,
) -> bool:
    start_offset = np.asarray(start, dtype=np.float64) - np.asarray(
        center,
        dtype=np.float64,
    )
    end_offset = np.asarray(end, dtype=np.float64) - np.asarray(
        center,
        dtype=np.float64,
    )
    direction = end_offset - start_offset
    length_squared = float(np.dot(direction, direction))
    if length_squared == 0.0:
        minimum_distance = maximum_distance = float(np.linalg.norm(start_offset))
    else:
        projection = float(-np.dot(start_offset, direction) / length_squared)
        projection = min(1.0, max(0.0, projection))
        closest = start_offset + projection * direction
        minimum_distance = float(np.linalg.norm(closest))
        maximum_distance = max(
            float(np.linalg.norm(start_offset)),
            float(np.linalg.norm(end_offset)),
        )
    return (
        maximum_distance >= inner_radius - CIRCLE_CENTER_TOLERANCE
        and minimum_distance <= outer_radius + CIRCLE_CENTER_TOLERANCE
    )


def _circle_band_is_inside_circle(
    pattern: _CirclePattern,
    container: _CirclePattern,
    *,
    band_width: float,
) -> bool:
    center_distance = math.hypot(
        pattern.center_x - container.center_x,
        pattern.center_y - container.center_y,
    )
    return (
        center_distance + pattern.radius + band_width
        < container.radius - CIRCLE_CLEARANCE_TOLERANCE
    )


def _planar_element_size(
    element_size: float,
    circle_patterns: list[_CirclePattern],
) -> float:
    if not circle_patterns:
        return element_size
    minimum_radius = min(pattern.radius for pattern in circle_patterns)
    return min(element_size, minimum_radius / 3.0)


def _validate_circle_clearances(
    circle_patterns: list[_CirclePattern],
    band_width: float,
) -> None:
    required_clearance = band_width + CIRCLE_CLEARANCE_TOLERANCE
    for left_index, left in enumerate(circle_patterns):
        for right in circle_patterns[left_index + 1 :]:
            center_distance = math.hypot(
                right.center_x - left.center_x,
                right.center_y - left.center_y,
            )
            clearance = max(
                center_distance - left.radius - right.radius,
                abs(left.radius - right.radius) - center_distance,
            )
            if clearance <= required_clearance:
                raise ValueError(
                    "Circle patterns have intersecting, tangent, or overlapping "
                    "imprint bands: "
                    f"{_circle_label(left)} and {_circle_label(right)}; "
                    f"clearance={clearance:.12g}, required>{required_clearance:.12g}."
                )


def _add_circle_support_lines(
    circle_patterns: list[_CirclePattern],
    band_width: float,
    x_lines: list[float],
    y_lines: list[float],
) -> None:
    for pattern in circle_patterns:
        support_radius = pattern.radius + 2.0 * band_width
        x_lines.extend(
            [
                pattern.center_x - support_radius,
                pattern.center_x + support_radius,
            ]
        )
        y_lines.extend(
            [
                pattern.center_y - support_radius,
                pattern.center_y + support_radius,
            ]
        )


def _imprint_circle_patterns(
    mesh_2d: Any,
    circle_patterns: list[_CirclePattern],
    *,
    band_width: float,
    target_edge_size: float,
) -> None:
    for pattern in circle_patterns:
        try:
            imprint_circle(
                mesh_2d,
                center=pattern.center,
                radius=pattern.radius,
                band_width=band_width,
                target_edge_size=target_edge_size,
                min_quad_scaled_jacobian=(
                    CIRCLE_MINIMUM_QUAD_SCALED_JACOBIAN
                ),
            )
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"Failed to imprint circle pattern {_circle_label(pattern)}: {exc}"
            ) from exc


def _extend_circle_patterns(
    mesh_2d: Any,
    extensions: tuple[_CircleExtension, ...],
    *,
    element_size: float,
) -> None:
    for extension in extensions:
        try:
            extend_circular_mesh(
                mesh_2d,
                element_size=element_size,
                center_x=extension.center[0],
                center_y=extension.center[1],
                inner_radius=extension.inner.radius,
                outer_radius=extension.outer.radius,
            )
        except (TypeError, ValueError, RuntimeError) as exc:
            raise ValueError(
                "Failed to extend circular mesh from "
                f"{_circle_label(extension.inner)} to "
                f"{_circle_label(extension.outer)}: {exc}"
            ) from exc


def _clockwise_elements(elements: Any) -> np.ndarray:
    source = np.asarray(elements)
    if source.ndim != 2 or source.shape[1] != 4:
        raise ValueError("mesh2D.elements must have shape (m, 4).")

    clockwise = np.empty_like(source)
    triangle_mask = source[:, 2] == source[:, 3]
    clockwise[~triangle_mask] = source[~triangle_mask][:, [0, 3, 2, 1]]
    clockwise[triangle_mask] = source[triangle_mask][:, [0, 2, 1, 1]]
    return clockwise


def _circle_label(pattern: _CirclePattern) -> str:
    return (
        f"center=({pattern.center_x:.12g}, {pattern.center_y:.12g}), "
        f"radius={pattern.radius:.12g}"
    )


def _root_container(geometry_structure: JsonObject) -> JsonObject:
    if not isinstance(geometry_structure, dict):
        raise ValueError("geometryStructure must be an object.")
    root = geometry_structure.get("root")
    if not isinstance(root, dict):
        raise ValueError("geometryStructure.root must be an object.")
    return root


def _face_grid_lines(face: JsonObject) -> tuple[list[float], list[float]]:
    face_type = face.get("type")
    dim = face.get("dim")

    if face_type == "BOX":
        if not isinstance(dim, list) or len(dim) != 4:
            raise ValueError("BOX face dim must be [xMin, yMin, xMax, yMax].")
        x1, y1, x2, y2 = (_finite_number(value, "BOX face dim") for value in dim)
        return [x1, x2], [y1, y2]

    if face_type == "POLYGON":
        if not isinstance(dim, list):
            raise ValueError("POLYGON face dim must be a list of polygon loops.")
        xs: list[float] = []
        ys: list[float] = []
        for polygon in dim:
            if not isinstance(polygon, list):
                raise ValueError("POLYGON face loop must be a list.")
            for point in polygon:
                if not isinstance(point, (list, tuple)) or len(point) < 2:
                    raise ValueError("POLYGON face point must be [x, y].")
                xs.append(_finite_number(point[0], "POLYGON face point x"))
                ys.append(_finite_number(point[1], "POLYGON face point y"))
        return xs, ys

    if face_type == "CIRCLE":
        if not isinstance(dim, list) or len(dim) != 3:
            raise ValueError("CIRCLE face dim must be [x, y, radius].")
        x, y, radius = (_finite_number(value, "CIRCLE face dim") for value in dim)
        if radius <= 0:
            raise ValueError("CIRCLE face radius must be greater than 0.")
        return [x - radius, x + radius], [y - radius, y + radius]

    raise ValueError(f"Face type {face_type} is not supported by CDB export.")


def _positive_finite_number(value: float, name: str) -> float:
    number = _finite_number(value, name)
    if number <= 0:
        raise ValueError(f"{name} must be greater than 0.")
    return number


def _finite_number(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number.") from exc
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number.")
    return number
