from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from typing import Any, Literal

from process_flow_kernel import normalize_geometry_structure

from .exporter import CadBody, CadExportError, CadExportOptions, CadQueryConverter

JsonObject = dict[str, Any]
SectionAxis = Literal["x", "y"]
Point2D = list[float]
Loop2D = list[Point2D]


@dataclass(frozen=True, slots=True)
class _SectionFaceCandidate:
    body: CadBody
    face: Any


class PreparedSectionGeometry:
    """Resolved CAD bodies that can be sectioned repeatedly.

    Preparation performs geometry normalization, primitive conversion, overlap
    validation, same-material fusion, and parent/child subtraction once. The
    resulting OpenCascade shapes are retained for subsequent section queries.

    A prepared instance is safe to call from multiple Python threads. Queries
    for the same instance are serialized because OpenCascade does not provide a
    stable cross-version thread-safety guarantee for algorithms sharing shapes.
    Independent prepared instances can still be sectioned concurrently.
    """

    __slots__ = ("_bodies", "_cq", "_lock", "_unit_system")

    def __init__(
        self,
        *,
        cq: Any,
        bodies: list[CadBody],
        unit_system: str,
    ) -> None:
        self._cq = cq
        self._bodies = tuple(bodies)
        self._unit_system = unit_system
        self._lock = threading.RLock()

    @property
    def unit_system(self) -> str:
        return self._unit_system

    def section(
        self,
        *,
        axis: SectionAxis,
        position: float,
        tolerance: float = 0.1,
    ) -> dict[str, Any]:
        """Return exact material regions on one vertical section plane."""

        normalized_axis = _section_axis(axis)
        normalized_position = _finite_number(position, "section position")
        normalized_tolerance = _positive_number(tolerance, "section tolerance")

        with self._lock:
            return _section_resolved_bodies(
                cq=self._cq,
                bodies=self._bodies,
                unit_system=self._unit_system,
                axis=normalized_axis,
                position=normalized_position,
                tolerance=normalized_tolerance,
            )


def prepare_section_geometry(
    geometry_structure: JsonObject,
) -> PreparedSectionGeometry:
    """Normalize and resolve geometry once for repeated exact sections."""

    structure = normalize_geometry_structure(geometry_structure)
    converter = CadQueryConverter(CadExportOptions(include_feature_bodies=False))
    bodies = converter.convert_bodies(structure)
    unit_system = structure.get("unitSystem", "um")
    if not isinstance(unit_system, str) or not unit_system:
        raise CadExportError("Geometry unitSystem must be a non-empty string.")
    return PreparedSectionGeometry(
        cq=converter.cq,
        bodies=bodies,
        unit_system=unit_system,
    )


def section_geometry(
    geometry_structure: JsonObject,
    *,
    axis: SectionAxis,
    position: float,
    tolerance: float = 0.1,
) -> dict[str, Any]:
    """Prepare geometry and return exact regions on one vertical section plane.

    Use :func:`prepare_section_geometry` when requesting more than one section
    from the same geometry. This convenience API intentionally prepares a new
    resolved model for each call.

    Loops are explicitly closed. Outer loops are counter-clockwise and holes
    are clockwise in section coordinates. The start vertex is canonicalized,
    which makes repeated calls deterministic and suitable for content caches.

    ``axis="x"`` cuts at ``X=position`` and returns ``[y, z]`` points.
    ``axis="y"`` cuts at ``Y=position`` and returns ``[x, z]`` points.
    ``tolerance`` is the maximum deflection used to approximate curved edges;
    reported region areas remain the exact CAD face areas.
    """

    return prepare_section_geometry(geometry_structure).section(
        axis=axis,
        position=position,
        tolerance=tolerance,
    )


