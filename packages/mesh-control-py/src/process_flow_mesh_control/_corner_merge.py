"""Merge resolved die corner footprints without widening their Z intervals."""
from __future__ import annotations

from process_flow_kernel.domain.geometry import PolygonSnapshot
from process_flow_kernel import Region, TYPE_DIE, TYPE_TARGET, classify_polygon_loops
from shapely.geometry import Point, Polygon

from ._geometry_query import _GeometryQuery
from .contracts import JsonObject
from .regions import _append_region_control, _number


def _junction_candidates(
    containers: list[JsonObject], *, half_extent: float,
) -> list[JsonObject]:
    """Find local crossings of outward die-edge guides in the inter-die UF.

    A vertical guide from one die edge and a horizontal guide from another
    create a 50 x 50 patch (for the default half extent) at their crossing.
    Guides run through the UF until another die blocks them. The guides
    themselves are never emitted as mesh controls.
    """
    candidates: dict[tuple[float, float, float], JsonObject] = {}
    corner_centers = {
        (x, y, die["zMax"])
        for die in containers
        for x in (die["xMin"], die["xMax"])
        for y in (die["yMin"], die["yMax"])
    }

    def axis_gap(a_min, a_max, b_min, b_max):
        return max(a_min - b_max, b_min - a_max, 0)

    def crossing(vertical, horizontal, source_ids):
        if vertical["zMax"] != horizontal["zMax"]:
            return
        x_gap = axis_gap(vertical["xMin"], vertical["xMax"], horizontal["xMin"], horizontal["xMax"])
        y_gap = axis_gap(vertical["yMin"], vertical["yMax"], horizontal["yMin"], horizontal["yMax"])
        # There is no inter-die UF when the footprints overlap in both axes.
        if x_gap == 0 and y_gap == 0:
            return
        x_edges = (vertical["xMin"], vertical["xMax"])
        if x_gap:
            x_edges = (vertical["xMax"] if vertical["xMax"] <= horizontal["xMin"]
                       else vertical["xMin"],)
        y_edges = (horizontal["yMin"], horizontal["yMax"])
        if y_gap:
            y_edges = (horizontal["yMin"] if horizontal["yMin"] >= vertical["yMax"]
                       else horizontal["yMax"],)
        for x in x_edges:
            # The horizontal guide must run outside its own die.
            if horizontal["xMin"] < x < horizontal["xMax"]:
                continue
            for y in y_edges:
                # The vertical guide must run outside its own die.
                if vertical["yMin"] < y < vertical["yMax"]:
                    continue
                # Existing corner boxes already cover these centers, even if
                # the corner belongs to a third die.
                if (x, y, vertical["zMax"]) in corner_centers:
                    continue
                y_start = vertical["yMax"] if y >= vertical["yMax"] else vertical["yMin"]
                x_start = horizontal["xMin"] if x <= horizontal["xMin"] else horizontal["xMax"]
                # Stop each guide at the first die it encounters in the same
                # Z band, including a blocker before the crossing itself.
                if any(
                    die is not vertical and die is not horizontal
                    and die["zMax"] == vertical["zMax"]
                    and ((die["xMin"] < x < die["xMax"]
                          and die["yMin"] < max(y_start, y)
                          and die["yMax"] > min(y_start, y))
                         or (die["yMin"] < y < die["yMax"]
                             and die["xMin"] < max(x_start, x)
                             and die["xMax"] > min(x_start, x)))
                    for die in containers
                ):
                    continue
                key = (x, y, vertical["zMax"])
                candidate = candidates.setdefault(key, {
                    "sourceIds": [],
                    "resolvedRegions": [{"bounds": {
                        "xMin": x - half_extent, "xMax": x + half_extent,
                        "yMin": y - half_extent, "yMax": y + half_extent,
                        "zMin": vertical["zMax"] - half_extent,
                        "zMax": vertical["zMax"] + half_extent,
                    }}],
                })
                for source_id in source_ids:
                    if source_id not in candidate["sourceIds"]:
                        candidate["sourceIds"].append(source_id)

    for index, first in enumerate(containers):
        for second in containers[index + 1:]:
            source_ids = (first["id"], second["id"])
            crossing(first, second, source_ids)
            crossing(second, first, source_ids)
    return list(candidates.values())


def _append_merged_corner_controls(
    controls: list[JsonObject],
    details: list[JsonObject],
    query: _GeometryQuery,
    corners: list[JsonObject],
    *,
    gap: float,
    element_size: float,
    containers: list[JsonObject] | None = None,
    half_extent: float = 25,
) -> None:
    """Append one absolute control per connected footprint in each exact Z band.

    The kernel's recursive gap fill joins facing XY edges up to ``gap`` apart,
    including the original boxes, while preserving holes and disconnected parts.
    Source IDs retain the input corner order and are unique within each result.
    Only output lists are modified. Invalid gap values raise ValueError.
    """
    _number(gap, "merge_gap")
    if gap < 0:
        raise ValueError("merge_gap must be non-negative")

    if containers:
        corners = [*corners, *_junction_candidates(containers, half_extent=half_extent)]

    bands: dict[tuple[float, float], list[tuple[int, JsonObject]]] = {}
    for index, corner in enumerate(corners):
        bounds = corner["resolvedRegions"][0]["bounds"]
        bands.setdefault((bounds["zMin"], bounds["zMax"]), []).append((index, corner))

    components = []
    for (start_z, end_z), band in bands.items():
        bounds_list = [corner["resolvedRegions"][0]["bounds"] for _, corner in band]
        region = Region([
            {"type": "BOX", "dim": [b["xMin"], b["yMin"], b["xMax"], b["yMax"]]}
            for b in bounds_list
        ])
        region.set_gap(gap, set_to=TYPE_TARGET, target_mask=TYPE_DIE, is_recursive=True)
        loops = [[[x, y, start_z] for x, y in loop]
                 for loop in region.get_outline(TYPE_DIE | TYPE_TARGET)]
        for component in classify_polygon_loops(PolygonSnapshot._from_generated(loops)):
            footprint = Polygon(component.outer, component.holes)
            members = [
                (index, corner)
                for (index, corner), bounds in zip(band, bounds_list)
                if footprint.covers(Point((bounds["xMin"] + bounds["xMax"]) / 2,
                                          (bounds["yMin"] + bounds["yMax"]) / 2))
            ]
            source_ids = list(dict.fromkeys(source_id for _, corner in members
                                            for source_id in corner["sourceIds"]))
            if len(component.outer) == 4 and not component.holes:
                x_min, y_min, x_max, y_max = footprint.bounds
                merged = {"type": "box", "min": {"x": x_min, "y": y_min, "z": start_z},
                          "max": {"x": x_max, "y": y_max, "z": end_z}}
            else:
                merged = {"type": "polygon", "startZ": start_z, "endZ": end_z,
                          "loops": [[{"x": x, "y": y} for x, y, _ in loop]
                                    for loop in [component.outer, *component.holes]]}
            components.append((members[0][0], merged, source_ids, PolygonSnapshot._from_generated([component.outer, *component.holes])))

    for index, (_, merged, source_ids, polygon) in enumerate(sorted(components, key=lambda component: component[0]), 1):
        _append_region_control(
            controls, details, query, label=f"Die top corners merged {index}",
            element_size=element_size, coordinate_mode="absolute", region=merged, polygon=polygon,
        )
        details[-1]["sourceIds"] = source_ids
