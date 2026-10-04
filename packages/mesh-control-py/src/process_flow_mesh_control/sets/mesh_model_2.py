from __future__ import annotations

import re

from process_flow_kernel import ProcessGeometryState

from ..contracts import MeshControlSetNotApplicable, MeshControlSetResult

METAL_TIM_MATERIAL = frozenset(
    {"Mat_metaltime1", "Mat_metaltime2", "Mat_metaltime3"}
)
_HBM_CORE_DIE_KEY = re.compile(r"hbm\.core_die_(\d+)")
_ZERO_TOLERANCE = 1e-9


class MeshModel2Set:
    def definition(self) -> dict:
        return {
            "id": "meshModel2",
            "version": "1",
            "label": "meshModel2",
            "description": "Geometry-aware Tim, adhesive, uBump, and UF controls.",
        }

    def build(self, state: ProcessGeometryState) -> MeshControlSetResult:
        nodes = state.find_geometry()
        containers = [node for node in nodes if node["kind"] == "container"]
        bodies = [node for node in nodes if node["kind"] == "body"]
        controls: list[dict] = []
        details: list[dict] = []

        tim_bodies = [node for node in bodies if node["key"] == "tim"]
        has_metal_tim = any(
            node["material"] in METAL_TIM_MATERIAL for node in tim_bodies
        )
        for body in tim_bodies:
            _append_full_feature_control(
                controls,
                details,
                body,
                label="Tim",
                element_size=(
                    250 if body["material"] in METAL_TIM_MATERIAL else 50
                ),
            )

        for body in (node for node in bodies if node["key"] == "adh"):
            _append_full_feature_control(
                controls,
                details,
                body,
                label="adh",
                element_size=50 if has_metal_tim else 20,
            )

        first_hbm = _first_container(containers, "hbm")
        first_soc = _first_container(containers, "soc")
        containers_by_id = {node["id"]: node for node in containers}

        bump = _first_subtree_node(nodes, containers_by_id, first_hbm, "bump")
        if bump is None:
            bump = _first_subtree_node(nodes, containers_by_id, first_soc, "bump")
        if bump is not None:
            _append_full_feature_control(
                controls,
                details,
                bump,
                label="TD_uBump",
                element_size=10,
            )

        if first_hbm is not None:
            _append_hbm_uf_controls(
                controls,
                details,
                nodes,
                containers_by_id,
                first_hbm,
            )
        elif first_soc is not None:
            _append_soc_uf_controls(controls, details, first_soc)

        return MeshControlSetResult(
            mesh_control={
                "schemaVersion": "1.0.0",
                "unitSystem": "um",
                "mesher": "process_flow_2_5d",
                "globalElementSize": 1000,
                "symmetry": "full",
                "controls": controls,
            },
            details=details,
        )


def _first_container(containers: list[dict], key: str) -> dict | None:
    return next((node for node in containers if node["key"] == key), None)


def _first_subtree_node(
    nodes: list[dict],
    containers_by_id: dict[str, dict],
    container: dict | None,
    kind: str,
) -> dict | None:
    if container is None:
        return None
    return next(
        (
            node
            for node in nodes
            if node["kind"] == kind
            and _belongs_to_subtree(node, container["id"], containers_by_id)
        ),
        None,
    )


def _belongs_to_subtree(
    node: dict,
    container_id: str,
    containers_by_id: dict[str, dict],
) -> bool:
    current_id = node["id"] if node["kind"] == "container" else node["containerId"]
    while current_id is not None:
        if current_id == container_id:
            return True
        current = containers_by_id.get(current_id)
        current_id = None if current is None else current["parentId"]
    return False


def _append_full_feature_control(
    controls: list[dict],
    details: list[dict],
    feature: dict,
    *,
    label: str,
    element_size: float,
) -> None:
    reference = {"kind": feature["kind"], "id": feature["id"]}
    controls.append(
        {
            "method": "Z_SECTION_AVG",
            "label": label,
            "reference": reference,
            "elementSize": element_size,
            "startZ": {
                "mode": "relative",
                "anchor": "z_min",
                "offset": 0,
            },
            "endZ": {
                "mode": "relative",
                "anchor": "z_max",
                "offset": 0,
            },
        }
    )
    details.append(
        {
            "label": label,
            "status": "applied",
            "startZ": feature["zMin"],
            "endZ": feature["zMax"],
            "sourceIds": [feature["id"]],
        }
    )


