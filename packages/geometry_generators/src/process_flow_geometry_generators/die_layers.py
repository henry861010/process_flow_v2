from __future__ import annotations

from .contracts import JsonObject


BOTTOM_DIE_LAYERS = (("pass2", "Pass2"), ("usg", "usg"), ("elk", "elk"))
BOTTOM_DIE_DEFAULT_PARAMETERS: JsonObject = {
    "pass2Thickness": 5.625,
    "pass2Material": "pass2",
    "usgThickness": 2.89,
    "usgMaterial": "usg",
    "elkThickness": 1.315,
    "elkMaterial": "elk",
}
