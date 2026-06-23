"""Helpers for validating and classifying POLYGON face loops.

The mesher represents a polygon as ``[[[x, y], ...], ...]``. Each inner list is
one loop. Loop winding is part of the payload contract:

    * Clockwise loops are hulls.
    * Counter-clockwise loops are holes.

This convention allows one POLYGON face to describe an outer boundary plus any
number of interior cutouts without adding another schema field.
"""


def normalize_polygon_loops(dim, eps=1e-12):
    """Validate POLYGON dim and classify loops by Cartesian winding.

    Args:
        dim (Sequence[Sequence[Sequence[float]]]): Polygon payload in the form
            ``[[[x, y], ...], ...]``. Each loop must contain at least three
            distinct points.
        eps (float): Tolerance used when removing a repeated closing point and
            rejecting near-zero-area loops.

    Returns:
        list[dict]: Normalized loop dictionaries. Each dictionary contains:
            ``points`` for the open loop points, ``area2`` for twice the signed
            Cartesian area, and ``role`` as either ``"hull"`` or ``"hole"``.

    Raises:
        ValueError: If the payload shape is invalid, a loop has fewer than
        three points, a loop area is zero, or no clockwise hull is present.

    Notes:
        A repeated final point matching the first point is accepted and removed.
        The returned loops are always open, so downstream code can wrap edges
        with modulo indexing.
    """
    if not _is_sequence(dim) or len(dim) == 0:
        raise ValueError("POLYGON dim must contain at least one loop")
    if _is_point(dim[0]):
        raise ValueError("POLYGON dim must be [[[x1,y1], ...], ...]")

    loops = []
    has_hull = False
    for loop in dim:
        points = _normalize_loop_points(loop)
        points = _drop_repeated_closure(points, eps=eps)
        if len(points) < 3:
            raise ValueError("Each POLYGON loop must contain at least 3 points")

        area2 = polygon_signed_area2(points)
        if abs(area2) <= eps:
            raise ValueError("POLYGON loop area must be non-zero")

        role = "hull" if area2 < 0.0 else "hole"
        if role == "hull":
            has_hull = True
        loops.append(
            {
                "points": points,
                "area2": area2,
                "role": role,
            }
        )

    if not has_hull:
        raise ValueError("POLYGON dim must include at least one clockwise hull")
    return loops


def polygon_signed_area2(points):
    """Return twice the signed Cartesian polygon area.

    Args:
        points (Sequence[Sequence[float]]): Open polygon loop as
            ``[[x, y], ...]``.

    Returns:
        float: Twice the signed area. Positive means counter-clockwise winding;
        negative means clockwise winding in Cartesian coordinates.
    """
    area2 = 0.0
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        area2 += point[0] * next_point[1] - next_point[0] * point[1]
    return area2


def _normalize_loop_points(loop):
    """Validate one polygon loop and convert its coordinates to floats.

    Args:
        loop (Sequence[Sequence[float]]): One polygon loop in
            ``[[x, y], ...]`` form. Extra coordinate values are ignored.

    Returns:
        list[list[float]]: Normalized ``[x, y]`` points.

    Raises:
        ValueError: If ``loop`` is empty or any item is not point-like.
    """
    if not _is_sequence(loop) or len(loop) == 0:
        raise ValueError("Each POLYGON loop must be [[x1,y1], ...]")

    points = []
    for point in loop:
        if not _is_point(point):
            raise ValueError("Each POLYGON loop must be [[x1,y1], ...]")
        points.append([float(point[0]), float(point[1])])
    return points


def _drop_repeated_closure(points, eps):
    """Remove a final point that duplicates the first point.

    Args:
        points (Sequence[Sequence[float]]): Polygon loop points.
        eps (float): Maximum coordinate difference for treating the first and
            final points as equal.

    Returns:
        Sequence[Sequence[float]]: ``points`` without the duplicate closing
        point when one is present.

    Notes:
        The mesher stores loops as open rings and closes them by modulo index.
        Accepting closed input keeps the API tolerant of common polygon formats.
    """
    if len(points) < 2:
        return points

    first = points[0]
    last = points[-1]
    if abs(first[0] - last[0]) <= eps and abs(first[1] - last[1]) <= eps:
        return points[:-1]
    return points


def _is_point(value):
    """Return whether a value looks like one xy or xyz point.

    Args:
        value (object): Candidate point payload.

    Returns:
        bool: ``True`` when ``value`` is a non-string sequence with at least
        two scalar-like coordinate entries.
    """
    return (
        _is_sequence(value)
        and len(value) >= 2
        and not _is_sequence(value[0])
        and not _is_sequence(value[1])
    )


def _is_sequence(value):
    """Return whether a value behaves like a non-string sequence.

    Args:
        value (object): Candidate sequence payload.

    Returns:
        bool: ``True`` when ``value`` has ``len(value)`` and is not ``str`` or
        ``bytes``.
    """
    if isinstance(value, (str, bytes)):
        return False
    try:
        len(value)
    except TypeError:
        return False
    return True
