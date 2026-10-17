"""Uniform-coordinate mesh-control contract, independent of mesher versions."""
from __future__ import annotations

from process_flow_kernel import ProcessGeometryState

from .contracts import JsonObject
from .regions import _coordinate_mode, _location, _number, _object, resolve_region_control

Z_SECTION_METHODS = ("Z_SECTION_AVG", "Z_SECTION_TOP", "Z_SECTION_BOT", "Z_SECTION_CENTER")
SYMMETRY_MODES = ("full", "upper_half", "right_half", "upper_right_quarter")


def validate_mesh_control(mesh_control: JsonObject, *, state: ProcessGeometryState | None = None) -> None:
    """Validate the complete document and resolve all region controls.

    Reference regions require a geometry state. Z controls retain syntax-only
    validation; their reference resolution remains the mesher's responsibility.
    This function never rewrites the document passed to the export worker.
    """
    _object(mesh_control, "meshControl", ("schemaVersion", "unitSystem", "mesher", "globalElementSize", "symmetry", "controls"))
    for field, expected in (("schemaVersion", "1.0.0"), ("unitSystem", "um"), ("mesher", "process_flow_2_5d")):
        if mesh_control[field] != expected:
            raise ValueError(f"meshControl.{field}: expected {expected}")
    _number(mesh_control["globalElementSize"], "meshControl.globalElementSize", positive=True)
    if mesh_control["symmetry"] not in SYMMETRY_MODES:
        raise ValueError(f"meshControl.symmetry: expected one of {', '.join(SYMMETRY_MODES)}")
    if not isinstance(mesh_control["controls"], list):
        raise ValueError("meshControl.controls: expected a list")
    for index, control in enumerate(mesh_control["controls"], start=1):
        path = f"Control {index}"
        if not isinstance(control, dict):
            raise ValueError(f"{path}: expected an object")
        method = control.get("method")
        if method == "3D_REGION":
            resolve_region_control(control, state, path=path)
            continue
        if method in Z_SECTION_METHODS:
            fields = ("elementSize", "startZ", "endZ")
        elif method == "Z_POINT":
            fields = ("z",)
        else:
            raise ValueError(f"{path}.method: unsupported method")
        _object(control, path, ("method", "coordinateMode", "label", *fields), ("reference",))
        if not isinstance(control["label"], str) or not control["label"].strip():
            raise ValueError(f"{path}.label: required non-empty string")
        mode = _coordinate_mode(control, path)
        if method != "Z_POINT":
            _number(control["elementSize"], f"{path}.elementSize", positive=True)
        for field in (("z",) if method == "Z_POINT" else ("startZ", "endZ")):
            _location(control[field], "z", f"{path}.{field}", mode)