def _section_resolved_bodies(
    *,
    cq: Any,
    bodies: tuple[CadBody, ...],
    unit_system: str,
    axis: SectionAxis,
    position: float,
    tolerance: float,
) -> dict[str, Any]:
    plane = _section_plane(cq, axis, position)

    candidates: list[_SectionFaceCandidate] = []
    for body in bodies:
        if body.shape is None:
            continue
        try:
            section_shape = body.shape.intersect(plane)
            faces = section_shape.Faces()
        except Exception as error:
            raise CadExportError(f"Failed to section CAD body {body.id}.") from error

        for face in faces:
            area = abs(float(face.Area()))
            if not math.isfinite(area) or area <= 0:
                continue
            candidates.append(_SectionFaceCandidate(body=body, face=face))

    # A section plane that is exactly coplanar with a nested body's wall can
    # make OpenCascade return that wall twice: once for the child solid and
    # once for the cavity face cut into its parent.  Those are valid boundary
    # faces individually, but they are not valid material ownership regions --
    # rendering both makes the result depend on painter/depth order.  Resolve
    # all planar ownership here so every point belongs to at most one body.
    # Deeper containers claim first; deterministic body ids break ties between
    # unrelated bodies at the same depth.
    resolved_candidates = _resolve_material_face_ownership(candidates, axis=axis)

    regions = [
        _section_face_to_region(
            cq,
            candidate,
            axis=axis,
            tolerance=tolerance,
        )
        for candidate in resolved_candidates
    ]

    regions.sort(key=_region_sort_key)
    return {
        "unitSystem": unit_system,
        "axis": axis,
        "position": _clean_number(position),
        "regions": regions,
    }


def _resolve_material_face_ownership(
    candidates: list[_SectionFaceCandidate],
    *,
    axis: SectionAxis,
) -> list[_SectionFaceCandidate]:
    claimed_faces: list[Any] = []
    resolved: list[_SectionFaceCandidate] = []

    for candidate in sorted(candidates, key=_section_candidate_priority):
        remaining_faces = [candidate.face]
        for claimed_face in claimed_faces:
            next_faces: list[Any] = []
            for face in remaining_faces:
                if not _faces_have_positive_planar_overlap(
                    face,
                    claimed_face,
                    axis=axis,
                ):
                    next_faces.append(face)
                    continue
                try:
                    difference = face.cut(claimed_face)
                except Exception as error:
                    raise CadExportError(
                        "Failed to resolve material ownership for CAD section "
                        f"body {candidate.body.id}."
                    ) from error
                next_faces.extend(_positive_area_faces(difference))
            remaining_faces = next_faces
            if not remaining_faces:
                break

        remaining_faces.sort(key=_face_geometry_sort_key)
        for face in remaining_faces:
            resolved_candidate = _SectionFaceCandidate(
                body=candidate.body,
                face=face,
            )
            resolved.append(resolved_candidate)
            claimed_faces.append(face)

    return resolved


def _faces_have_positive_planar_overlap(
    left: Any,
    right: Any,
    *,
    axis: SectionAxis,
) -> bool:
    if not _projected_bounds_have_positive_overlap(left, right, axis=axis):
        return False
    try:
        common = left.intersect(right)
    except Exception as error:
        raise CadExportError("Failed to compare CAD section material regions.") from error
    return any(_positive_face_area(face) for face in common.Faces())


def _projected_bounds_have_positive_overlap(
    left: Any,
    right: Any,
    *,
    axis: SectionAxis,
) -> bool:
    left_bounds = left.BoundingBox()
    right_bounds = right.BoundingBox()
    projected_axes = ("y", "z") if axis == "x" else ("x", "z")
    for coordinate in projected_axes:
        overlap = min(
            _number_attribute(left_bounds, f"{coordinate}max"),
            _number_attribute(right_bounds, f"{coordinate}max"),
        ) - max(
            _number_attribute(left_bounds, f"{coordinate}min"),
            _number_attribute(right_bounds, f"{coordinate}min"),
        )
        if overlap <= 0:
            return False
    return True


def _positive_area_faces(shape: Any) -> list[Any]:
    return [face for face in shape.Faces() if _positive_face_area(face)]


def _positive_face_area(face: Any) -> bool:
    area = abs(float(face.Area()))
    return math.isfinite(area) and area > 0


