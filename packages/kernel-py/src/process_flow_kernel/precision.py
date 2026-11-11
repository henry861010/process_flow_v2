"""Process-flow length policy, in micrometers.

Placement quantization removes arithmetic tails. Meshing separately aligns
near coordinates using the larger geometry tolerance.
"""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
import math

DEFAULT_GEOMETRY_TOLERANCE_UM = 0.001
PLACEMENT_GRID_UM = DEFAULT_GEOMETRY_TOLERANCE_UM / 10


def quantize_coordinate(value: float, grid: float = PLACEMENT_GRID_UM) -> float:
    """Nearest grid point, with symmetric half-away-from-zero ties."""
    if not math.isfinite(value) or not math.isfinite(grid) or grid <= 0:
        raise ValueError("Coordinate and positive grid must be finite")
    if math.ulp(value) * 4 > grid:
        raise ValueError("Coordinate precision cannot resolve the placement grid")
    quantum = Decimal(str(grid))
    ticks = (Decimal(str(value)) / quantum).to_integral_value(rounding=ROUND_HALF_UP)
    return float(ticks * quantum) if ticks else 0.0


def _geometries(container):
    for field in ("bodies", "vias", "circuits", "bumps"):
        for feature in container.get(field, []):
            yield feature["geometry"]
    for child in container.get("children", []):
        yield from _geometries(child)


def _base(geometry):
    kind = geometry["type"]
    if kind == "BoxGeometry":
        return geometry["bottom_left"][2]
    if kind == "PolygonGeometry":
        return geometry["polys"][0][0][2]
    return geometry["center"][2]


def place_on_coordinate_grid(structure, *, x: float, y: float, bottom_z: float | None = None):
    """Translate a complete private PnP subtree, then quantize absolute geometry.

    Quantize endpoints together and derive thickness from their grid indices.
    Feature IDs/materials/provenance references and other attributes are retained.
    """
    from .utils.polygon import validate_polygon_loops

    result = deepcopy(structure)
    units = {"um": 1.0, "mm": 1e3, "nm": 1e-3, "m": 1e6}
    unit = structure.get("unitSystem", "um")
    if unit not in units:
        raise ValueError(f"Unsupported PnP coordinate unit: {unit}")
    grid = float(Decimal(str(PLACEMENT_GRID_UM)) / Decimal(str(units[unit])))
    snap = lambda value: quantize_coordinate(float(value), grid)
    geometries = list(_geometries(result["root"]))
    if not geometries:
        raise ValueError("PnP requires non-empty source geometry")
    source_bottom = min(_base(geometry) for geometry in geometries)
    if bottom_z is None:
        bottom_z = source_bottom
    dz = bottom_z - source_bottom

    def point(value):
        return [snap(value[0] + x), snap(value[1] + y), snap(value[2] + dz)]

    for geometry in geometries:
        base, thickness = _base(geometry), geometry["thk"]
        start, end = snap(base + dz), snap(base + dz + thickness)
        rounded_thickness = float(Decimal(str(end)) - Decimal(str(start)))
        if thickness > 0 and rounded_thickness <= 0:
            raise ValueError("PnP coordinate grid would collapse a material thickness")
        kind = geometry["type"]
        if kind == "BoxGeometry":
            lower, upper = point(geometry["bottom_left"]), point(geometry["top_right"])
            if any(lower[axis] == upper[axis] for axis in (0, 1)):
                raise ValueError("PnP coordinate grid would collapse a box footprint")
            geometry["bottom_left"], geometry["top_right"] = lower, upper
        elif kind == "PolygonGeometry":
            loops = [[point(vertex) for vertex in loop] for loop in geometry["polys"]]
            for before, after in zip(geometry["polys"], loops):
                for index in range(len(after)):
                    following = (index + 1) % len(after)
                    if after[index][:2] == after[following][:2] and before[index][:2] != before[following][:2]:
                        raise ValueError("PnP coordinate grid would collapse a polygon edge")
            validate_polygon_loops(loops)
            geometry["polys"] = loops
        elif kind in ("CylinderGeometry", "ConeGeometry"):
            geometry["center"] = point(geometry["center"])
            for field in ("bottom_radius", "top_radius"):
                if field in geometry:
                    radius = snap(geometry[field])
                    if geometry[field] > 0 and radius <= 0:
                        raise ValueError("PnP coordinate grid would collapse a radius")
                    geometry[field] = radius
        else:
            raise ValueError(f"Unsupported PnP geometry: {kind}")
        geometry["thk"] = rounded_thickness
    return result, snap(bottom_z)
