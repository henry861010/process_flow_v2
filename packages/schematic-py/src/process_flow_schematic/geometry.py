"""Read-only geometry inspection used by presenters and the composer."""
from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any

from .contracts import Bounds
from .palette import CONDUCTOR_FILL, GENERIC_FILL, MATRIX_FILL, SILICON_FILL, SUPPORT_FILL, UNDERFILL_FILL


def geometry_bounds(geometry: Mapping[str, Any]) -> Bounds | None:
    if not isinstance(geometry, Mapping):
        return None
    try:
        height = float(geometry.get("thk", 0))
        kind = geometry.get("type")
        if kind == "BoxGeometry":
            left, right = geometry["bottom_left"], geometry["top_right"]
            x0, x1 = sorted((float(left[0]), float(right[0])))
            y0, y1 = sorted((float(left[1]), float(right[1])))
            z0 = min(float(left[2]), float(right[2]))
        elif kind == "PolygonGeometry":
            points = [point for loop in geometry["polys"] for point in loop]
            x0, x1 = min(float(p[0]) for p in points), max(float(p[0]) for p in points)
            y0, y1 = min(float(p[1]) for p in points), max(float(p[1]) for p in points)
            z0 = min(float(p[2]) for p in points)
        elif kind in ("CylinderGeometry", "ConeGeometry"):
            center = geometry["center"]
            radius = max(float(geometry.get("bottom_radius", 0)), float(geometry.get("top_radius", 0)))
            x0, x1 = float(center[0]) - radius, float(center[0]) + radius
            y0, y1 = float(center[1]) - radius, float(center[1]) + radius
            z0 = float(center[2])
        else:
            return None
        values = (x0, y0, z0, x1, y1, z0 + height)
        if height < 0 or not all(math.isfinite(value) for value in values):
            return None
        return Bounds(*values)
    except (KeyError, TypeError, ValueError, IndexError):
        return None


def walk_containers(structure: Mapping[str, Any]):
    root = structure.get("root", structure)
    if not isinstance(root, Mapping):
        return

    def visit(container, ancestors):
        yield container, ancestors
        for child in container.get("children", ()):
            if isinstance(child, Mapping):
                yield from visit(child, (*ancestors, container))

    yield from visit(root, ())


def base_material(material: str) -> str:
    return re.sub(r"_dup\d+$", "", str(material))


def material_color(material: str) -> str:
    value = base_material(material).strip().lower()
    rules = (
        (("copper", "metal", "cu", "via", "solder", "bump", "snag"), CONDUCTOR_FILL),
        (("underfill", "under fill", "uf"), UNDERFILL_FILL),
        (("mold", "molding", "emc", "epoxy", "dielectric", "polyimide", "pi", "oxide", "sio2",
          "usg", "elk", "passivation", "pass1", "pass2", "daf", "fow"), MATRIX_FILL),
        (("silicon", "si", "die", "hbm", "dram", "soic"), SILICON_FILL),
        (("glass", "wafer", "carrier", "substrate", "laminate", "fr4", "abf"), SUPPORT_FILL),
    )
    for tokens, color in rules:
        if any(re.search(rf"(^|[^a-z0-9]){re.escape(token)}([^a-z0-9]|$)", value) for token in tokens):
            return color
    return GENERIC_FILL
