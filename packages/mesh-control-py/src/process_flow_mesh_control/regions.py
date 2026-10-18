"""3D_REGION authoring, validation and read-only geometry resolution (um)."""
from __future__ import annotations

import copy
import math

from process_flow_kernel import BoxGeometry, PolygonGeometry, ProcessGeometryState, validate_polygon_loops

from .contracts import JsonObject
from .geometry import subtree_nodes


def _object(value, path, required, optional=()):
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected an object")
    missing = set(required) - value.keys()
    extra = value.keys() - set(required) - set(optional)
    if missing or extra:
        raise ValueError(f"{path}: missing fields {sorted(missing)}, unsupported fields {sorted(extra)}")


def _number(value, path, *, positive=False):
    try:
        finite = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise ValueError(f"{path}: expected a finite number")
    if positive and value <= 0:
        raise ValueError(f"{path}: must be greater than 0")
    return value


def _coordinate_mode(control, path):
    mode = control.get("coordinateMode")
    if mode not in ("reference", "absolute"):
        raise ValueError(f"{path}.coordinateMode: expected reference or absolute")
    if mode == "reference":
        if "reference" not in control:
            raise ValueError(f"{path}.reference: required in Reference mode")
        _reference(control["reference"], f"{path}.reference")
    elif "reference" in control:
        raise ValueError(f"{path}.reference: not allowed in Absolute mode")
    return mode


def _location(value, axis, path, mode):
    if mode == "absolute":
        _number(value, path)
        return
    _object(value, path, ("anchor", "offset"))
    if value["anchor"] not in (f"{axis}_min", f"{axis}_max"):
        raise ValueError(f"{path}.anchor: expected {axis}_min or {axis}_max")
    _number(value["offset"], f"{path}.offset")


def _reference(value, path):
    kinds = ("root", "container", "body", "via", "circuit", "bump")
    if not isinstance(value, dict) or value.get("kind") not in kinds:
        raise ValueError(f"{path}.kind: expected one of {', '.join(kinds)}")
    kind = value["kind"]
    _object(value, path, ("kind",), () if kind == "root" else (("key", "id") if kind in ("body", "container") else ("id",)))
    if kind != "root" and not any(field in value for field in ("key", "id")):
        raise ValueError(f"{path}: requires key or id")
    for field in ("key", "id"):
        if field in value and (not isinstance(value[field], str) or not value[field].strip()):
            raise ValueError(f"{path}.{field}: expected a non-empty string")


def validate_region_control(control: JsonObject, *, path="control") -> bool:
    """Validate authoring syntax; return whether geometry references are needed."""
    _object(control, path, ("method", "coordinateMode", "label", "elementSize", "region"), ("reference",))
    if control["method"] != "3D_REGION":
        raise ValueError(f"{path}.method: expected 3D_REGION")
    if not isinstance(control["label"], str) or not control["label"].strip():
        raise ValueError(f"{path}.label: required non-empty string")
    _number(control["elementSize"], f"{path}.elementSize", positive=True)
    mode = _coordinate_mode(control, path)
    region = control["region"]
    region_path = f"{path}.region"
    if not isinstance(region, dict):
        raise ValueError(f"{region_path}: expected an object")
    if region.get("type") == "box":
        _object(region, region_path, ("type", "min", "max"))
        for bound in ("min", "max"):
            _object(region[bound], f"{region_path}.{bound}", ("x", "y", "z"))
            for axis in "xyz":
                _location(region[bound][axis], axis, f"{region_path}.{bound}.{axis}", mode)
    elif region.get("type") == "polygon":
        _object(region, region_path, ("type", "loops", "startZ", "endZ"))
        if not isinstance(region["loops"], list) or not region["loops"]:
            raise ValueError(f"{region_path}.loops: requires at least one loop")
        for i, loop in enumerate(region["loops"]):
            loop_path = f"{region_path}.loops[{i}]"
            if not isinstance(loop, list) or len(loop) < 3:
                raise ValueError(f"{loop_path}: requires at least three vertices")
            for j, point in enumerate(loop):
                point_path = f"{loop_path}[{j}]"
                _object(point, point_path, ("x", "y"))
                for axis in "xy":
                    _location(point[axis], axis, f"{point_path}.{axis}", mode)
        for field in ("startZ", "endZ"):
            _location(region[field], "z", f"{region_path}.{field}", mode)
    else:
        raise ValueError(f"{region_path}.type: expected box or polygon")
    return mode == "reference"


