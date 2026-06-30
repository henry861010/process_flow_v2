from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from mesher.checkerboard import checkerboard_box
from mesher.dragger import Dragger
from translater.translater_standard_v1 import Translater

JsonObject = dict[str, Any]


@dataclass(frozen=True)
class MeshResult:
    nodes: np.ndarray
    elements: np.ndarray
    element_comps: np.ndarray
    comps: dict[str, int]

    @property
    def node_count(self) -> int:
        return int(self.nodes.shape[0])

    @property
    def element_count(self) -> int:
        return int(self.elements.shape[0])

    @property
    def component_count(self) -> int:
        return len(self.comps)


def build_mesh_from_structure(
    geometry_structure: JsonObject,
    *,
    element_size: float,
) -> MeshResult:
    """Build a 2.5D hexahedral mesh from a standard geometry structure."""
    dragger = build_dragger_from_structure(
        geometry_structure,
        element_size=element_size,
    )

    return MeshResult(
        nodes=np.asarray(dragger.nodes[: dragger.node_num], dtype=np.float64),
        elements=np.asarray(dragger.elements[: dragger.element_num], dtype=np.int32),
        element_comps=np.asarray(
            dragger.element_comps[: dragger.element_num],
            dtype=np.int32,
        ),
        comps=dict(dragger.comps),
    )


def build_dragger_from_structure(
    geometry_structure: JsonObject,
    *,
    element_size: float,
) -> Dragger:
    """Build and return a Dragger containing 3D mesh output buffers."""
    normalized_element_size = _positive_finite_number(element_size, "elementSize")
    root = _root_container(geometry_structure)

    # The translator annotates containers with priority during 3D pattern
    # extraction, so keep the caller's preview snapshot immutable.
    container = copy.deepcopy(root)
    translater = Translater()
    base_face, faces = translater.get_2D_pattern(container)
    if base_face is None:
        raise ValueError("CDB export requires at least one geometry body or feature.")

    x_lines: list[float] = []
    y_lines: list[float] = []
    for face in [base_face, *faces]:
        xs, ys = _face_grid_lines(face)
        x_lines.extend(xs)
        y_lines.extend(ys)

    nodes_2d, elements_2d = checkerboard_box(
        normalized_element_size,
        x_lines,
        y_lines,
    )
    layer_infos = translater.get_3D_pattern(container)

    dragger = Dragger()
    dragger.set_2D(nodes_2d, elements_2d)
    dragger.build(layer_infos, normalized_element_size)
    return dragger


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