def _section_candidate_priority(candidate: _SectionFaceCandidate) -> tuple[Any, ...]:
    body = candidate.body
    return (
        -len(body.container_ancestors),
        tuple(body.container_ancestors),
        str(body.container_id),
        str(body.id),
        str(body.material),
        _face_geometry_sort_key(candidate.face),
    )


def _face_geometry_sort_key(face: Any) -> tuple[float, ...]:
    bounds = face.BoundingBox()
    return (
        _number_attribute(bounds, "xmin"),
        _number_attribute(bounds, "ymin"),
        _number_attribute(bounds, "zmin"),
        _number_attribute(bounds, "xmax"),
        _number_attribute(bounds, "ymax"),
        _number_attribute(bounds, "zmax"),
        abs(float(face.Area())),
    )


def _number_attribute(value: Any, name: str) -> float:
    attribute = getattr(value, name)
    return float(attribute() if callable(attribute) else attribute)


def _section_face_to_region(
    cq: Any,
    candidate: _SectionFaceCandidate,
    *,
    axis: SectionAxis,
    tolerance: float,
) -> dict[str, Any]:
    body = candidate.body
    face = candidate.face
    area = abs(float(face.Area()))
    if not math.isfinite(area) or area <= 0:
        raise CadExportError("CAD section ownership produced an invalid face area.")

    outer_wire = face.outerWire()
    outer = _wire_to_loop(
        cq,
        outer_wire,
        axis=axis,
        tolerance=tolerance,
        clockwise=False,
    )
    holes = [
        _wire_to_loop(
            cq,
            wire,
            axis=axis,
            tolerance=tolerance,
            clockwise=True,
        )
        for wire in face.Wires()
        if not wire.isSame(outer_wire)
    ]
    holes.sort(key=_loop_sort_key)

    return {
        "bodyId": body.id,
        "sourceIds": list(body.source_ids),
        "containerId": body.container_id,
        "containerKey": body.container_key,
        "material": body.material,
        "bodyKind": body.body_kind,
        "featureType": body.feature_type,
        "approximationKind": "exact",
        "area": _clean_number(area),
        "outer": outer,
        "holes": holes,
    }


def _section_plane(cq: Any, axis: SectionAxis, position: float):
    if axis == "x":
        point = cq.Vector(position, 0, 0)
        normal = cq.Vector(1, 0, 0)
    else:
        point = cq.Vector(0, position, 0)
        normal = cq.Vector(0, 1, 0)
    return cq.Face.makePlane(basePnt=point, dir=normal)


def _wire_to_loop(
    cq: Any,
    wire: Any,
    *,
    axis: SectionAxis,
    tolerance: float,
    clockwise: bool,
) -> Loop2D:
    try:
        from OCP.BRepTools import BRepTools_WireExplorer
    except ImportError as error:
        raise CadExportError("CadQuery OCP section modules are unavailable.") from error

    explorer = BRepTools_WireExplorer(wire.wrapped)
    points: list[tuple[float, float, float]] = []
    join_epsilon = max(1e-9, min(tolerance * 1e-6, 1e-6))

    while explorer.More():
        edge = cq.Edge(explorer.Current())
        sampled, _ = edge.sample(float(tolerance))
        edge_points = [tuple(float(value) for value in point.toTuple()) for point in sampled]
        if not edge_points:
            explorer.Next()
            continue

        try:
            current_vertex = cq.Vertex(explorer.CurrentVertex())
            current_point = tuple(float(value) for value in current_vertex.toTuple())
            if _distance_squared(edge_points[-1], current_point) < _distance_squared(
                edge_points[0], current_point
            ):
                edge_points.reverse()
        except Exception:
            # A closed analytic edge can have no distinct current vertex. Its
            # sampled order is still stable and is canonicalized below.
            pass

        for point in edge_points:
            if points and _distance_squared(points[-1], point) <= join_epsilon**2:
                continue
            points.append(point)
        explorer.Next()

    projected = [_project_point(point, axis) for point in points]
    return _canonical_loop(projected, clockwise=clockwise, epsilon=join_epsilon)


