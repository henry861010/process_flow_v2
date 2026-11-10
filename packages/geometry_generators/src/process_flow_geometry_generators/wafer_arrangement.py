"""Standalone wafer packing on the 1 nm GDS grid; no catalog or DB dependency."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Positive = Annotated[float, Field(gt=0, allow_inf_nan=False, strict=True)]
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False, strict=True)]
ArrangeType = Literal["center", "corner", "x_half", "y_half"]
MAX_CANDIDATES = 1_000_000
MAX_RECTANGLES = 100_000
DB_UNITS_PER_UM = 1000
MIN_EDGE_MARGIN_DB = 1


class ArrangementModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class DieSize(ArrangementModel):
    x: Positive
    y: Positive


class CowSpacing(ArrangementModel):
    x: Nonnegative
    y: Nonnegative


class DummyLayerParameters(ArrangementModel):
    size: DieSize
    minSpacing: DieSize


class WaferArrangementParameters(ArrangementModel):
    allowableDiameter: Annotated[float, Field(gt=0, lt=300000, allow_inf_nan=False, strict=True)]
    cowSize: DieSize
    cowSpacing: CowSpacing
    arrangeType: ArrangeType = "center"
    # DATATYPE is encoded as a signed 16-bit GDS integer, starting at 10.
    dummyLayers: list[DummyLayerParameters] = Field(default_factory=list, max_length=32758)


class ArrangementError(ValueError):
    pass


def _db(value: float, *, ceiling: bool = False) -> int:
    rounding = ROUND_CEILING if ceiling else ROUND_HALF_UP
    return int((Decimal(str(value)) * DB_UNITS_PER_UM).to_integral_value(rounding=rounding))


def _um(value: int | float) -> float:
    return value / DB_UNITS_PER_UM


@dataclass(frozen=True)
class AxisPacking:
    length: int
    die: int
    count: int
    margin: int
    gap_total: int

    def offset(self, index: int) -> int:
        if self.count <= 1:
            return self.margin
        return self.margin + index * self.die + index * self.gap_total // (self.count - 1)

    def payload(self) -> dict:
        return {
            "count": self.count,
            "a": _um(self.margin) if self.count else None,
            "b": _um(self.gap_total // (self.count - 1)) if self.count > 1 else None,
            "bMax": _um(_ceil_div(self.gap_total, self.count - 1)) if self.count > 1 else None,
        }


def pack_axis(length: int, die: int, minimum_gap: int) -> AxisPacking:
    """Lengths are integer nm. Gap variations are at most one nm."""
    # Reserve a representable A at both ends before maximizing the count.
    # With A >= 1 nm, B must also be at least 3 nm to satisfy B >= 3A.
    feasible_gap = max(minimum_gap, 3 * MIN_EDGE_MARGIN_DB)
    count = max(0, (length - 2 * MIN_EDGE_MARGIN_DB + feasible_gap) // (die + feasible_gap))
    slack = length - count * die
    if count < 2:
        return AxisPacking(length, die, count, slack // 2 if count else 0, 0)
    # Floor the ideal A; distribute the remaining nm over the B gaps. This
    # preserves equal edge margins and ensures every actual B >= g and 3A.
    margin = min(slack // (3 * count - 1), (slack - (count - 1) * minimum_gap) // 2)
    gap_total = slack - 2 * margin
    minimum_actual_gap = gap_total // (count - 1)
    if margin < MIN_EDGE_MARGIN_DB or minimum_actual_gap < minimum_gap or minimum_actual_gap < 3 * margin:
        raise ArrangementError("Dummy spacing cannot be represented on the 1 nm grid.")
    return AxisPacking(length, die, count, margin, gap_total)


def _ceil_div(value: int, divisor: int) -> int:
    return -(-value // divisor)


def _inside(rect: tuple[int, int, int, int], diameter: int) -> bool:
    x0, y0, x1, y1 = rect
    return 4 * (max(abs(x0), abs(x1)) ** 2 + max(abs(y0), abs(y1)) ** 2) <= diameter ** 2


def _intersects(rect: tuple[int, int, int, int], diameter: int) -> bool:
    x0, y0, x1, y1 = rect
    dx, dy = max(x0, -x1, 0), max(y0, -y1, 0)
    return 4 * (dx * dx + dy * dy) < diameter ** 2


def _rectangle_payload(rect: tuple[int, int, int, int]) -> list[float]:
    return [_um(value) for value in rect]


def arrange_wafer(parameters: WaferArrangementParameters) -> dict:
    """Return deterministic rectangles [xmin, ymin, xmax, ymax], in micrometers."""
    diameter = _db(parameters.allowableDiameter)
    width, height = _db(parameters.cowSize.x), _db(parameters.cowSize.y)
    sx, sy = _db(parameters.cowSpacing.x, ceiling=True), _db(parameters.cowSpacing.y, ceiling=True)
    if not 0 < diameter < 300_000_000 or min(width, height) < 1:
        raise ArrangementError("Diameter and COW sizes must remain valid after rounding to the 1 nm grid.")
    px, py = width + sx, height + sy
    phase_x = parameters.arrangeType in ("corner", "x_half")
    phase_y = parameters.arrangeType in ("corner", "y_half")
    base_x = ((px if phase_x else 0) - width) // 2
    base_y = ((py if phase_y else 0) - height) // 2
    ix0 = (-diameter - 2 * base_x - 2 * width) // (2 * px)
    ix1 = _ceil_div(diameter - 2 * base_x, 2 * px)
    iy0 = (-diameter - 2 * base_y - 2 * height) // (2 * py)
    iy1 = _ceil_div(diameter - 2 * base_y, 2 * py)
    candidate_count = (ix1 - ix0 + 1) * (iy1 - iy0 + 1)
    if candidate_count > MAX_CANDIDATES:
        raise ArrangementError(f"Arrangement exceeds the {MAX_CANDIDATES:,} candidate limit. Increase COW size or spacing.")

    cows: list[tuple[int, int, int, int]] = []
    boundary: list[tuple[int, int, int, int]] = []
    for j in range(iy0, iy1 + 1):
        y = base_y + j * py
        for i in range(ix0, ix1 + 1):
            x = base_x + i * px
            rect = (x, y, x + width, y + height)
            if _inside(rect, diameter):
                cows.append(rect)
                if len(cows) > MAX_RECTANGLES:
                    raise ArrangementError(f"Arrangement exceeds the {MAX_RECTANGLES:,} output rectangle limit.")
            elif _intersects(rect, diameter):
                boundary.append(rect)

    plans = []
    normalized_layers = []
    for layer in parameters.dummyLayers:
        dx, dy = _db(layer.size.x), _db(layer.size.y)
        gx, gy = _db(layer.minSpacing.x, ceiling=True), _db(layer.minSpacing.y, ceiling=True)
        if min(dx, dy) < 1:
            raise ArrangementError("Dummy sizes must be at least 0.001 um after rounding to the 1 nm grid.")
        ax, ay = pack_axis(width, dx, gx), pack_axis(height, dy, gy)
        candidate_count += len(boundary) * ax.count * ay.count
        if candidate_count > MAX_CANDIDATES:
            raise ArrangementError(f"Arrangement exceeds the {MAX_CANDIDATES:,} candidate limit. Increase dummy size or minimum spacing.")
        plans.append((dx, dy, gx, gy, ax, ay))
        normalized_layers.append({"size": {"x": _um(dx), "y": _um(dy)}, "minSpacing": {"x": _um(gx), "y": _um(gy)}})

    layers = []
    warnings = []
    output_count = len(cows)
    if not cows:
        warnings.append("No complete COW fits the selected arrangement. GDS export requires at least one COW.")
    for index, (dx, dy, gx, gy, ax, ay) in enumerate(plans):
        rectangles = []
        if ax.count and ay.count:
            # Recheck the integer-grid positions before materializing rectangles.
            for axis, minimum in ((ax, gx), (ay, gy)):
                if axis.count > 1 and axis.gap_total // (axis.count - 1) < minimum:
                    raise ArrangementError("Quantized dummy spacing is below the requested minimum.")
            for cell in boundary:
                for row in range(ay.count):
                    y = cell[1] + ay.offset(row)
                    for column in range(ax.count):
                        x = cell[0] + ax.offset(column)
                        rect = (x, y, x + dx, y + dy)
                        if _inside(rect, diameter):
                            rectangles.append(_rectangle_payload(rect))
                            output_count += 1
                            if output_count > MAX_RECTANGLES:
                                raise ArrangementError(f"Arrangement exceeds the {MAX_RECTANGLES:,} output rectangle limit.")
        if not ax.count or not ay.count:
            warnings.append(f"Dummy layer {index + 1}: size does not fit within a virtual COW cell with a positive A margin on both sides.")
        elif not rectangles:
            warnings.append(f"Dummy layer {index + 1}: no complete dummy fits within the allowable circle in boundary cells.")
        layers.append({"layer": 413, "datatype": 10 + index, "rectangles": rectangles,
                       "count": len(rectangles), "x": ax.payload(), "y": ay.payload()})

    normalized = {"allowableDiameter": _um(diameter), "cowSize": {"x": _um(width), "y": _um(height)},
                  "cowSpacing": {"x": _um(sx), "y": _um(sy)}, "arrangeType": parameters.arrangeType,
                  "dummyLayers": normalized_layers}
    if normalized != parameters.model_dump(mode="json"):
        warnings.append("Dimensions were rounded to the 1 nm GDS grid; requested minimum spacings were rounded up.")
    return {"normalizedParameters": normalized, "cowRectangles": [_rectangle_payload(rect) for rect in cows],
            "boundaryCells": [_rectangle_payload(rect) for rect in boundary], "dummyLayers": layers,
            "cowCount": len(cows), "cowAreaUtilization": len(cows) * width * height / (math.pi * (diameter / 2) ** 2),
            "totalRectangles": output_count, "warnings": warnings}