def resolve_region_control(control: JsonObject, state: ProcessGeometryState | None = None, *, path="control") -> list[JsonObject]:
    """Resolve each matching reference independently without changing authoring data.

    Results contain sourceId (when relative), a canonical primitive and bounds.
    Absolute controls resolve once and cannot contain a reference.
    """
    relative = validate_region_control(control, path=path)
    sources = [None]
    if relative:
        if state is None:
            raise ValueError(f"{path}.reference: geometry is required")
        reference = control["reference"]
        nodes = state.find_geometry()
        containers = {node["id"]: node for node in nodes if node["kind"] == "container"}
        sources = nodes[:1] if reference["kind"] == "root" else [
            node for node in nodes if all(node.get(field) == value for field, value in reference.items())
        ]
        if not sources:
            raise ValueError(f"{path}.reference: no matching geometry")
        # Aggregate physical features only: empty child containers must not
        # contribute the kernel summary's placeholder Z=0 to a region's bounds.
        for index, source in enumerate(sources):
            if source["kind"] != "container":
                continue
            features = [node for node in subtree_nodes(nodes, containers, source) if node["kind"] != "container"]
            bounds = {
                f"{axis}{bound}": aggregate(node[f"{axis}{bound}"] for node in features) if features else None
                for axis in "xyz" for bound, aggregate in (("Min", min), ("Max", max))
            }
            sources[index] = {**source, **bounds}
    resolved = []
    for source in sources:
        source_path = f"{path}.region" + (f" (source {source['id']})" if source else "")
        if source and any(source.get(f"{axis}{bound}") is None for axis in "xyz" for bound in ("Min", "Max")):
            raise ValueError(f"{source_path}: reference bounds are empty")

        def coordinate(value):
            if not relative:
                result = value
            else:
                axis, bound = value["anchor"].split("_")
                result = source[f"{axis}{bound.title()}"] + value["offset"]
            return _number(result, source_path)

        region = control["region"]
        try:
            if region["type"] == "box":
                lower = [coordinate(region["min"][a]) for a in "xyz"]
                upper = [coordinate(region["max"][a]) for a in "xyz"]
                for i, axis in enumerate("xyz"):
                    if upper[i] <= lower[i]:
                        raise ValueError(f"{path}.region.max.{axis}: must be greater than min.{axis}" + (f" (source {source['id']})" if source else ""))
                primitive = BoxGeometry(lower, [upper[0], upper[1], lower[2]], upper[2] - lower[2]).json()
                bounds = {f"{a}{b}": values[i] for i, a in enumerate("xyz") for b, values in (("Min", lower), ("Max", upper))}
            else:
                start, end = coordinate(region["startZ"]), coordinate(region["endZ"])
                if end <= start:
                    raise ValueError(f"{path}.region.endZ: must be greater than startZ" + (f" (source {source['id']})" if source else ""))
                loops = [[[coordinate(p["x"]), coordinate(p["y"]), start] for p in loop] for loop in region["loops"]]
                primitive = PolygonGeometry(validate_polygon_loops(loops), end - start).json()
                points = [p for loop in primitive["polys"] for p in loop]
                bounds = {"xMin": min(p[0] for p in points), "xMax": max(p[0] for p in points),
                          "yMin": min(p[1] for p in points), "yMax": max(p[1] for p in points), "zMin": start, "zMax": end}
            _number(primitive["thk"], f"{source_path}.thk", positive=True)
        except ValueError as error:
            if str(error).startswith(f"{path}.region"):
                raise
            raise ValueError(f"{source_path}.loops: {error}") from error
        resolved.append({**({"sourceId": source["id"]} if source else {}), "geometry": primitive, "bounds": bounds})
    return resolved


def append_region_control(controls, details, state, *, label, element_size, coordinate_mode, region, reference=None):
    """Append a detached 3D_REGION control and its resolved bounds summary."""
    control = {"method": "3D_REGION", "coordinateMode": coordinate_mode, "label": label, "elementSize": element_size,
               "region": copy.deepcopy(region), **({"reference": copy.deepcopy(reference)} if reference is not None else {})}
    resolved = resolve_region_control(control, state)
    controls.append(control)
    details.append({"label": label, "method": "3D_REGION", "elementSize": element_size, "status": "applied",
                    "startZ": min(r["bounds"]["zMin"] for r in resolved),
                    "endZ": max(r["bounds"]["zMax"] for r in resolved),
                    "sourceIds": [r["sourceId"] for r in resolved if "sourceId" in r],
                    "resolvedRegions": [{k: v for k, v in r.items() if k != "geometry"} for r in resolved]})