def _append_hbm_uf_controls(
    controls: list[dict],
    details: list[dict],
    nodes: list[dict],
    containers_by_id: dict[str, dict],
    hbm: dict,
) -> None:
    subtree_bodies = [
        node
        for node in nodes
        if node["kind"] == "body"
        and _belongs_to_subtree(node, hbm["id"], containers_by_id)
    ]
    base = next((node for node in subtree_bodies if node["key"] == "hbm.base_die"), None)
    top = next((node for node in subtree_bodies if node["key"] == "hbm.top_die"), None)
    regular_cores = []
    for order, body in enumerate(subtree_bodies):
        matched = _HBM_CORE_DIE_KEY.fullmatch(body["key"] or "")
        if matched:
            regular_cores.append((body["zMin"], int(matched.group(1)), order, body))
    regular_cores.sort(key=lambda item: item[:3])
    regular_core_bodies = [item[3] for item in regular_cores]
    core_stack = [*regular_core_bodies, *([] if top is None else [top])]

    candidates: list[dict] = []
    if base is not None:
        candidates.append(
            _section_candidate(
                "Z_SECTION_CENTER",
                10,
                base["zMin"],
                base["zMax"],
                [base["id"]],
                label="TD_UF, HBM base die",
            )
        )
    if base is not None and core_stack:
        candidates.append(
            _section_candidate(
                "Z_SECTION_AVG",
                5,
                base["zMax"],
                core_stack[0]["zMin"],
                [base["id"], core_stack[0]["id"]],
                label="TD_UF, HBM B2C gap",
            )
        )
    for index, core in enumerate(regular_core_bodies):
        candidates.append(
            _section_candidate(
                "Z_SECTION_AVG",
                20,
                core["zMin"],
                core["zMax"],
                [core["id"]],
                label="TD_UF, HBM core die",
            )
        )
        next_core = core_stack[index + 1] if index + 1 < len(core_stack) else None
        if next_core is not None:
            candidates.append(
                _section_candidate(
                    "Z_SECTION_AVG",
                    5,
                    core["zMax"],
                    next_core["zMin"],
                    [core["id"], next_core["id"]],
                    label="TD_UF, HBM C2C gap",
                )
            )
    if top is not None:
        candidates.append(
            _section_candidate(
                "Z_SECTION_AVG",
                10,
                top["zMin"],
                top["zMax"],
                [top["id"]],
                label="TD_UF, HBM top die",
            )
        )

    valid_candidates = [
        candidate
        for candidate in candidates
        if candidate["end_z"] >= candidate["start_z"] - _ZERO_TOLERANCE
    ]
    reference = {"kind": "container", "id": hbm["id"]}
    for candidate in valid_candidates:
        _append_absolute_section(
            controls,
            details,
            reference=reference,
            **candidate,
        )


def _append_soc_uf_controls(
    controls: list[dict], details: list[dict], soc: dict
) -> None:
    bottom = soc["zMin"]
    top = soc["zMax"]
    if top - bottom < 110 - _ZERO_TOLERANCE:
        raise MeshControlSetNotApplicable(
            "meshModel2 SoC UF controls require a SoC thickness of at least 110 um."
        )
    reference = {"kind": "container", "id": soc["id"]}
    candidates = (
        ("TD_UF, noHBM Zone1 bot", 5, top - 50, top),
        ("TD_UF, noHBM Zone2 bot", 60, top - 110, top - 50),
        ("TD_UF, noHBM Zone3", 120, bottom + 110, top - 110),
        ("TD_UF, noHBM Zone2 top", 60, bottom + 50, bottom + 110),
        ("TD_UF, noHBM Zone1 top", 5, bottom, bottom + 50),
    )
    for label, element_size, start, end in candidates:
        if end < start - _ZERO_TOLERANCE:
            continue
        _append_absolute_section(
            controls,
            details,
            method="Z_SECTION_AVG",
            element_size=element_size,
            start_z=start,
            end_z=end,
            source_ids=[soc["id"]],
            label=label,
            reference=reference,
        )


def _section_candidate(
    method: str,
    element_size: float,
    start_z: float,
    end_z: float,
    source_ids: list[str],
    *,
    label: str,
) -> dict:
    return {
        "label": label,
        "method": method,
        "element_size": element_size,
        "start_z": start_z,
        "end_z": end_z,
        "source_ids": source_ids,
    }


def _append_absolute_section(
    controls: list[dict],
    details: list[dict],
    *,
    method: str,
    element_size: float,
    start_z: float,
    end_z: float,
    source_ids: list[str],
    label: str,
    reference: dict,
) -> None:
    if end_z - start_z <= _ZERO_TOLERANCE:
        details.append(
            {
                "label": label,
                "status": "omitted",
                "startZ": start_z,
                "endZ": end_z,
                "sourceIds": source_ids,
            }
        )
        return
    controls.append(
        {
            "method": method,
            "label": label,
            "reference": reference.copy(),
            "elementSize": element_size,
            "startZ": {"mode": "absolute", "value": start_z},
            "endZ": {"mode": "absolute", "value": end_z},
        }
    )
    details.append(
        {
            "label": label,
            "status": "applied",
            "startZ": start_z,
            "endZ": end_z,
            "sourceIds": source_ids,
        }
    )
