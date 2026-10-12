"""Validate catalog structures before normalization and persistence."""
from __future__ import annotations

import copy
import math
from typing import Any

from process_flow_kernel import ProcessGeometryState, normalize_geometry_structure, validate_bump_stage
from process_flow_kernel.domain.semantic_keys import validate_body_key, validate_container_key
from process_flow_kernel.utils.polygon import validate_polygon_loops


def validate_catalog_structure(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a normalized standard structure; invalid authoring input raises ValueError."""
    if payload["structureFormat"] != "standard":
        raise ValueError("structureFormat: expected standard")
    structure = copy.deepcopy(payload["structure"])
    _object(structure, "structure", {"schemaVersion", "unitSystem", "root"})
    for field, expected in (("schemaVersion", "1.0.0"), ("unitSystem", "um")):
        if structure.get(field) != expected:
            raise ValueError(f"structure.{field}: expected {expected!r}")
    _container(structure.get("root"), "structure.root")
    normalized = normalize_geometry_structure(structure)
    # Reuse kernel hydration for global ID uniqueness and downstream compatibility.
    try:
        ProcessGeometryState.from_structure(normalized)
    except ValueError as error:
        raise ValueError(f"structure.root: {error}") from error
    return normalized


def _object(value, path, allowed):
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected an object")
    for field in value:
        if field not in allowed:
            raise ValueError(f"{path}.{field}: unsupported field")


def _text(value, path):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{path}: expected a non-empty string")


def _number(value, path, *, positive=False, minimum=None, maximum=None):
    try:
        finite = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise ValueError(f"{path}: expected a finite number")
    if positive and value <= 0:
        raise ValueError(f"{path}: must be positive")
    if minimum is not None and value < minimum:
        raise ValueError(f"{path}: must be at least {minimum}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{path}: must be at most {maximum}")


def _point(value, path):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError(f"{path}: expected three coordinates [x, y, z]")
    for index, coordinate in enumerate(value):
        _number(coordinate, f"{path}[{index}]")


def _identity(value, path, *, key_validator=None):
    if "id" in value:
        _text(value["id"], f"{path}.id")
    if "key" in value and key_validator:
        _text(value["key"], f"{path}.key")
        try:
            key_validator(value["key"])
        except ValueError as error:
            raise ValueError(f"{path}.key: {error}") from error


def _container(value, path):
    collections = ("bodies", "vias", "circuits", "bumps", "children")
    _object(value, path, {"id", "key", *collections})
    _identity(value, path, key_validator=validate_container_key)
    for field in collections:
        items = value.get(field, [])
        if not isinstance(items, list):
            raise ValueError(f"{path}.{field}: expected an array")
        for index, item in enumerate(items):
            item_path = f"{path}.{field}[{index}]"
            if field == "children":
                _container(item, item_path)
            else:
                _feature(item, field, item_path)


def _feature(value, kind, path):
    allowed = {"id", "geometry", "material"}
    if kind == "bodies":
        allowed.add("key")
    else:
        allowed.update(("density", "koz"))
        if kind in ("vias", "bumps"):
            allowed.add("direction")
        if kind == "bumps":
            allowed.add("stage")
    _object(value, path, allowed)
    _identity(value, path, key_validator=validate_body_key if kind == "bodies" else None)
    _text(value.get("material"), f"{path}.material")
    _primitive(value.get("geometry"), f"{path}.geometry")
    if kind != "bodies":
        _number(value.get("density"), f"{path}.density", minimum=0, maximum=100)
        _number(value.get("koz"), f"{path}.koz", minimum=0)
    if kind in ("vias", "bumps") and value.get("direction") not in ("+z", "-z"):
        raise ValueError(f"{path}.direction: expected +z or -z")
    if kind == "bumps":
        validate_bump_stage(value.get("stage"), f"{path}.stage")


def _primitive(value, path):
    fields = {
        "BoxGeometry": {"bottom_left", "top_right"},
        "CylinderGeometry": {"center", "bottom_radius"},
        "ConeGeometry": {"center", "bottom_radius", "top_radius"},
        "PolygonGeometry": {"polys"},
    }
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected an object")
    kind = value.get("type")
    if not isinstance(kind, str) or kind not in fields:
        raise ValueError(f"{path}.type: unsupported geometry type")
    _object(value, path, {"type", "thk", *fields[kind]})
    _number(value.get("thk"), f"{path}.thk", positive=True)
    if kind == "BoxGeometry":
        for field in ("bottom_left", "top_right"):
            _point(value.get(field), f"{path}.{field}")
        lower, upper = value["bottom_left"], value["top_right"]
        if lower[2] != upper[2]:
            raise ValueError(f"{path}.top_right: Z must equal bottom_left Z")
        if upper[0] <= lower[0] or upper[1] <= lower[1]:
            raise ValueError(f"{path}.top_right: XY bounds must be non-empty")
    elif kind in ("CylinderGeometry", "ConeGeometry"):
        _point(value.get("center"), f"{path}.center")
        _number(value.get("bottom_radius"), f"{path}.bottom_radius", positive=True)
        if kind == "ConeGeometry":
            _number(value.get("top_radius"), f"{path}.top_radius", positive=True)
    else:
        loops = value.get("polys")
        if not isinstance(loops, list):
            raise ValueError(f"{path}.polys: expected an array")
        for loop_index, loop in enumerate(loops):
            if not isinstance(loop, list):
                raise ValueError(f"{path}.polys[{loop_index}]: expected an array")
            for index, point in enumerate(loop):
                _point(point, f"{path}.polys[{loop_index}][{index}]")
        try:
            # Also normalize optional duplicate closing points using kernel rules.
            value["polys"] = validate_polygon_loops(loops)
        except ValueError as error:
            raise ValueError(f"{path}.polys: {error}") from error
