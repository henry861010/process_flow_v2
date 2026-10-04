"""Illustrative rules for one unmodified HBM generator v2 structure.

The numbers below are examples, not an approved department mesh standard.
"""

from __future__ import annotations

import re

from process_flow_kernel import ProcessGeometryState

from ..contracts import MeshControlSetNotApplicable, MeshControlSetResult

_CORE_CONTAINER = re.compile(r"container:hbm-core-die-(\d+)")
_TOP_CORE_CONTAINER_ID = "container:hbm-top-core-die"
_TOP_CORE_BODY_ID = "body:hbm-top-core-die"
_ZERO_TOLERANCE = 1e-9
_LOCAL_ELEMENT_SIZE = 10


class HbmExampleSet:
    def definition(self) -> dict:
        return {
            "id": "hbm-example",
            "version": "1",
            "label": "HBM example (not a department standard)",
            "description": "Example Z controls for one HBM generator v2 package.",
        }

    def build(self, state: ProcessGeometryState) -> MeshControlSetResult:
        nodes = state.find_geometry()
        containers = [node for node in nodes if node["kind"] == "container"]
        bodies = [node for node in nodes if node["kind"] == "body"]
        root = _one(
            [node for node in containers if node["parentId"] is None],
            "one root container",
        )
        if root["key"] != "hbm" or root["id"] != "container:hbm-root":
            raise MeshControlSetNotApplicable(
                "HBM example requires a single root HBM generator v2 structure."
            )
        # Additional process features are allowed; the example set only resolves
        # the generator-owned base and core Z sections below.

        envelope = _one(
            [node for node in bodies if node["containerId"] == root["id"]
             and node["id"] == "body:hbm-molding" and node["key"] == "envelope"],
            "HBM envelope body",
        )
        children = [node for node in containers if node["parentId"] == root["id"]]
        base_scope = _one(
            [node for node in children if node["id"] == "container:hbm-base-die"],
            "HBM base die container",
        )
        base = _one(
            [node for node in bodies if node["containerId"] == base_scope["id"]
             and node["id"] == "body:hbm-base-die"],
            "HBM base die body",
        )
        core_scopes = []
        for child in children:
            matched = _CORE_CONTAINER.fullmatch(child["id"])
            if matched:
                core_scopes.append((int(matched.group(1)), child))
        core_scopes.sort(key=lambda item: item[0])
        if [number for number, _ in core_scopes] != list(
            range(1, len(core_scopes) + 1)
        ):
            raise MeshControlSetNotApplicable("HBM example requires consecutive core die IDs.")
        top_core_scope = _one(
            [child for child in children if child["id"] == _TOP_CORE_CONTAINER_ID],
            "HBM top core die container",
        )
        if len(children) != len(core_scopes) + 2 or len(containers) != len(children) + 1:
            raise MeshControlSetNotApplicable("HBM example found unexpected HBM containers.")
        cores = [
            _one(
                [node for node in bodies if node["containerId"] == scope["id"]
                 and node["id"] == f"body:hbm-core-die-{number:02d}"],
                f"HBM core die {number} body",
            )
            for number, scope in core_scopes
        ]
        top_core = _one(
            [node for node in bodies if node["containerId"] == top_core_scope["id"]
             and node["id"] == _TOP_CORE_BODY_ID],
            "HBM top core die body",
        )
        if len(bodies) != len(cores) + 3:
            raise MeshControlSetNotApplicable("HBM example found unexpected HBM bodies.")
        if base["zMin"] < envelope["zMin"] - _ZERO_TOLERANCE:
            raise MeshControlSetNotApplicable("HBM base die extends below its envelope.")
        if abs(top_core["zMax"] - envelope["zMax"]) > _ZERO_TOLERANCE:
            raise MeshControlSetNotApplicable(
                "HBM top core die must end at the molding envelope top."
            )

        controls: list[dict] = []
        details: list[dict] = []
        reference = {"kind": "container", "id": root["id"]}

        def section(label: str, start: float, end: float, source_ids: list[str]):
            if end < start - _ZERO_TOLERANCE:
                raise MeshControlSetNotApplicable(f"{label} has overlapping or reversed Z bounds.")
            if end - start <= _ZERO_TOLERANCE:
                details.append({
                    "label": label,
                    "status": "omitted",
                    "startZ": start,
                    "endZ": end,
                    "sourceIds": source_ids,
                })
                return
            controls.append({
                "method": "Z_SECTION_AVG",
                "label": label,
                "reference": reference.copy(),
                "elementSize": _LOCAL_ELEMENT_SIZE,
                "startZ": {"mode": "absolute", "value": start},
                "endZ": {"mode": "absolute", "value": end},
            })
            details.append({
                "label": label,
                "status": "applied",
                "startZ": start,
                "endZ": end,
                "sourceIds": source_ids,
            })

        section("Base die", base["zMin"], base["zMax"], [base["id"]])
        stacked_cores = [*cores, top_core]
        section(
            "Base-to-core gap", base["zMax"], stacked_cores[0]["zMin"],
            [base["id"], stacked_cores[0]["id"]],
        )
        for index, core in enumerate(cores):
            section(f"Core die {index + 1}", core["zMin"], core["zMax"], [core["id"]])
            next_core = stacked_cores[index + 1]
            section(
                f"Core-to-core gap {index + 1}", core["zMax"], next_core["zMin"],
                [core["id"], next_core["id"]],
            )
        section("Top core die", top_core["zMin"], top_core["zMax"], [top_core["id"]])
        return MeshControlSetResult(
            mesh_control={
                "schemaVersion": "1.0.0",
                "unitSystem": "um",
                "mesher": "process_flow_2_5d",
                "globalElementSize": 500,
                "symmetry": "full",
                "controls": controls,
            },
            details=details,
        )


def _one(matches: list[dict], label: str) -> dict:
    if len(matches) != 1:
        raise MeshControlSetNotApplicable(f"HBM example requires exactly {label}.")
    return matches[0]
