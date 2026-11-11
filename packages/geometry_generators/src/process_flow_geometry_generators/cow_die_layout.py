"""Single-COW die JSON with a bottom-left origin on the wafer's integer nm grid."""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from typing import Any

from . import wafer_arrangement as wafer

DIE_DATATYPES = {"soc": 1, "hbm": 2, "lsi": 3, "soic": 4, "dmy": 5}
COORDINATES = ("bottomLeftX", "bottomLeftY", "upperRightX", "upperRightY")


@dataclass(frozen=True)
class CowDie:
    type: str
    id: str
    path: str
    rectangle: tuple[int, int, int, int]


def _child_path(path: str, key: str | int) -> str:
    return f"{path}[{json.dumps(key, ensure_ascii=False)}]"


def _parse_dies(value: Any) -> tuple[list[CowDie], list[str]]:
    if not isinstance(value, (dict, list)):
        raise wafer.ArrangementError("dieJson: expected a JSON object or array containing die Info.")
    dies: list[CowDie] = []
    seen: dict[tuple[str, str], str] = {}
    rounded = False
    # Iterative traversal also handles deeply nested caller-supplied structures.
    pending = [(value, "dieJson")]
    while pending:
        node, path = pending.pop()
        if isinstance(node, dict):
            for label, section in node.items():
                if label not in DIE_DATATYPES:
                    continue
                section_path = _child_path(path, label)
                info_key = f"{label}Info"
                info_path = _child_path(section_path, info_key)
                if not isinstance(section, dict) or not isinstance(section.get(info_key), dict):
                    raise wafer.ArrangementError(f"{info_path}: expected an object keyed by die-ID.")
                for die_id, coordinates in section[info_key].items():
                    die_path = _child_path(info_path, die_id)
                    identity = (label, die_id)
                    if identity in seen:
                        raise wafer.ArrangementError(f"{die_path}: duplicate {label} die-ID {die_id!r}; first found at {seen[identity]}.")
                    if not die_id.strip() or not isinstance(coordinates, dict):
                        raise wafer.ArrangementError(f"{die_path}: expected a nonempty die-ID and coordinate object.")
                    values = []
                    for key in COORDINATES:
                        number = coordinates.get(key)
                        try:
                            valid = type(number) in (int, float) and math.isfinite(number)
                        except OverflowError:
                            valid = False
                        if not valid:
                            raise wafer.ArrangementError(f"{die_path}.{key}: expected a finite number.")
                        values.append(number)
                    if values[2] <= values[0] or values[3] <= values[1]:
                        raise wafer.ArrangementError(f"{die_path}: upper-right coordinates must be greater than bottom-left coordinates.")
                    rect = tuple(wafer._db(number) for number in values)
                    if rect[2] <= rect[0] or rect[3] <= rect[1]:
                        raise wafer.ArrangementError(f"{die_path}: die has zero area after rounding to the 1 nm GDS grid.")
                    rounded |= any(wafer._um(db) != number for db, number in zip(rect, values))
                    seen[identity] = die_path
                    dies.append(CowDie(label, die_id, die_path, rect))
                    if len(dies) > wafer.MAX_RECTANGLES:
                        raise wafer.ArrangementError(f"{die_path}: die layout exceeds the {wafer.MAX_RECTANGLES:,} output rectangle limit.")
            pending.extend((child, _child_path(path, key)) for key, child in reversed(list(node.items()))
                           if key not in DIE_DATATYPES and isinstance(child, (dict, list)))
        elif isinstance(node, list):
            pending.extend((node[index], _child_path(path, index)) for index in range(len(node) - 1, -1, -1)
                           if isinstance(node[index], (dict, list)))
    if not dies:
        raise wafer.ArrangementError("dieJson: no die-ID entries found in socInfo, hbmInfo, lsiInfo, soicInfo or dmyInfo.")
    return dies, ["Die coordinates were rounded to the 1 nm GDS grid."] if rounded else []


def _cow_bounds(size: wafer.DieSize) -> tuple[int, int, int, int]:
    width, height = wafer._db(size.x), wafer._db(size.y)
    if min(width, height) < 1:
        raise wafer.ArrangementError("COW sizes must be at least 0.001 um after rounding to the 1 nm grid.")
    return (0, 0, width, height)


def preview_cow_dies(die_json: Any, cow_size: wafer.DieSize | None = None) -> dict:
    dies, warnings = _parse_dies(die_json)
    bounds = _cow_bounds(cow_size) if cow_size is not None else None
    outside = []
    layers = []
    for label, datatype in DIE_DATATYPES.items():
        members = [die for die in dies if die.type == label]
        if not members:
            continue
        for die in members:
            x0, y0, x1, y1 = die.rectangle
            if bounds is not None and not (bounds[0] <= x0 and bounds[1] <= y0 and x1 <= bounds[2] and y1 <= bounds[3]):
                outside.append({"type": label, "id": die.id, "path": die.path,
                                "message": f"{die.path}: {label} die {die.id!r} extends outside the COW boundary."})
        layers.append({"type": label, "layer": 888, "datatype": datatype, "count": len(members),
                       "dies": [{"id": die.id, "path": die.path, "rectangle": wafer._rectangle_payload(die.rectangle)} for die in members]})
    return {"dieLayers": layers, "totalDies": len(dies),
            "cowRectangle": wafer._rectangle_payload(bounds) if bounds is not None else None,
            "outOfBounds": outside, "warnings": warnings}


def place_cow_dies(result: dict, die_json: Any | None) -> dict:
    """Add flat wafer-space die layers, checking the combined budget before expansion."""
    counts = dict.fromkeys(DIE_DATATYPES, 0)
    if die_json is None:
        return {**result, "dieLayers": [], "dieCounts": counts}
    layout = preview_cow_dies(die_json, wafer.DieSize.model_validate(result["normalizedParameters"]["cowSize"]))
    if layout["outOfBounds"]:
        raise wafer.ArrangementError("\n".join(item["message"] for item in layout["outOfBounds"]))
    total = result["totalRectangles"] + result["cowCount"] * layout["totalDies"]
    if total > wafer.MAX_RECTANGLES:
        raise wafer.ArrangementError(f"Arrangement including COW dies exceeds the {wafer.MAX_RECTANGLES:,} output rectangle limit.")
    layers = []
    for layer in layout["dieLayers"]:
        rectangles = []
        local = [tuple(wafer._db(v) for v in die["rectangle"]) for die in layer["dies"]]
        for cow in result["cowRectangles"]:
            x0, y0, x1, y1 = (wafer._db(v) for v in cow)
            for dx0, dy0, dx1, dy1 in local:
                rect = (x0 + dx0, y0 + dy0, x0 + dx1, y0 + dy1)
                if not (x0 <= rect[0] < rect[2] <= x1 and y0 <= rect[1] < rect[3] <= y1):
                    raise wafer.ArrangementError("Placed die extends outside its COW after grid quantization.")
                rectangles.append(wafer._rectangle_payload(rect))
        counts[layer["type"]] = len(rectangles)
        layers.append({"type": layer["type"], "layer": 888, "datatype": layer["datatype"],
                       "rectangles": rectangles, "count": len(rectangles)})
    return {**result, "dieLayers": layers, "dieCounts": counts, "totalRectangles": total,
            "warnings": [*result["warnings"], *layout["warnings"]]}