def _project_point(point: tuple[float, float, float], axis: SectionAxis) -> Point2D:
    if axis == "x":
        return [_clean_number(point[1]), _clean_number(point[2])]
    return [_clean_number(point[0]), _clean_number(point[2])]


def _canonical_loop(points: Loop2D, *, clockwise: bool, epsilon: float) -> Loop2D:
    unique: Loop2D = []
    for point in points:
        if unique and _same_point_2d(unique[-1], point, epsilon):
            continue
        unique.append(point)

    if len(unique) > 1 and _same_point_2d(unique[0], unique[-1], epsilon):
        unique.pop()
    if len(unique) < 3:
        raise CadExportError("CAD section produced a degenerate boundary loop.")

    signed_area = _signed_area(unique)
    if math.isclose(signed_area, 0.0, abs_tol=epsilon**2):
        raise CadExportError("CAD section produced a zero-area boundary loop.")
    should_reverse = signed_area > 0 if clockwise else signed_area < 0
    if should_reverse:
        unique.reverse()

    # Rotating a loop to its lexicographically smallest sequence removes the
    # arbitrary start edge selected by OpenCascade. Usually the smallest point
    # is unique, so only tied minima need the more expensive sequence compare.
    smallest_point = min((point[0], point[1]) for point in unique)
    candidates = [
        index
        for index, point in enumerate(unique)
        if (point[0], point[1]) == smallest_point
    ]
    start_index = min(candidates, key=lambda index: _rotation_sort_key(unique, index))
    canonical = unique[start_index:] + unique[:start_index]
    return [*canonical, list(canonical[0])]


def _signed_area(loop: Loop2D) -> float:
    origin_x, origin_y = loop[0]
    return 0.5 * sum(
        (left[0] - origin_x) * (right[1] - origin_y)
        - (right[0] - origin_x) * (left[1] - origin_y)
        for left, right in zip(loop, [*loop[1:], loop[0]])
    )


def _same_point_2d(left: Point2D, right: Point2D, epsilon: float) -> bool:
    return abs(left[0] - right[0]) <= epsilon and abs(left[1] - right[1]) <= epsilon


def _distance_squared(
    left: tuple[float, float, float],
    right: tuple[float, float, float],
) -> float:
    return sum((left[index] - right[index]) ** 2 for index in range(3))


def _open_loop_sort_key(loop: Loop2D) -> tuple[tuple[float, float], ...]:
    return tuple((point[0], point[1]) for point in loop)


def _rotation_sort_key(loop: Loop2D, start_index: int) -> tuple[tuple[float, float], ...]:
    return tuple(
        (loop[(start_index + offset) % len(loop)][0], loop[(start_index + offset) % len(loop)][1])
        for offset in range(len(loop))
    )


def _loop_sort_key(loop: Loop2D) -> tuple[tuple[float, float], ...]:
    return _open_loop_sort_key(loop[:-1])


def _region_sort_key(region: dict[str, Any]) -> tuple[Any, ...]:
    return (
        str(region["containerId"]),
        str(region["bodyId"]),
        str(region["material"]),
        _loop_sort_key(region["outer"]),
    )


def _section_axis(value: Any) -> SectionAxis:
    if value == "x" or value == "y":
        return value
    raise CadExportError("section axis must be 'x' or 'y'.")


def _positive_number(value: Any, label: str) -> float:
    number = _finite_number(value, label)
    if number <= 0:
        raise CadExportError(f"{label} must be a positive finite number.")
    return number


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool):
        raise CadExportError(f"{label} must be a finite number.")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise CadExportError(f"{label} must be a finite number.") from None
    if not math.isfinite(number):
        raise CadExportError(f"{label} must be a finite number.")
    return number


def _clean_number(value: float) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise CadExportError("CAD section produced a non-finite number.")
    rounded = float(format(number, ".15g"))
    return 0.0 if rounded == 0 else rounded
