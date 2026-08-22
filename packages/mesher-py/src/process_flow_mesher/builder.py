from __future__ import annotations

import copy
import math
from typing import Any

from .meshing.extrusion import Dragger
from .meshing.grid import build_rectilinear_grid
from .models import Mesh3D
from .translation.standard_v1 import StandardV1Translator

JsonObject = dict[str, Any]


def build_mesh_from_structure(
    geometry_structure: JsonObject,
    *,
    element_size: float,
) -> Mesh3D:
    """Build a 2.5D hexahedral mesh from a standard geometry structure."""
    normalized_element_size = _positive_finite_number(element_size, "elementSize")
    root = _root_container(geometry_structure)

    # The translator annotates containers with priority during 3D pattern
    # extraction, so keep the caller's preview snapshot immutable.
    container = copy.deepcopy(root)
    translator = StandardV1Translator()
    base_face, faces = translator.get_2D_pattern(container)
    if base_face is None:
        raise ValueError("CDB export requires at least one geometry body or feature.")

    x_lines: list[float] = []
    y_lines: list[float] = []
    for face in [base_face, *faces]:
        xs, ys = _face_grid_lines(face)
        x_lines.extend(xs)
        y_lines.extend(ys)

    nodes_2d, elements_2d = build_rectilinear_grid(
        normalized_element_size,
        x_lines,
        y_lines,
    )
    layer_infos = translator.get_3D_pattern(container)

    dragger = Dragger()
    dragger.set_2D(nodes_2d, elements_2d)
    return dragger.build(layer_infos, normalized_element_size)


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
