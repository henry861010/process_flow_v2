"""Composable geometry-aware rules shared by independently authored sets.

All sizes, thicknesses and offsets are in um. Rules append controls/details
without modifying geometry summaries. Defaults match the numbered mesh models.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Iterable, Mapping

from .contracts import JsonObject, MeshControlSetNotApplicable
from .controls import (
    ZERO_TOLERANCE,
    append_absolute_section,
    append_full_feature_control,
    append_relative_z_point,
)
from .geometry import select_upper_right, subtree_nodes

METAL_TIM_MATERIAL = frozenset({"Mat_metaltime1", "Mat_metaltime2", "Mat_metaltime3"})
_HBM_CORE_DIE_KEY = re.compile(r"hbm\.core_die_(\d+)")


def append_tim_controls(
    controls: list[JsonObject],
    details: list[JsonObject],
    bodies: Iterable[JsonObject],
    *,
    metal_element_size: float = 250,
    non_metal_element_size: float = 50,
    metal_materials: Collection[str] = METAL_TIM_MATERIAL,
) -> bool:
    """Append full-thickness controls for all bodies keyed "tim", in input order.

    Args:
        controls: Output control list, extended in place.
        details: Output applied-detail list, extended in place.
        bodies: Body summaries from find_geometry(); never modified.
        metal_element_size: Z size in um for materials in metal_materials.
        non_metal_element_size: Z size in um for other Tim materials.
        metal_materials: Exact material names considered metal Tim.

    Returns whether any Tim body uses a metal material, for adhesive rules.
    Missing required summary fields raise KeyError.
    """
    has_metal_tim = False
    for body in bodies:
        if body["key"] != "tim":
            continue
        is_metal = body["material"] in metal_materials
        has_metal_tim = has_metal_tim or is_metal
        append_full_feature_control(
            controls, details, body, label="Tim",
            element_size=metal_element_size if is_metal else non_metal_element_size,
        )
    return has_metal_tim


def append_adhesive_controls(
    controls: list[JsonObject],
    details: list[JsonObject],
    bodies: Iterable[JsonObject],
    *,
    has_metal_tim: bool,
    metal_tim_element_size: float = 50,
    non_metal_tim_element_size: float = 20,
) -> None:
    """Append full-thickness controls for all bodies keyed "adh", in input order.

    Args:
        controls: Output control list, extended in place.
        details: Output applied-detail list, extended in place.
        bodies: Body summaries from find_geometry(); never modified.
        has_metal_tim: Whether the geometry contains any metal Tim body.
        metal_tim_element_size: Z size in um when metal Tim exists.
        non_metal_tim_element_size: Z size in um otherwise.

    Returns None. Missing required summary fields raise KeyError.
    """
    for body in bodies:
        if body["key"] == "adh":
            append_full_feature_control(
                controls, details, body, label="adh",
                element_size=(metal_tim_element_size if has_metal_tim
                              else non_metal_tim_element_size),
            )


def append_hbm_uf_controls(
    controls: list[JsonObject],
    details: list[JsonObject],
    nodes: Iterable[JsonObject],
    containers_by_id: Mapping[str, JsonObject],
    hbm: JsonObject,
    *,
    base_element_size: float = 10,
    base_to_core_element_size: float = 5,
    core_element_size: float = 20,
    core_to_core_element_size: float = 5,
    top_element_size: float = 10,
) -> None:
    """Append UF sections for one selected HBM subtree, referencing its ID.

    Args:
        controls: Output list receiving base, gap, core and top sections.
        details: Output list receiving applied/zero-length omitted sections.
        nodes: Detached geometry summaries, in DFS order; never modified.
        containers_by_id: Acyclic container summary index; never modified.
        hbm: Selected HBM container summary; never modified.
        base_element_size: Base die Z size in um (Z_SECTION_CENTER).
        base_to_core_element_size: Base-to-first-core gap Z size in um.
        core_element_size: Regular core die Z size in um.
        core_to_core_element_size: Core-to-next-core/top gap Z size in um.
        top_element_size: Top die Z size in um.

    Returns None. Base/top representatives maximize (center X, center Y).
    Regular cores retain ordering by (zMin, numeric key suffix, DFS order).
    Missing dies are skipped; inverted ranges are ignored, and zero ranges
    produce omitted details. Missing required summary fields raise KeyError.
    """
    bodies = subtree_nodes(nodes, containers_by_id, hbm, kind="body")
    base = select_upper_right(body for body in bodies if body["key"] == "hbm.base_die")
    top = select_upper_right(body for body in bodies if body["key"] == "hbm.top_die")
    regular_cores = []
    for order, body in enumerate(bodies):
        matched = _HBM_CORE_DIE_KEY.fullmatch(body["key"] or "")
        if matched:
            regular_cores.append((body["zMin"], int(matched.group(1)), order, body))
    regular_cores.sort(key=lambda item: item[:3])
    regular_core_bodies = [item[3] for item in regular_cores]
    core_stack = [*regular_core_bodies, *([] if top is None else [top])]

    candidates = []
    if base is not None:
        candidates.append(_section_candidate(
            "Z_SECTION_CENTER", base_element_size, base["zMin"], base["zMax"],
            [base["id"]], label="TD_UF, HBM base die",
        ))
    if base is not None and core_stack:
        candidates.append(_section_candidate(
            "Z_SECTION_AVG", base_to_core_element_size,
            base["zMax"], core_stack[0]["zMin"],
            [base["id"], core_stack[0]["id"]], label="TD_UF, HBM B2C gap",
        ))
    for index, core in enumerate(regular_core_bodies):
        candidates.append(_section_candidate(
            "Z_SECTION_AVG", core_element_size, core["zMin"], core["zMax"],
            [core["id"]], label="TD_UF, HBM core die",
        ))
        next_core = core_stack[index + 1] if index + 1 < len(core_stack) else None
        if next_core is not None:
            candidates.append(_section_candidate(
                "Z_SECTION_AVG", core_to_core_element_size,
                core["zMax"], next_core["zMin"],
                [core["id"], next_core["id"]], label="TD_UF, HBM C2C gap",
            ))
    if top is not None:
        candidates.append(_section_candidate(
            "Z_SECTION_AVG", top_element_size, top["zMin"], top["zMax"],
            [top["id"]], label="TD_UF, HBM top die",
        ))
    for candidate in candidates:
        if candidate["end_z"] >= candidate["start_z"] - ZERO_TOLERANCE:
            append_absolute_section(
                controls, details,
                reference={"kind": "container", "id": hbm["id"]}, **candidate,
            )


def append_soc_uf_controls(
    controls: list[JsonObject],
    details: list[JsonObject],
    soc_si: JsonObject,
    *,
    set_id: str = "SoC UF",
    surface_thickness: float = 50,
    transition_thickness: float = 60,
    surface_element_size: float = 5,
    transition_element_size: float = 60,
    middle_element_size: float = 120,
) -> None:
    """Append five symmetric noHBM UF zones bounded only by a selected Si body.

    Args:
        controls: Output list receiving nonempty absolute Z sections.
        details: Output list receiving applied/zero-length omitted sections.
        soc_si: Body summary with id, zMin and zMax; never modified.
        set_id: Set name included in not-applicable error messages.
        surface_thickness: Thickness in um of each outer Zone1.
        transition_thickness: Thickness in um of each adjacent Zone2.
        surface_element_size: Zone1 Z element size in um.
        transition_element_size: Zone2 Z element size in um.
        middle_element_size: Remaining central Zone3 Z element size in um.

    Returns None. Overlapping middle zones are skipped; a zero middle zone
    produces an omitted detail. Raises MeshControlSetNotApplicable if Si is
    thinner than surface_thickness + transition_thickness (110 um by default).
    Nonpositive zone thicknesses raise ValueError; missing fields raise KeyError.
    """
    if surface_thickness <= 0 or transition_thickness <= 0:
        raise ValueError("SoC UF zone thicknesses must be positive.")
    bottom, top = soc_si["zMin"], soc_si["zMax"]
    outer_thickness = surface_thickness + transition_thickness
    if top - bottom < outer_thickness - ZERO_TOLERANCE:
        raise MeshControlSetNotApplicable(
            f"{set_id} SoC UF controls require a soc.si thickness of at least "
            f"{outer_thickness:g} um."
        )
    candidates = (
        ("TD_UF, noHBM Zone1 bot", surface_element_size, top - surface_thickness, top),
        ("TD_UF, noHBM Zone2 bot", transition_element_size, top - outer_thickness, top - surface_thickness),
        ("TD_UF, noHBM Zone3", middle_element_size, bottom + outer_thickness, top - outer_thickness),
        ("TD_UF, noHBM Zone2 top", transition_element_size, bottom + surface_thickness, bottom + outer_thickness),
        ("TD_UF, noHBM Zone1 top", surface_element_size, bottom, bottom + surface_thickness),
    )
    for label, element_size, start, end in candidates:
        if end >= start - ZERO_TOLERANCE:
            append_absolute_section(
                controls, details, method="Z_SECTION_AVG", element_size=element_size,
                start_z=start, end_z=end, source_ids=[soc_si["id"]], label=label,
                reference={"kind": "body", "id": soc_si["id"]},
            )


def append_bottom_carrier_points(
    controls: list[JsonObject],
    details: list[JsonObject],
    nodes: Iterable[JsonObject],
    *,
    offset: float = 10,
) -> None:
    """Append relative Z points for every carrier at the geometry's lowest Z.

    Args:
        controls: Output list receiving Z_POINT controls in input order.
        details: Output list receiving resolved point coordinates and source IDs.
        nodes: Geometry summaries; containers do not determine the lowest Z.
        offset: Signed distance in um above each matching carrier's z_min.

    Returns None without modifying summaries. A body keyed "carrier" matches
    when its zMin is within ZERO_TOLERANCE um of the lowest feature of any kind.
    Empty geometry adds nothing. Missing required summary fields raise KeyError.
    """
    features = [node for node in nodes if node["kind"] != "container"]
    if not features:
        return
    bottom_z = min(node["zMin"] for node in features)
    for body in features:
        if (body["kind"] == "body" and body["key"] == "carrier"
                and abs(body["zMin"] - bottom_z) <= ZERO_TOLERANCE):
            append_relative_z_point(
                controls, details, body, label=f"Carrier bottom {offset:+g}", offset=offset,
            )


def _section_candidate(
    method: str,
    element_size: float,
    start_z: float,
    end_z: float,
    source_ids: list[str],
    *,
    label: str,
) -> JsonObject:
    return {
        "label": label, "method": method, "element_size": element_size,
        "start_z": start_z, "end_z": end_z, "source_ids": source_ids,
    }
