from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from mesher.generators import generate_rectilinear_mesh
from mesher.circular import imprint_circle

from .meshing.extrusion import Dragger
from .models import Mesh3D
from .translation.standard_v1 import StandardV1Translator

JsonObject = dict[str, Any]
CIRCLE_CLEARANCE_TOLERANCE = 1e-6
CIRCLE_MINIMUM_QUAD_SCALED_JACOBIAN = 0.3


@dataclass(frozen=True, order=True)
class _CirclePattern:
    center_x: float
    center_y: float
    radius: float

    @property
    def center(self) -> tuple[float, float]:
        return (self.center_x, self.center_y)


def build_mesh_from_structure(
    geometry_structure: JsonObject,
    *,
    element_size: float,
) -> Mesh3D:
    """Build a 2.5D fixed-connectivity mesh from a geometry structure."""
    normalized_element_size = _positive_finite_number(element_size, "elementSize")
    root = _root_container(geometry_structure)

    # The translator annotates containers with priority during 3D pattern
    # extraction, so keep the caller's preview snapshot immutable.
    container = copy.deepcopy(root)
    translator = StandardV1Translator()
    base_face, faces = translator.get_2D_pattern(container)
    if base_face is None:
        raise ValueError("CDB export requires at least one geometry body or feature.")

    all_faces = [base_face, *faces]
    circle_patterns = _collect_circle_patterns(all_faces)
    planar_element_size = _planar_element_size(
        normalized_element_size,
        circle_patterns,
    )
    circle_band_width = 2.0 * planar_element_size
    _validate_circle_clearances(circle_patterns, circle_band_width)

    x_lines: list[float] = []
    y_lines: list[float] = []
    for face in all_faces:
        xs, ys = _face_grid_lines(face)
        x_lines.extend(xs)
        y_lines.extend(ys)

    _add_circle_support_lines(
        circle_patterns,
        circle_band_width,
        x_lines,
        y_lines,
    )

    mesh_2d = generate_rectilinear_mesh(
        planar_element_size,
        x_lines,
        y_lines,
    )
    
    _imprint_circle_patterns(
        mesh_2d,
        circle_patterns,
        band_width=circle_band_width,
        target_edge_size=planar_element_size,
    )
    elements_2d = _clockwise_elements(mesh_2d.elements)
    layer_infos = translator.get_3D_pattern(container)

    dragger = Dragger()
    dragger.set_2D(mesh_2d.nodes, elements_2d)
    return dragger.build(layer_infos, normalized_element_size)


def _collect_circle_patterns(faces: list[JsonObject]) -> list[_CirclePattern]:
    patterns: set[_CirclePattern] = set()
    for face in faces:
        if face.get("type") != "CIRCLE":
            continue
        dim = face.get("dim")
        if not isinstance(dim, list) or len(dim) != 3:
            raise ValueError("CIRCLE face dim must be [x, y, radius].")
        center_x, center_y, radius = (
            _finite_number(value, "CIRCLE face dim") for value in dim
        )
        if radius <= 0.0:
            raise ValueError("CIRCLE face radius must be greater than 0.")
        patterns.add(_CirclePattern(center_x, center_y, radius))
    return sorted(patterns)


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
