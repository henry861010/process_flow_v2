"""Canonical mesh-control builders; all sizes and Z coordinates are in um.

Append helpers modify only the supplied output lists. Geometry summaries and
reference dictionaries remain unchanged. Schema validation is performed by the API when a set is applied; all controls
use the local uniform-coordinate contract.
"""

from __future__ import annotations

import copy
from collections.abc import Iterable

from .contracts import JsonObject

ZERO_TOLERANCE = 1e-9


def append_full_feature_control(
    controls: list[JsonObject],
    details: list[JsonObject],
    feature: JsonObject,
    *,
    label: str,
    element_size: float,
) -> None:
    """Append a Z_SECTION_AVG covering a feature's complete thickness.

    Args:
        controls: Output list receiving the relative z_min-to-z_max control.
        details: Output list receiving its applied absolute Z range/source ID.
        feature: Summary containing kind, id, zMin and zMax.
        label: Human-readable control label.
        element_size: Requested Z element size in um.

    Returns None. Only the output lists are modified. Missing feature fields
    raise KeyError. Positive size validation is performed by the local contract.
    """
    controls.append({
        "method": "Z_SECTION_AVG",
        "coordinateMode": "reference",
        "label": label,
        "reference": {"kind": feature["kind"], "id": feature["id"]},
        "elementSize": element_size,
        "startZ": {"anchor": "z_min", "offset": 0},
        "endZ": {"anchor": "z_max", "offset": 0},
    })
    details.append({
        "label": label,
        "status": "applied",
        "startZ": feature["zMin"],
        "endZ": feature["zMax"],
        "sourceIds": [feature["id"]],
    })


def append_absolute_section(
    controls: list[JsonObject],
    details: list[JsonObject],
    *,
    method: str,
    element_size: float,
    start_z: float,
    end_z: float,
    source_ids: list[str],
    label: str,
) -> None:
    """Append an absolute Z section and matching applied/omitted details.

    Args:
        controls: Output list receiving a nonempty section control.
        details: Output list always receiving a range and copied source IDs.
        method: Canonical section method, for example "Z_SECTION_CENTER".
        element_size: Requested Z element size in um.
        start_z: Absolute lower Z coordinate in um.
        end_z: Absolute upper Z coordinate in um.
        source_ids: Structure IDs used to derive the range.
        label: Human-readable control label.

    Returns None. A range at most ZERO_TOLERANCE long receives only an omitted
    detail, including inverted ranges. Only output lists are modified; contract
    validation of methods and positive sizes is left to the caller.
    """
    omitted = end_z - start_z <= ZERO_TOLERANCE
    if not omitted:
        controls.append({
            "method": method,
            "coordinateMode": "absolute",
            "label": label,
            "elementSize": element_size,
            "startZ": start_z,
            "endZ": end_z,
        })
    details.append({
        "label": label,
        "status": "omitted" if omitted else "applied",
        "startZ": start_z,
        "endZ": end_z,
        "sourceIds": list(source_ids),
    })


def append_relative_z_point(
    controls: list[JsonObject],
    details: list[JsonObject],
    feature: JsonObject,
    *,
    label: str,
    offset: float,
    anchor: str = "z_min",
) -> None:
    """Append a Z_POINT relative to a feature/container and its resolved detail.

    Args:
        controls: Output list receiving the point control.
        details: Output list receiving the resolved absolute Z and source ID.
        feature: Summary containing kind, id and the selected Z bound.
        label: Human-readable control label.
        offset: Signed distance from the anchor in um.
        anchor: "z_min" (default) or "z_max".

    Returns None and modifies only output lists. An unknown anchor raises
    ValueError; missing required feature fields raise KeyError.
    """
    if anchor not in {"z_min", "z_max"}:
        raise ValueError(f"Unknown Z anchor: {anchor}")
    point_z = feature["zMin" if anchor == "z_min" else "zMax"] + offset
    controls.append({
        "method": "Z_POINT",
        "coordinateMode": "reference",
        "label": label,
        "reference": {"kind": feature["kind"], "id": feature["id"]},
        "z": {"anchor": anchor, "offset": offset},
    })
    details.append({
        "label": label,
        "status": "applied",
        "startZ": point_z,
        "endZ": point_z,
        "sourceIds": [feature["id"]],
    })


def build_mesh_control(
    controls: Iterable[JsonObject],
    *,
    global_element_size: float = 1000,
    symmetry: str = "full",
) -> JsonObject:
    """Return a detached canonical process_flow_2_5d mesh-control document.

    Args:
        controls: Controls in the desired output order; copied deeply.
        global_element_size: Default element size in um, initially 1000.
        symmetry: "full", "upper_half", "right_half" or "upper_right_quarter".

    Returns a new schema 1.0.0 document using um. Inputs are not modified.
    Validation is delegated to the API using the relevant per-method contract.
    """
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "mesher": "process_flow_2_5d",
        "globalElementSize": global_element_size,
        "symmetry": symmetry,
        "controls": copy.deepcopy(list(controls)),
    }
