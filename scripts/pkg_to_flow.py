#!/usr/bin/env python3
r"""Convert a package JSON into a new ProcessFlow using an existing HTTP API.

Python 3.11+, standard library only. Copy this file anywhere; no repository
imports, installation, server changes, or access to the server database needed.

Usage (run from the directory containing this file):
  python3 pkg_to_flow.py --template template.json --pkg pkg.json
  python3 pkg_to_flow.py --template template.json --pkg pkg.json \
      --api-url http://localhost:8000 --dry-run --output flow.json
  python3 pkg_to_flow.py --self-test

Example template.json (labels must match the reference flow's saved labels):
{
  "schemaVersion": 3,
  "sourceRoot": "structureEditor.packageFeature",
  "referenceFlow": {"id": "YOUR_REFERENCE_FLOW_ID"},
  "output": {"name": "Converted package", "owner": "RD", "version": "V1"},
  "constants": {"overmolding_thk": 20},
  "mappings": [
    {"target": "step.td_molding.material",
     "expr": "materialSelected.molding"},
    {"target": "step.td_molding.thickness",
     "expr": "others.molding_thk + constant.overmolding_thk"},
    {"target": "step.td_grinding.thk",
     "expr": "constant.overmolding_thk"},
    {"target": "generator.soc.siThickness", "expr": "others.topDieThk"},
    {"target": "generator.soc.siMaterial", "expr": "'si'"}
  ],
  "placements": [
    {"expr": "soc.socInfo", "target": "step.soc_pnp.placements"}
  ],
  "rdl": [
    {"expr": "fsRDL", "target": "step.fs_rdl.layers"}
  ]
}

Matching example pkg.json (molding_thk is an example key, not a built-in name):
{
  "structureEditor": {"packageFeature": {
    "materialSelected": {"molding": "EMC", "cu": "Cu",
                         "fsPM1": "PI", "fsRDL1": "PI", "fsPM2": "PI"},
    "others": {"molding_thk": 100, "topDieThk": 50},
    "soc": {"socInfo": {
      "SoC-1": {"bottomLeftX": 0, "bottomLeftY": 0,
                "upperRightX": 100, "upperRightY": 200}}},
    "fsRDL": {"rdlCount": 1,
      "rdlPMInfo": {"PM1": {"pmThk": 3}, "PM2": {"pmThk": 4}},
      "rdlRDLInfo": {"RDL1": {"rdlThk": 2, "rdlPatternDensity": 50}}}
  }}
}

Contract:
  * Template schemaVersion is 3. Older schemas, object targets, source/value
    specs, countSource/countExpr, and rdl rules' pm/rdl material specs are not supported.
    ProcessFlow output independently stays schema 3.
  * referenceFlow is either {id} or {name, version}; versions are opaque strings.
  * sourceRoot is a path from the document root, or "" for the whole document.
    expression paths are relative to it. Paths support a.b, a["SoC-1"], a[0].
  * Every value spec is {expr}, with an optional literal default. A plain path
    preserves its JSON type; constant.NAME reads a template constant. Literals
    include quoted strings, finite numbers, true/false, arrays, and objects.
    For example: {"expr": "'Cu'"}, {"expr": "true"}, {"expr": "[]"}.
    Only arithmetic (+ - * /, unary +/- and parentheses) requires numbers;
    booleans are not numbers. Functions, concatenation and Python eval are not
    supported. A null result is missing; null inside a collection is preserved.
    Defaults apply ONLY to missing/null source operands, not
    invalid values, illegal expressions, division by zero, or unknown targets.
  * Targets are strings: step.label.field or generator.label.field, exactly
    three string segments. field is a parameter ID; labels must match uniquely.
    Quote special characters, e.g. JSON "step[\"C4 Bump\"].thk" or
    "step[\"molding.top\"].thickness". Bracket notation also works for fields.
    Step mappings update only the selected recipe; generator mappings require
    an existing generator binding. Repeated writes to one target are rejected.
  * placements rules need only target and expr. Each Info entry produces one
    placement; count is always derived from the entries, never from a template
    setting. For a plain path foo.fooInfo, the sibling fooCount, if present and
    non-null, is checked for consistency only. Empty Info becomes [].
    Rectangles use micrometres and absolute coordinates, without recentering.
  * rdl rules need only target and expr: expr must name fsRDL or bsRDL relative
    to sourceRoot. The tool reads rdlPMInfo/rdlRDLInfo and optional rdlCount.
    Numbered keys must be contiguous from 1, with one more PM than RDL.
    PM1,RDL1,...,PM(n+1) becomes alternating via/circuit layers. PM thickness
    comes from pmThk and density is 0; RDL uses rdlThk and rdlPatternDensity.
    Dielectric comes from materialSelected.fsPM1, fsRDL1, fsPM2, ... for fsRDL,
    or bsPM1, bsRDL1, bsPM2, ... for bsRDL. All layers' Conductivity comes from
    materialSelected.cu, including PM layers with density 0. Missing or invalid
    materials are errors; no other layer or reference material is substituted.
    Add one rule per target; changing layer counts requires only pkg changes.
  * Unmapped values, other recipes, and flowEdges are copied unchanged. Edges,
    not stepRefs array order, define topology; this tool never rewires them.
    description defaults to the reference description; other output metadata
    is required. The direct reference ID/revision is recorded in origin.
  * dry-run performs local mapping/type checks only, not server validation or
    geometry execution. It prints the create payload; --output also saves it.
    Normal execution prints the created flow's ID/name/version/revision.
    POST failures are not retried. On a network error the create outcome may
    be unknown: inspect the server before retrying. Existing flows are never
    updated, including on name/version conflict.
"""

from __future__ import annotations

import argparse
import ast
import copy
from http.client import HTTPException
import json
import math
import operator
from pathlib import Path
import re
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


TEMPLATE_SCHEMA_VERSION = 3


class ConversionError(ValueError):
    """An actionable input, mapping, or HTTP error."""


class MissingValue(ConversionError):
    """Only this error permits a value spec's explicit default."""


def require_object(value: Any, where: str) -> dict:
    if not isinstance(value, dict):
        raise ConversionError(f"{where}: expected an object")
    return value


def require_text(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConversionError(f"{where}: expected a nonempty string")
    return value


def check_keys(value: Any, required: set[str], optional: set[str], where: str) -> dict:
    obj = require_object(value, where)
    missing, unknown = required - obj.keys(), obj.keys() - required - optional
    if missing or unknown:
        raise ConversionError(f"{where}: missing keys {sorted(missing)}, unknown keys {sorted(unknown)}")
    return obj


def number(value: Any, where: str) -> int | float:
    try:
        valid = type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        valid = False
    if not valid:
        raise ConversionError(f"{where}: expected a finite number (not a boolean or numeric string)")
    return value


def json_text(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    except (ValueError, TypeError, RecursionError) as exc:
        raise ConversionError(f"Invalid JSON data: {exc}") from None


def parse_json(text: str, where: str) -> Any:
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ConversionError(f"duplicate JSON key {key!r}")
            result[key] = value
        return result

    def invalid_constant(value):
        raise ConversionError(f"non-finite JSON number {value}")

    try:
        result = json.loads(text, object_pairs_hook=pairs, parse_constant=invalid_constant)
        json_text(result)  # Also reject overflow such as 1e999.
        return result
    except (ValueError, RecursionError) as exc:
        raise ConversionError(f"{where}: {exc}") from None


def read_json(filename: str) -> Any:
    try:
        return parse_json(Path(filename).read_text(encoding="utf-8-sig"), filename)
    except (OSError, UnicodeError) as exc:
        raise ConversionError(f"{filename}: {exc}") from None


def parse_tree(text: str) -> ast.expr:
    require_text(text, "path/expression")
    if len(text) > 4096:
        raise ConversionError("Path/expression exceeds 4096 characters")
    try:
        tree = ast.parse(text.strip(), mode="eval")
    except (SyntaxError, RecursionError) as exc:
        raise ConversionError(f"Invalid path/expression {text!r}: {exc}") from None
    if sum(1 for _ in ast.walk(tree)) > 128:
        raise ConversionError("Path/expression exceeds 128 syntax nodes")
    return tree.body


def path_parts(node: ast.expr) -> list[str | int]:
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, ast.Attribute):
        return [*path_parts(node.value), node.attr]
    if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant):
        key = node.slice.value
        if isinstance(key, str) or (type(key) is int and key >= 0):
            return [*path_parts(node.value), key]
    raise ConversionError("Paths allow only dictionary keys and nonnegative literal array indexes")


def parse_target(value: Any, where: str) -> dict[str, str]:
    if not isinstance(value, str):
        raise ConversionError(f"{where}: schema {TEMPLATE_SCHEMA_VERSION} requires a string target such as step.molding.thickness; object targets are removed")
    try:
        parts = path_parts(parse_tree(value))
        if len(parts) != 3 or any(not isinstance(part, str) or not part.strip() for part in parts):
            raise ConversionError("expected exactly three nonempty string segments: kind, label, field")
        if parts[0] not in ("step", "generator"):
            raise ConversionError("kind must be step or generator")
        return dict(zip(("kind", "label", "field"), parts))
    except ConversionError as exc:
        raise ConversionError(f"{where} {value!r}: {exc}") from None


def path_label(parts: list[str | int]) -> str:
    return "pkg" + "".join(f"[{json.dumps(key, ensure_ascii=False)}]" for key in parts)


def lookup_parts(root: Any, parts: list[str | int], label: str) -> Any:
    current = root
    for key in parts:
        if current is None:
            raise MissingValue(f"{label}: null parent")
        if isinstance(current, dict) and isinstance(key, str):
            if key not in current:
                raise MissingValue(f"{label}: missing key {key!r}")
            current = current[key]
        elif isinstance(current, list) and type(key) is int:
            if key >= len(current):
                raise MissingValue(f"{label}: missing index {key}")
            current = current[key]
        else:
            raise ConversionError(f"{label}: cannot access {key!r} on {type(current).__name__}")
    if current is None:
        raise MissingValue(f"{label}: null value")
    return current


def lookup(root: Any, path: str) -> Any:
    return lookup_parts(root, path_parts(parse_tree(path)), f"pkg.{path}")


_BINARY = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}
_LITERALS = {"true": True, "false": False, "null": None}


def check_expression(node: ast.expr) -> None:
    if isinstance(node, ast.Constant):
        if not (node.value is None or isinstance(node.value, (str, bool))):
            number(node.value, "expression literal")
    elif isinstance(node, (ast.Name, ast.Attribute, ast.Subscript)):
        path_parts(node)
    elif isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
        check_expression(node.left)
        check_expression(node.right)
    elif isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        check_expression(node.operand)
    elif isinstance(node, ast.List):
        for item in node.elts:
            check_expression(item)
    elif isinstance(node, ast.Dict):
        keys = set()
        for key, value in zip(node.keys, node.values):
            if not isinstance(key, ast.Constant) or not isinstance(key.value, str):
                raise ConversionError("Object literals require quoted string keys; unpacking is not supported")
            if key.value in keys:
                raise ConversionError(f"Duplicate object literal key {key.value!r}")
            keys.add(key.value)
            check_expression(value)
    else:
        raise ConversionError("Expressions allow only data paths, JSON literals, + - * / and parentheses")


def expression(text: str, root: dict, constants: dict) -> Any:
    tree = parse_tree(text)
    check_expression(tree)  # Validate the entire tree before missing-value fallback.

    def evaluate_nodes(nodes, *, numeric=False):
        results, missing = [], None
        for node in nodes:
            try:
                value = evaluate(node)
                if numeric:
                    if value is None:
                        raise MissingValue(f"expression {text!r}: null operand")
                    value = number(value, f"arithmetic operand in {text!r}")
                results.append(value)
            except MissingValue as exc:
                missing = exc
        # A missing operand must not hide an invalid sibling expression.
        if missing is not None:
            raise missing
        return results

    def evaluate(node):
        if isinstance(node, ast.Constant):
            return node.value
        elif isinstance(node, ast.Name) and node.id in _LITERALS:
            return _LITERALS[node.id]
        elif isinstance(node, (ast.Name, ast.Attribute, ast.Subscript)):
            parts = path_parts(node)
            namespace = constants if parts[0] == "constant" else root
            return lookup_parts(namespace, parts[1:] if parts[0] == "constant" else parts,
                                ast.unparse(node))
        elif isinstance(node, ast.List):
            return evaluate_nodes(node.elts)
        elif isinstance(node, ast.Dict):
            return dict(zip((key.value for key in node.keys), evaluate_nodes(node.values)))
        elif isinstance(node, ast.UnaryOp):
            result = _UNARY[type(node.op)](*evaluate_nodes([node.operand], numeric=True))
        else:
            try:
                result = _BINARY[type(node.op)](*evaluate_nodes([node.left, node.right], numeric=True))
            except (ZeroDivisionError, OverflowError) as exc:
                raise ConversionError(f"Expression {text!r}: {exc}") from None
        return number(result, f"expression {text!r}")

    result = evaluate(tree)
    if result is None:
        raise MissingValue(f"expression {text!r}: null value")
    json_text(result)
    return copy.deepcopy(result)


def reject_legacy_keys(value: Any, where: str) -> None:
    obj = require_object(value, where)
    removed = obj.keys() & {"source", "value", "countSource", "countExpr"}
    if removed:
        raise ConversionError(f"{where}: schema {TEMPLATE_SCHEMA_VERSION} removed {sorted(removed)}; use expr for values and omit count settings because placements are counted from Info entries")


def validate_spec(spec: Any, where: str) -> None:
    reject_legacy_keys(spec, where)
    check_keys(spec, {"expr"}, {"default"}, where)
    try:
        check_expression(parse_tree(spec["expr"]))
    except ConversionError as exc:
        raise ConversionError(f"{where}.expr: {exc}") from None
    if spec.get("default", True) is None:
        raise ConversionError(f"{where}: literal default cannot be null")


def resolve_value(spec: dict, root: dict, constants: dict) -> Any:
    try:
        return expression(spec["expr"], root, constants)
    except MissingValue:
        if "default" not in spec:
            raise
        return copy.deepcopy(spec["default"])


def rdl_side(expr: str, where: str) -> str:
    node = parse_tree(expr)
    if not isinstance(node, ast.Name) or node.id not in ("fsRDL", "bsRDL"):
        raise ConversionError(f"{where}: RDL expr must name fsRDL or bsRDL relative to sourceRoot; the name selects the material prefix")
    return node.id[:2]


def validate_template(template: Any) -> None:
    check_keys(template, {"schemaVersion", "sourceRoot", "referenceFlow", "output"},
               {"constants", "mappings", "placements", "rdl"}, "template")
    if type(template["schemaVersion"]) is not int or template["schemaVersion"] != TEMPLATE_SCHEMA_VERSION:
        raise ConversionError(f"template.schemaVersion: expected {TEMPLATE_SCHEMA_VERSION}; use string targets and expr, omit placement count settings, and remove RDL pm/rdl material specs in favor of pkg materialSelected.fsPM1/fsRDL1 or bsPM1/bsRDL1, plus cu")
    if template["sourceRoot"] != "":
        path_parts(parse_tree(template["sourceRoot"]))
    reference = require_object(template["referenceFlow"], "template.referenceFlow")
    if set(reference) not in ({"id"}, {"name", "version"}):
        raise ConversionError("template.referenceFlow: use {id} or {name, version}")
    for key, value in reference.items():
        require_text(value, f"template.referenceFlow.{key}")
    output = check_keys(template["output"], {"name", "owner", "version"}, {"description"}, "template.output")
    for key in ("name", "owner", "version"):
        require_text(output[key], f"template.output.{key}")
    if "description" in output and not isinstance(output["description"], str):
        raise ConversionError("template.output.description: expected a string")
    require_object(template.get("constants", {}), "template.constants")
    for section in ("mappings", "placements", "rdl"):
        rules = template.get(section, [])
        if not isinstance(rules, list):
            raise ConversionError(f"template.{section}: expected an array")
        for index, rule in enumerate(rules):
            where = f"template.{section}[{index}]"
            reject_legacy_keys(rule, where)
            required = {"target", "expr"}
            optional = {"default"}
            if section == "rdl":
                removed = rule.keys() & {"pm", "rdl"}
                if removed:
                    raise ConversionError(f"{where}: schema {TEMPLATE_SCHEMA_VERSION} removed RDL material specs {sorted(removed)}; materials are read automatically from pkg.materialSelected by side and layer number")
            check_keys(rule, required, optional, where)
            target = parse_target(rule["target"], where + ".target")
            if section != "mappings" and target["kind"] != "step":
                raise ConversionError(f"{where}.target.kind: collections require a step")
            validate_spec({key: rule[key] for key in ("expr", "default") if key in rule}, where)
            if section == "rdl":
                rdl_side(rule["expr"], where + ".expr")


def validate_parameter(definition: dict, value: Any, where: str) -> None:
    """Check mapped values only. Server remains authoritative for full validation."""
    kind = definition.get("valueType")
    if kind in ("float", "integer"):
        number(value, where)
        if kind == "integer" and int(value) != value:
            raise ConversionError(f"{where}: expected an integer")
    elif kind in ("string", "materialRef"):
        if not isinstance(value, str):
            raise ConversionError(f"{where}: expected a string")
        if kind == "materialRef":
            require_text(value, where)
    elif kind == "boolean":
        if type(value) is not bool:
            raise ConversionError(f"{where}: expected a boolean")
    elif isinstance(kind, str) and kind.endswith("[]"):
        if not isinstance(value, list):
            raise ConversionError(f"{where}: expected an array")
        for index, item in enumerate(value):
            validate_parameter({**definition, "valueType": kind[:-2]}, item, f"{where}[{index}]")
        return
    elif kind == "placements":
        if not isinstance(value, list):
            raise ConversionError(f"{where}: expected placements array")
        for index, item in enumerate(value):
            location = f"{where}[{index}]"
            require_object(item, location)
            if item.get("anchor") != "center" or item.get("pose") != {"x": 0, "y": 0, "rotationZ": 0}:
                raise ConversionError(f"{location}: expected zero pose and center anchor")
            for key in ("x", "y", "rotationZ"):
                number(item["pose"][key], f"{location}.pose.{key}")
            region = require_object(item.get("targetRegion"), location + ".targetRegion")
            if region.get("type") == "rectangle":
                for key in ("bottomLeftX", "bottomLeftY", "topRightX", "topRightY"):
                    number(region.get(key), f"{location}.targetRegion.{key}")
                if region["topRightX"] <= region["bottomLeftX"] or region["topRightY"] <= region["bottomLeftY"]:
                    raise ConversionError(f"{location}: rectangle must have positive width and height")
            elif region.get("type") == "polygon":
                points = region.get("points")
                if not isinstance(points, list) or len(points) < 3:
                    raise ConversionError(f"{location}: polygon needs at least three points")
                for point in points:
                    if not isinstance(point, list) or len(point) != 2:
                        raise ConversionError(f"{location}: polygon points must be [x, y]")
                    for coordinate in point:
                        number(coordinate, location)
            else:
                raise ConversionError(f"{location}: unknown target region type")
    elif kind == "fieldGroupArray":
        wrapper = check_keys(value, {"items"}, set(), where)
        items = wrapper["items"]
        if not isinstance(items, list):
            raise ConversionError(f"{where}.items: expected an array")
        repeat = definition["repeatDefinition"]
        if len(items) < repeat.get("minItems", 0) or (repeat.get("maxItems") is not None and len(items) > repeat["maxItems"]):
            raise ConversionError(f"{where}: item count violates parameter limits")
        fields = {field["id"]: field for field in repeat["itemParameterDefinitions"]}
        seen = set()
        for index, item in enumerate(items):
            location = f"{where}.items[{index}]"
            check_keys(item, {"itemId", "index", "values"}, set(), location)
            identity = require_text(item["itemId"], location + ".itemId")
            if identity in seen or type(item["index"]) is not int:
                raise ConversionError(f"{location}: duplicate itemId or invalid index")
            seen.add(identity)
            required = {key for key, field in fields.items() if field.get("required", True)}
            values = check_keys(item["values"], required, set(fields) - required, location + ".values")
            for key, entry in values.items():
                validate_parameter(fields[key], entry, f"{location}.values.{key}")
    else:
        raise ConversionError(f"{where}: unsupported parameter type {kind!r}")
    rule = definition.get("validation") or {}
    if kind in ("float", "integer"):
        for boundary, compare in (("min", operator.lt), ("max", operator.gt)):
            limit = rule.get(boundary)
            exclusive = rule.get("exclusive" + boundary.title(), False)
            if limit is not None and (compare(value, limit) or (exclusive and value == limit)):
                raise ConversionError(f"{where}: value violates {boundary}={limit} (exclusive={exclusive})")
    if kind in ("string", "materialRef"):
        if len(value) < (rule.get("minLength") or 0) or (rule.get("maxLength") is not None and len(value) > rule["maxLength"]):
            raise ConversionError(f"{where}: string length violates parameter limits")
        if rule.get("regex") is not None and re.fullmatch(rule["regex"], value) is None:
            raise ConversionError(f"{where}: value does not match parameter regex")
    options = definition.get("optionSource")
    if options and not any(value == entry["value"] and isinstance(value, bool) == isinstance(entry["value"], bool)
                           for entry in options["options"]):
        raise ConversionError(f"{where}: value is not one of the declared options")


def validate_count(count: Any, expected: int, label: str) -> None:
    number(count, label)
    if int(count) != count or count != expected:
        raise ConversionError(f"{label}: count {count} does not match {expected} entries")


def check_count(root: dict, parts: list[str | int], expected: int, label: str | None = None) -> None:
    label = label or path_label(parts)
    try:
        count = lookup_parts(root, parts, label)
    except MissingValue:
        return
    validate_count(count, expected, label)


def make_placements(rule: dict, root: dict, constants: dict) -> list[dict]:
    entries = require_object(resolve_value(rule, root, constants), f"expr {rule['expr']!r}")
    try:
        parts = path_parts(parse_tree(rule["expr"]))
    except ConversionError:
        parts = []  # Literal objects and other expressions have no sibling count metadata.
    if parts and isinstance(parts[-1], str) and parts[-1].endswith("Info"):
        namespace = constants if parts[0] == "constant" else root
        count_parts = [*parts[:-1], parts[-1][:-4] + "Count"]
        check_count(namespace, count_parts[1:] if parts[0] == "constant" else count_parts,
                    len(entries), f"inferred count for {rule['expr']!r}")
    result = []
    for die_id, coordinates in entries.items():
        location = f"expr {rule['expr']!r}[{die_id!r}]"
        require_text(die_id, location)
        require_object(coordinates, location)
        region = {"type": "rectangle"}
        for source, target in (("bottomLeftX", "bottomLeftX"), ("bottomLeftY", "bottomLeftY"),
                               ("upperRightX", "topRightX"), ("upperRightY", "topRightY")):
            region[target] = number(coordinates.get(source), f"{location}.{source}")
        if region["topRightX"] <= region["bottomLeftX"] or region["topRightY"] <= region["bottomLeftY"]:
            raise ConversionError(f"{location}: upper-right must be greater than bottom-left")
        result.append({"targetRegion": region, "pose": {"x": 0, "y": 0, "rotationZ": 0}, "anchor": "center"})
    return result


def numbered_entries(value: Any, prefix: str, where: str) -> dict[int, dict]:
    entries = require_object(value, where)
    indexed = {}
    for key, item in entries.items():
        match = re.fullmatch(re.escape(prefix) + r"([1-9][0-9]*)", key)
        if not match:
            raise ConversionError(f"{where}: invalid layer key {key!r}; expected {prefix}1, {prefix}2, ...")
        indexed[int(match[1])] = require_object(item, f"{where}.{key}")
    if sorted(indexed) != list(range(1, len(indexed) + 1)):
        raise ConversionError(f"{where}: layer numbers must be contiguous from 1")
    return indexed


def make_rdl(rule: dict, root: dict, constants: dict, source_root: str = "") -> dict:
    location = f"expr {rule['expr']!r}"
    side = rdl_side(rule["expr"], location)
    source = require_object(resolve_value(rule, root, constants), location)
    pm = numbered_entries(source.get("rdlPMInfo"), "PM", location + ".rdlPMInfo")
    rdl = numbered_entries(source.get("rdlRDLInfo"), "RDL", location + ".rdlRDLInfo")
    if len(pm) != len(rdl) + 1:
        raise ConversionError(f"{location}: PM count must equal RDL count + 1")
    check_count(source, ["rdlCount"], len(rdl), location + ".rdlCount")

    def material(key: str) -> str:
        path = f"pkg.{source_root + '.' if source_root else ''}materialSelected.{key}"
        return require_text(lookup_parts(root, ["materialSelected", key], path), path)

    conductivity = material("cu")
    items = []
    for layer in range(1, len(pm) + 1):
        for kind, collection, prefix in (("pm", pm, "PM"), ("rdl", rdl, "RDL")):
            if layer not in collection:
                continue
            entry = collection[layer]
            entry_path = f"{location}.{'rdlPMInfo' if kind == 'pm' else 'rdlRDLInfo'}.{prefix}{layer}"
            thickness_key = "pmThk" if kind == "pm" else "rdlThk"
            thickness = number(entry.get(thickness_key), entry_path + "." + thickness_key)
            density = 0 if kind == "pm" else number(entry.get("rdlPatternDensity"), entry_path + ".rdlPatternDensity")
            if thickness <= 0 or not 0 <= density <= 100:
                raise ConversionError(f"{entry_path}: thickness must be positive and density within 0..100")
            dielectric = material(f"{side}{prefix}{layer}")
            items.append({"itemId": f"pkg_{prefix}{layer}", "index": len(items) + 1,
                          "values": {"Dielectric": dielectric, "Conductivity": conductivity,
                                     "thk": thickness, "density": density}})
    return {"items": items}


def find_target(flow: dict, target: dict) -> tuple[dict, tuple[str, str | int], tuple[str, str]]:
    """Return the writable values, schema identity, and flow-local target identity."""
    kind, label = target["kind"], target["label"]
    section, label_key = ("stepRefs", "stepLabel") if kind == "step" else ("flowInputs", "inputLabel")
    matches = [entry for entry in flow["definition"][section] if entry.get(label_key) == label]
    if len(matches) != 1:
        raise ConversionError(f"{kind} label {label!r}: expected one match, found {len(matches)}")
    node = matches[0]
    if kind == "step":
        identity = node["stepRefId"]
        config = flow["configuration"].get("stepConfigurations", {}).get(identity, {})
        selected = config.get("selectedRecipeId")
        candidates = [recipe for recipe in config.get("recipeCandidates", []) if recipe.get("recipeId") == selected]
        if selected is None or len(candidates) != 1:
            raise ConversionError(f"step {label!r}: requires an explicitly selected recipe")
        values = candidates[0].setdefault("parameterValues", {})
        schema_key = ("step", node["processStepTemplateId"])
    else:
        identity = node["flowInputId"]
        binding = flow["configuration"].get("inputBindings", {}).get(identity, {})
        if binding.get("kind") != "generator":
            raise ConversionError(f"generator {label!r}: requires an existing generator binding, not catalog/missing")
        values = binding["parameters"]
        schema_key = (binding["generatorId"], binding["generatorVersion"])
    return require_object(values, f"{kind} {label!r} parameters"), schema_key, (kind, identity)


def rules_in(template: dict):
    for section in ("mappings", "placements", "rdl"):
        for index, rule in enumerate(template.get(section, [])):
            location = f"template.{section}[{index}]"
            yield section, location, {**rule, "target": parse_target(rule["target"], location + ".target")}


def convert(template: dict, pkg: dict, reference: dict, definitions: dict[tuple, dict]) -> dict:
    """Pure conversion: no HTTP, file access, geometry generation, or input mutation."""
    validate_template(template)
    root = require_object(lookup(pkg, template["sourceRoot"]) if template["sourceRoot"] else pkg, "pkg sourceRoot")
    if reference.get("schemaVersion") != 3:
        raise ConversionError("Reference flow must use schemaVersion 3")
    flow = {"schemaVersion": 3, "definition": copy.deepcopy(reference["definition"]),
            "configuration": copy.deepcopy(reference["configuration"]),
            "origin": {"flowId": reference["id"], "revision": reference["revision"]},
            "description": reference.get("description", ""), **copy.deepcopy(template["output"])}
    for key in ("name", "owner", "version"):
        flow[key] = flow[key].strip()
    constants = template.get("constants", {})
    pending, seen = [], set()
    # Resolve all targets before evaluating any source values.
    for section, location, rule in rules_in(template):
        target = rule["target"]
        where = f"{location} -> {target['kind']} {target['label']!r}.{target['field']}"
        try:
            values, schema_key, identity = find_target(flow, target)
            fields = definitions[schema_key]["parameterDefinitions"]
            matches = [field for field in fields if field["id"] == target["field"]]
            if len(matches) != 1:
                raise ConversionError("unknown or ambiguous parameter ID")
            field = matches[0]
            if section == "placements" and field["valueType"] != "placements":
                raise ConversionError("placements target must have valueType placements")
            if section == "rdl" and (field["valueType"] != "fieldGroupArray" or field["repeatDefinition"].get("indexBase") != 1):
                raise ConversionError("RDL target must be fieldGroupArray with indexBase 1")
            write_key = (*identity, target["field"])
            if write_key in seen:
                raise ConversionError("multiple rules write to this target")
            seen.add(write_key)
            pending.append((section, where, rule, values, field))
        except (ConversionError, KeyError, TypeError) as exc:
            raise ConversionError(f"{where}: {exc}") from None
    for section, where, rule, values, field in pending:
        try:
            if section == "placements":
                result = make_placements(rule, root, constants)
            elif section == "rdl":
                result = make_rdl(rule, root, constants, template["sourceRoot"])
            else:
                result = resolve_value(rule, root, constants)
            validate_parameter(field, result, where)
            values[field["id"]] = result
        except ConversionError as exc:
            raise ConversionError(f"{where} (expr {rule['expr']!r}): {exc}") from None
    json_text(flow)
    return flow


class ApiClient:
    def __init__(self, base_url: str):
        try:
            parsed = urlsplit(base_url)
            parsed.port  # Validate malformed or out-of-range ports before sending.
        except ValueError as exc:
            raise ConversionError(f"Invalid --api-url: {exc}") from None
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.query or parsed.fragment:
            raise ConversionError("--api-url must be an HTTP(S) base URL without query or fragment")
        self.base_url = base_url.rstrip("/")

    def request(self, method: str, route: str, payload: dict | None = None) -> Any:
        data = None if payload is None else json_text(payload).encode("utf-8")
        request = Request(self.base_url + route, data=data, method=method,
                          headers={"Accept": "application/json", "Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=30) as response:
                return parse_json(response.read().decode("utf-8-sig"), f"{method} {route} response")
        except HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                body = json.loads(raw)
                message = body.get("message", body.get("detail", body)) if isinstance(body, dict) else body
                message = message if isinstance(message, str) else json.dumps(message, ensure_ascii=False)
            except ValueError:
                message = raw[:2000] or exc.reason
            raise ConversionError(f"{method} {route}: HTTP {exc.code}: {message}") from None
        except (URLError, OSError, UnicodeError, HTTPException) as exc:
            outcome = " Create outcome may be unknown; inspect flows before retrying." if method == "POST" else ""
            raise ConversionError(f"{method} {route}: {exc}.{outcome}") from None


def fetch_reference(api: ApiClient, selector: dict) -> dict:
    if "id" in selector:
        flow_id = selector["id"]
    else:
        flows = api.request("GET", "/api/process-flows")
        if not isinstance(flows, list):
            raise ConversionError("GET /api/process-flows: expected a list")
        matches = [flow for flow in flows if flow.get("name") == selector["name"] and flow.get("version") == selector["version"]]
        if len(matches) != 1:
            raise ConversionError(f"referenceFlow {selector!r}: expected one match, found {len(matches)}")
        flow_id = matches[0]["id"]
    return require_object(api.request("GET", "/api/process-flows/" + quote(flow_id, safe="")), "reference flow")


def fetch_definitions(api: ApiClient, template: dict, reference: dict) -> dict[tuple, dict]:
    definitions = {}
    # find_target may initialize missing parameterValues; use a private copy.
    snapshot = copy.deepcopy(reference)
    for _, location, rule in rules_in(template):
        try:
            _, key, _ = find_target(snapshot, rule["target"])
            if key in definitions:
                continue
            if rule["target"]["kind"] == "step":
                route = "/api/process-step-templates/" + quote(str(key[1]), safe="")
            else:
                route = f"/api/geometry-generators/{quote(str(key[0]), safe='')}/versions/{key[1]}"
            definitions[key] = require_object(api.request("GET", route), route)
        except (ConversionError, KeyError, TypeError) as exc:
            raise ConversionError(f"{location} target {rule['target']}: {exc}") from None
    return definitions


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--template", help="Mapping template JSON")
    parser.add_argument("--pkg", help="Package JSON")
    parser.add_argument("--api-url", default="http://localhost:8000", help="Backend base URL")
    parser.add_argument("--dry-run", action="store_true", help="Print payload; GET requests only, no server validation")
    parser.add_argument("--output", help="Also write the create payload to this JSON file")
    parser.add_argument("--self-test", action="store_true", help="Run embedded offline tests")
    args = parser.parse_args(argv)
    if args.self_test:
        return run_self_tests()
    if not args.template or not args.pkg:
        parser.error("--template and --pkg are required unless --self-test is used")
    try:
        template, pkg = read_json(args.template), read_json(args.pkg)
        validate_template(template)
        if args.output and Path(args.output).resolve() in {Path(args.template).resolve(), Path(args.pkg).resolve()}:
            raise ConversionError("--output must not overwrite template or pkg input")
        api = ApiClient(args.api_url)
        reference = fetch_reference(api, template["referenceFlow"])
        payload = convert(template, pkg, reference, fetch_definitions(api, template, reference))
        serialized = json_text(payload)
        # Fail on an unwritable output file before any remote creation.
        if args.output:
            Path(args.output).write_text(serialized, encoding="utf-8")
        if args.dry_run:
            print("Dry run: local checks only; no server validation or creation.", file=sys.stderr)
            print(serialized, end="")
        else:
            saved = api.request("POST", "/api/process-flows", payload)
            print(json_text({key: saved[key] for key in ("id", "name", "version", "revision")}), end="")
        return 0
    except (ConversionError, OSError, KeyError, TypeError, RecursionError) as exc:
        print(f"pkg-to-flow: {exc}", file=sys.stderr)
        return 1


def run_self_tests() -> int:
    """Embedded tests keep deployment and verification in a single file."""
    import contextlib
    import io
    import tempfile
    import unittest
    from unittest.mock import patch

    class ConverterTests(unittest.TestCase):
        def setUp(self):
            self.template, self.pkg, self.reference, self.definitions = _test_fixture()

        def convert(self):
            return convert(self.template, self.pkg, self.reference, self.definitions)

        def values(self, flow, step):
            config = flow["configuration"]["stepConfigurations"][step]
            return next(r["parameterValues"] for r in config["recipeCandidates"] if r["recipeId"] == config["selectedRecipeId"])

        def test_complete_conversion_and_source_isolation(self):
            before = copy.deepcopy((self.template, self.pkg, self.reference, self.definitions))
            flow = self.convert()
            self.assertEqual(self.values(flow, "mold")["thickness"], 120)
            self.assertEqual(self.values(flow, "grind")["thk"], 20)
            self.assertEqual(flow["configuration"]["inputBindings"]["soc"]["parameters"]["siThickness"], 50)
            self.assertEqual(flow["definition"], self.reference["definition"])
            self.assertEqual(flow["origin"], {"flowId": "reference", "revision": 7})
            self.assertNotIn("id", flow)
            self.assertNotIn("revision", flow)
            self.assertEqual(flow["configuration"]["stepConfigurations"]["mold"]["recipeCandidates"][1],
                             self.reference["configuration"]["stepConfigurations"]["mold"]["recipeCandidates"][1])
            self.assertEqual(before, (self.template, self.pkg, self.reference, self.definitions))

        def test_rdl_order_materials_and_thickness(self):
            items = self.values(self.convert(), "rdl")["layers"]["items"]
            self.assertEqual([i["itemId"] for i in items], ["pkg_PM1", "pkg_RDL1", "pkg_PM2"])
            self.assertEqual([i["index"] for i in items], [1, 2, 3])
            self.assertEqual([i["values"]["thk"] for i in items], [3, 2, 4])
            self.assertEqual([i["values"]["density"] for i in items], [0, 50, 0])
            self.assertTrue(all(i["values"]["Conductivity"] == "Cu" for i in items))
            self.assertTrue(all(i["values"]["Dielectric"] == "PI" for i in items))

        def test_rdl_grows_sorts_numerically_and_shrinks(self):
            original_template = copy.deepcopy(self.template)
            source = self.pkg["fsRDL"]
            source["rdlCount"] = 12
            source["rdlPMInfo"] = {f"PM{i}": {"pmThk": i} for i in reversed(range(1, 14))}
            source["rdlRDLInfo"] = {f"RDL{i}": {"rdlThk": i, "rdlPatternDensity": i} for i in reversed(range(1, 13))}
            self.pkg["materialSelected"].update({f"fsPM{i}": f"PM dielectric {i}" for i in range(1, 14)})
            self.pkg["materialSelected"].update({f"fsRDL{i}": f"RDL dielectric {i}" for i in range(1, 13)})
            flow = self.convert()
            items = self.values(flow, "rdl")["layers"]["items"]
            self.assertEqual(len(items), 25)
            self.assertEqual(items[18]["itemId"], "pkg_PM10")
            self.assertEqual(items[18]["values"]["Dielectric"], "PM dielectric 10")
            self.reference["configuration"] = flow["configuration"]
            source.update(rdlCount=0, rdlRDLInfo={}, rdlPMInfo={"PM1": {"pmThk": 1}})
            self.pkg["materialSelected"] = {"molding": "EMC", "cu": "Cu", "fsPM1": "PI"}
            self.assertEqual(len(self.values(self.convert(), "rdl")["layers"]["items"]), 1)
            self.assertEqual(self.template, original_template)

        def test_rdl_materials_follow_side_and_layer_number(self):
            for side in ("fs", "bs"):
                with self.subTest(side=side):
                    self.setUp()
                    self.pkg[side + "RDL"] = self.pkg.pop("fsRDL")
                    self.template["rdl"][0]["expr"] = side + "RDL"
                    expected = [side + ".PM1.material", side + ".RDL1.material", side + ".PM2.material"]
                    self.pkg["materialSelected"].update(dict(zip(
                        [side + "PM1", side + "RDL1", side + "PM2"], expected)))
                    self.pkg["materialSelected"]["cu"] = "Copper-custom"
                    items = self.values(self.convert(), "rdl")["layers"]["items"]
                    self.assertEqual([item["values"]["Dielectric"] for item in items], expected)
                    self.assertEqual([item["values"]["Conductivity"] for item in items], ["Copper-custom"] * 3)
                    self.assertEqual([item["values"]["density"] for item in items], [0, 50, 0])

        def test_rdl_two_sides_in_one_flow(self):
            self.reference["definition"]["stepRefs"].append({
                "stepRefId": "bs_rdl", "stepLabel": "bs_rdl", "processStepTemplateId": "rdl_tpl"})
            self.reference["configuration"]["stepConfigurations"]["bs_rdl"] = copy.deepcopy(
                self.reference["configuration"]["stepConfigurations"]["rdl"])
            self.reference["definition"]["flowEdges"].append({"edgeId": "rdl_to_bs",
                "source": {"kind": "stepOutput", "stepRefId": "rdl", "outputPortId": "result_geometry"},
                "target": {"stepRefId": "bs_rdl", "inputPortId": "main_geometry"}})
            self.template["rdl"].append({"expr": "bsRDL", "target": "step.bs_rdl.layers"})
            self.pkg["bsRDL"] = {"rdlCount": 2,
                "rdlPMInfo": {f"PM{i}": {"pmThk": i} for i in (3, 1, 2)},
                "rdlRDLInfo": {f"RDL{i}": {"rdlThk": i + 1, "rdlPatternDensity": i * 20} for i in (2, 1)}}
            expected = ["bsPM1", "bsRDL1", "bsPM2", "bsRDL2", "bsPM3"]
            self.pkg["materialSelected"].update({key: key + "-material" for key in expected})
            original_template = copy.deepcopy(self.template)
            flow = self.convert()
            front = self.values(flow, "rdl")["layers"]["items"]
            back = self.values(flow, "bs_rdl")["layers"]["items"]
            self.assertEqual(len(front), 3)
            self.assertTrue(all(item["values"]["Dielectric"] == "PI" for item in front))
            self.assertEqual([item["values"]["Dielectric"] for item in back], [key + "-material" for key in expected])
            self.assertEqual([item["values"]["density"] for item in back], [0, 20, 0, 40, 0])
            self.assertEqual([item["values"]["thk"] for item in back], [1, 2, 2, 3, 3])
            self.assertEqual(self.template, original_template)

        def test_rdl_material_errors_show_full_pkg_path(self):
            for key in ("fsPM1", "fsRDL1", "fsPM2", "cu"):
                for invalid in (None, "", "  ", 0, False, {}, []):
                    with self.subTest(key=key, invalid=invalid):
                        self.setUp()
                        self.template["sourceRoot"] = "structureEditor.packageFeature"
                        self.pkg["materialSelected"][key] = invalid
                        self.pkg = {"structureEditor": {"packageFeature": self.pkg}}
                        with self.assertRaisesRegex(ConversionError, "pkg.structureEditor.packageFeature.materialSelected." + key):
                            self.convert()
                self.setUp()
                # Neither an existing layer nor a collection default supplies missing material.
                self.reference["configuration"] = self.convert()["configuration"]
                self.template["rdl"][0]["default"] = copy.deepcopy(self.pkg["fsRDL"])
                del self.pkg["materialSelected"][key]
                with self.subTest(key=key, missing=True), self.assertRaisesRegex(ConversionError, "pkg.materialSelected." + key):
                    self.convert()

        def test_rdl_source_names_and_missing_section(self):
            for expr in ("constant.stack", "otherRDL", "nested.fsRDL", "'fsRDL'", "{}"):
                with self.subTest(expr=expr):
                    self.setUp()
                    self.template["rdl"][0]["expr"] = expr
                    with self.assertRaisesRegex(ConversionError, "template.rdl\\[0\\].expr.*fsRDL or bsRDL"):
                        self.convert()
            self.setUp()
            del self.pkg["fsRDL"]
            with self.assertRaisesRegex(ConversionError, "fsRDL.*missing"):
                self.convert()
            self.setUp()
            self.pkg["fsRDL"] = None
            with self.assertRaisesRegex(ConversionError, "fsRDL.*null"):
                self.convert()

        def test_all_die_types_and_empty_placements(self):
            for kind in ("soc", "dmy", "lsi", "hbm"):
                with self.subTest(kind=kind):
                    self.pkg[kind] = {kind + "Count": 2, kind + "Info": {
                        "die-2": {"bottomLeftX": -10, "bottomLeftY": 2, "upperRightX": 5, "upperRightY": 8},
                        "die-1": {"bottomLeftX": 100, "bottomLeftY": 200, "upperRightX": 110, "upperRightY": 220}}}
                    self.template["placements"][0]["expr"] = f"{kind}.{kind}Info"
                    values = self.values(self.convert(), "pnp")["placements"]
                    self.assertEqual(len(values), 2)
                    self.assertEqual(values[0]["targetRegion"]["bottomLeftX"], -10)
                    self.assertEqual(values[1]["targetRegion"]["topRightY"], 220)
                    self.pkg[kind] = {kind + "Count": 0, kind + "Info": {}}
                    self.assertEqual(self.values(self.convert(), "pnp")["placements"], [])

        def test_placement_count_changes_need_no_template_changes(self):
            original_template = copy.deepcopy(self.template)
            for count in (0, 1, 3, 0):
                with self.subTest(count=count):
                    self.pkg["soc"] = {"socInfo": {
                        f"SoC-{i + 1}": {"bottomLeftX": i * 100, "bottomLeftY": 0,
                                         "upperRightX": i * 100 + 50, "upperRightY": 80}
                        for i in range(count)}}
                    flow = self.convert()
                    self.assertEqual(len(self.values(flow, "pnp")["placements"]), count)
                    self.assertEqual(self.template, original_template)
                    # Next conversion must replace the prior collection, not append to it.
                    self.reference["configuration"] = flow["configuration"]

        def test_missing_null_and_default(self):
            rule = self.template["mappings"][0]
            self.pkg["materialSelected"]["molding"] = None
            with self.assertRaisesRegex(ConversionError, "mappings\\[0\\].*materialSelected.molding"):
                self.convert()
            rule["default"] = "fallback"
            self.assertEqual(self.values(self.convert(), "mold")["material"], "fallback")
            del self.pkg["materialSelected"]["molding"]
            self.assertEqual(self.values(self.convert(), "mold")["material"], "fallback")
            self.pkg["materialSelected"]["molding"] = 123
            with self.assertRaisesRegex(ConversionError, "expected a string"):
                self.convert()

        def test_zero_false_empty_are_not_missing(self):
            for value in (0, False, []):
                self.assertEqual(resolve_value({"expr": "x", "default": "fallback"}, {"x": value}, {}), value)
            self.pkg["others"]["topDieThk"] = 0
            self.assertEqual(self.convert()["configuration"]["inputBindings"]["soc"]["parameters"]["siThickness"], 0)

        def test_expression_and_literal_paths(self):
            root = {"others": {"x": 4}, "soc": {"SoC-1": [8]}}
            self.assertEqual(expression('-(others.x + constant.extra) * 2 / 3', root, {"extra": 2}), -4)
            self.assertEqual(lookup(root, 'soc["SoC-1"][0]'), 8)
            self.assertEqual(resolve_value({"expr": "others.missing + 1", "default": 12}, root, {}), 12)
            for expr in ("1 / 0", "1e308 * 10", "True + 1", "others.x ** 2", "abs(-1)",
                         "__import__('os').getcwd()", "others.x if True else 0"):
                with self.subTest(expr=expr), self.assertRaises(ConversionError):
                    expression(expr, root, {})
            with self.assertRaises(ConversionError):
                resolve_value({"expr": "others.missing + abs(1)", "default": 1}, root, {})

        def test_expression_preserves_json_types_and_copies_collections(self):
            for value in ("Cu", 1.5, 0, True, False, [], {}, [1, "Si", False], {"items": [1, None]}):
                for expr in ("item", "constant.item"):
                    with self.subTest(value=value, expr=expr):
                        result = expression(expr, {"item": value}, {"item": value})
                        self.assertEqual(result, value)
                        self.assertIs(type(result), type(value))
                        if isinstance(value, (list, dict)):
                            self.assertIsNot(result, value)
            for expr, expected in (("'Cu'", "Cu"), ('"Si"', "Si"), ("true", True), ("false", False),
                                   ("42", 42), ("-1.5", -1.5), ("[]", []), ("{}", {}),
                                   ('{"layers": [1, "Cu", false, null]}', {"layers": [1, "Cu", False, None]})):
                with self.subTest(expr=expr):
                    result = expression(expr, {}, {})
                    self.assertEqual(result, expected)
                    self.assertIs(type(result), type(expected))
            self.assertEqual(resolve_value({"expr": "null", "default": "fallback"}, {}, {}), "fallback")

        def test_numeric_operations_do_not_coerce_or_concatenate(self):
            for expr in ("'2' + 1", "'Cu' + 'Si'", "'x' * 100", "true + 1", "-false",
                         "[1] + [2]", "[1] * 2", "{} + {}", "1e999", "constant.bad"):
                with self.subTest(expr=expr), self.assertRaises(ConversionError):
                    expression(expr, {}, {"bad": float("inf")})
            for expr in ("missing + (1 / 0)", "missing + 'Cu'", "-null + 'Cu'", "1 / 0"):
                with self.subTest(expr=expr), self.assertRaises(ConversionError) as caught:
                    resolve_value({"expr": expr, "default": 9}, {}, {})
                self.assertNotIsInstance(caught.exception, MissingValue)

        def test_disallowed_expression_syntax(self):
            for expr in ("(1, 2)", "{1, 2}", "[x for x in a]", "f'{x}'", "a[1:2]", "a[b]",
                         "[1][0]", "{**a}", "{1: 'value'}", "{'x': 1, 'x': 2}", "[ *a ]"):
                with self.subTest(expr=expr), self.assertRaises(ConversionError):
                    expression(expr, {"a": [1, 2]}, {})

        def test_target_special_labels_and_exact_three_segments(self):
            for label in ("C4 Bump", "molding.top", "mold-cap", 'mold"cap', "模封"):
                with self.subTest(label=label):
                    self.setUp()
                    self.reference["definition"]["stepRefs"][1]["stepLabel"] = label
                    target_prefix = "step[" + json.dumps(label) + "]"
                    for rule in self.template["mappings"][:2]:
                        field = parse_target(rule["target"], "test")["field"]
                        rule["target"] = target_prefix + "." + field
                    self.assertEqual(self.values(self.convert(), "mold")["thickness"], 120)
            self.assertEqual(parse_target('step["a.b"]["c.d"]', "target"),
                             {"kind": "step", "label": "a.b", "field": "c.d"})
            for target in ("step.mold", "step.mold.thickness.extra", "step[0].field", "step.x[0]",
                           "step[''].field", "step.x[' ']", "other.x.field", "step.C4 Bump.thk", "step.x().field"):
                with self.subTest(target=target), self.assertRaises(ConversionError):
                    parse_target(target, "target")
            self.setUp()
            self.template["mappings"].append({"target": 'step["mold"].material', "expr": "'Si'"})
            with self.assertRaisesRegex(ConversionError, "multiple rules"):
                self.convert()

        def test_collection_expressions_counts_and_defaults(self):
            rule = self.template["placements"][0]
            rule.update(expr="{}")
            self.assertEqual(self.values(self.convert(), "pnp")["placements"], [])
            rule.update(expr="absent", default={})
            self.assertEqual(self.values(self.convert(), "pnp")["placements"], [])
            rule.update(expr="constant.socInfo")
            self.template["constants"].update(socInfo=self.pkg["soc"]["socInfo"], socCount=2)
            with self.assertRaisesRegex(ConversionError, "inferred count.*does not match"):
                self.convert()
            self.template["constants"]["socCount"] = 1
            self.assertEqual(len(self.values(self.convert(), "pnp")["placements"]), 1)
            del self.template["constants"]["socCount"]
            self.assertEqual(len(self.values(self.convert(), "pnp")["placements"]), 1)
            self.template["constants"]["socCount"] = None
            self.assertEqual(len(self.values(self.convert(), "pnp")["placements"]), 1)
            rule["expr"] = "[]"
            with self.assertRaisesRegex(ConversionError, "expected an object"):
                self.convert()

        def test_invalid_collections(self):
            cases = [
                lambda: self.pkg["soc"].update(socCount=2),
                lambda: self.pkg["soc"]["socInfo"]["SoC-1"].update(upperRightX=0),
                lambda: self.pkg["soc"]["socInfo"]["SoC-1"].update(bottomLeftX=True),
                lambda: self.pkg["fsRDL"].update(rdlCount=2),
                lambda: self.pkg["fsRDL"]["rdlPMInfo"].pop("PM2"),
                lambda: self.pkg["fsRDL"]["rdlPMInfo"].update(PM3={"pmThk": 1}),
                lambda: self.pkg["fsRDL"]["rdlPMInfo"]["PM1"].update(pmThk=0),
                lambda: self.pkg["fsRDL"]["rdlRDLInfo"]["RDL1"].update(rdlPatternDensity=101),
            ]
            for change in cases:
                with self.subTest(change=change):
                    self.setUp()
                    change()
                    with self.assertRaises(ConversionError):
                        self.convert()

        def test_unknown_duplicate_and_invalid_targets(self):
            for label in ("missing", "duplicate"):
                self.setUp()
                if label == "missing":
                    self.template["mappings"][0]["target"] = "step.missing.material"
                else:
                    self.reference["definition"]["stepRefs"].append(copy.deepcopy(self.reference["definition"]["stepRefs"][1]))
                with self.assertRaisesRegex(ConversionError, "expected one match"):
                    self.convert()
            self.setUp()
            self.template["mappings"][0]["target"] = "step.mold.missing"
            with self.assertRaisesRegex(ConversionError, "parameter ID"):
                self.convert()
            self.setUp()
            self.template["mappings"].append(copy.deepcopy(self.template["mappings"][0]))
            with self.assertRaisesRegex(ConversionError, "multiple rules"):
                self.convert()
            self.setUp()
            self.reference["configuration"]["stepConfigurations"]["mold"]["selectedRecipeId"] = None
            with self.assertRaisesRegex(ConversionError, "selected recipe"):
                self.convert()
            self.setUp()
            self.reference["configuration"]["inputBindings"]["soc"] = {"kind": "catalog", "geometryId": "die"}
            with self.assertRaisesRegex(ConversionError, "generator binding"):
                self.convert()

        def test_strict_template_json_and_schema_checks(self):
            for text in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":1e999}'):
                with self.assertRaises(ConversionError):
                    parse_json(text, "test")
            self.template["mappings"][0]["soruce"] = "typo"
            with self.assertRaisesRegex(ConversionError, "unknown keys"):
                self.convert()
            for value in (True, "1", float("inf"), -1):
                with self.subTest(value=value), self.assertRaises(ConversionError):
                    validate_parameter({"valueType": "float", "validation": {"min": 0}}, value, "test")

        def test_nested_root_and_automatic_count_check(self):
            self.template["sourceRoot"] = "structureEditor.packageFeature"
            self.pkg["soc"]["socCount"] = 1
            self.pkg = {"structureEditor": {"packageFeature": self.pkg}}
            self.assertEqual(len(self.values(self.convert(), "pnp")["placements"]), 1)

        def test_generator_material_mapping_and_null_counts(self):
            self.template["mappings"].append({
                "target": "generator.soc.siMaterial", "expr": "materialSelected.soc"})
            self.pkg["materialSelected"]["soc"] = "Si-custom"
            self.pkg["soc"]["socCount"] = None
            self.pkg["fsRDL"]["rdlCount"] = None
            flow = self.convert()
            self.assertEqual(flow["configuration"]["inputBindings"]["soc"]["parameters"]["siMaterial"], "Si-custom")

        def test_legacy_formats_are_rejected_at_their_locations(self):
            changes = [
                (lambda: self.template.update(schemaVersion=1), "template.schemaVersion.*expected 3"),
                (lambda: self.template.update(schemaVersion=2), "template.schemaVersion.*expected 3"),
                (lambda: self.template["mappings"][0].update(target={"kind": "step", "label": "mold", "field": "material"}), "mappings\\[0\\].target.*string target"),
                (lambda: self.template["mappings"][0].update(source="materialSelected.molding"), "mappings\\[0\\].*removed.*source"),
                (lambda: self.template["mappings"][0].update(value="Cu"), "mappings\\[0\\].*removed.*value"),
                (lambda: self.template["placements"][0].update(countSource="soc.socCount"), "placements\\[0\\].*removed.*countSource"),
                (lambda: self.template["placements"][0].update(countExpr="soc.socCount"), "placements\\[0\\].*removed.*countExpr.*counted from Info entries"),
                (lambda: self.template["rdl"][0].update(pm={"Dielectric": {"expr": "'PI'"}}), "rdl\\[0\\].*removed RDL material specs.*pm"),
                (lambda: self.template["rdl"][0].update(rdl={"Conductivity": {"expr": "'Cu'"}}), "rdl\\[0\\].*removed RDL material specs.*rdl"),
            ]
            for change, message in changes:
                self.setUp()
                change()
                with self.subTest(message=message), self.assertRaisesRegex(ConversionError, message):
                    self.convert()

        def test_help_example_uses_valid_schema_three(self):
            example = __doc__.split("Example template.json", 1)[1].split("Matching example pkg.json", 1)[0]
            template = parse_json(example[example.index("{"):].strip(), "help example")
            validate_template(template)
            self.assertEqual(template["schemaVersion"], 3)
            example = __doc__.split("Matching example pkg.json", 1)[1].split("Contract:", 1)[0]
            pkg = parse_json(example[example.index("{"):].strip(), "help pkg example")
            root = lookup(pkg, template["sourceRoot"])
            layers = make_rdl(template["rdl"][0], root, template["constants"], template["sourceRoot"])
            self.assertEqual([item["values"]["Dielectric"] for item in layers["items"]], ["PI"] * 3)

        def test_manifest_range_and_enum_checks(self):
            schema = {"valueType": "float", "validation": {"min": 0, "max": 100}}
            for value in (0, 100):
                validate_parameter(schema, value, "density")
            for value in (-1, 101):
                with self.assertRaises(ConversionError):
                    validate_parameter(schema, value, "density")
            schema = {"valueType": "materialRef", "optionSource": {"options": [{"value": "Cu"}]}}
            validate_parameter(schema, "Cu", "material")
            with self.assertRaisesRegex(ConversionError, "declared options"):
                validate_parameter(schema, "Si", "material")
            with self.assertRaises(ConversionError):
                validate_parameter({"valueType": "integer"}, 1.5, "count")

        def test_invalid_api_urls(self):
            for url in ("file:///tmp/db", "http://[broken", "http://localhost:bad", "http://localhost:99999", "http://localhost?q=x"):
                with self.subTest(url=url), self.assertRaises(ConversionError):
                    ApiClient(url)

        def test_cli_dry_run_create_conflict_and_output(self):
            calls = []
            owner = self

            class FakeApi:
                def __init__(self, url):
                    pass

                def request(self, method, route, payload=None):
                    calls.append((method, route, copy.deepcopy(payload)))
                    if method == "POST":
                        return {"id": "created", "revision": 1, **payload}
                    if route == "/api/process-flows":
                        return [owner.reference]
                    if route.startswith("/api/process-flows/"):
                        return copy.deepcopy(owner.reference)
                    for key, definition in owner.definitions.items():
                        if route.endswith(str(key[1])) and (key[0] == "step" or f"/{key[0]}/" in route):
                            return copy.deepcopy(definition)
                    raise AssertionError(route)

            with tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                template_file, pkg_file, output_file = (folder / name for name in ("template.json", "pkg.json", "flow.json"))
                self.template["referenceFlow"] = {"name": self.reference["name"], "version": self.reference["version"]}
                template_file.write_text(json_text(self.template), encoding="utf-8")
                pkg_file.write_text(json_text(self.pkg), encoding="utf-8")
                args = ["--template", str(template_file), "--pkg", str(pkg_file), "--output", str(output_file)]
                with patch.dict(main.__globals__, {"ApiClient": FakeApi}), contextlib.redirect_stdout(io.StringIO()) as stdout, contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(main([*args, "--dry-run"]), 0)
                    self.assertEqual(read_json(str(output_file)), json.loads(stdout.getvalue()))
                    self.assertFalse(any(method == "POST" for method, _, _ in calls))
                    self.assertEqual(main(args), 0)
                    self.assertEqual(sum(method == "POST" for method, _, _ in calls), 1)
                    self.assertEqual(main([*args[:-2], "--output", str(pkg_file)]), 1)
                with patch.object(FakeApi, "request", side_effect=ConversionError("HTTP 409: already exists")) as request, patch.dict(main.__globals__, {"ApiClient": FakeApi}), contextlib.redirect_stderr(io.StringIO()) as stderr:
                    self.assertEqual(main(args), 1)
                    self.assertIn("409", stderr.getvalue())
                    self.assertEqual(request.call_count, 1)

        def test_http_error_and_timeout_are_not_retried(self):
            error = HTTPError("http://example/api/process-flows", 409, "Conflict", {}, io.BytesIO(b'{"message":"Duplicate flow"}'))
            with patch.dict(ApiClient.request.__globals__, {"urlopen": unittest.mock.Mock(side_effect=error)}) as namespace:
                with self.assertRaisesRegex(ConversionError, "HTTP 409: Duplicate flow"):
                    ApiClient("http://example").request("POST", "/api/process-flows", {})
                self.assertEqual(namespace["urlopen"].call_count, 1)
            with patch.dict(ApiClient.request.__globals__, {"urlopen": unittest.mock.Mock(side_effect=TimeoutError("timeout"))}) as namespace:
                with self.assertRaisesRegex(ConversionError, "outcome may be unknown"):
                    ApiClient("http://example").request("POST", "/api/process-flows", {})
                self.assertEqual(namespace["urlopen"].call_count, 1)

    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ConverterTests))
    return 0 if result.wasSuccessful() else 1


def _test_fixture() -> tuple[dict, dict, dict, dict]:
    """Small offline schema-3 fixture, also usable by isolated API smoke tests."""
    def field(identity, kind, **kwargs):
        return {"id": identity, "name": identity, "valueType": kind, **kwargs}

    definitions = {
        ("step", "mold_tpl"): {"parameterDefinitions": [field("material", "materialRef"), field("thickness", "float", validation={"min": 0, "exclusiveMin": True})]},
        ("step", "grind_tpl"): {"parameterDefinitions": [field("thk", "float", validation={"min": 0, "exclusiveMin": True})]},
        ("step", "pnp_tpl"): {"parameterDefinitions": [field("placements", "placements")]},
        ("step", "rdl_tpl"): {"parameterDefinitions": [field("layers", "fieldGroupArray", repeatDefinition={
            "indexBase": 1, "minItems": 1, "itemParameterDefinitions": [field("Dielectric", "materialRef"),
            field("Conductivity", "materialRef"), field("thk", "float", validation={"min": 0, "exclusiveMin": True}),
            field("density", "float", validation={"min": 0, "max": 100})]})]},
        ("soc", 1): {"parameterDefinitions": [field("siMaterial", "materialRef"), field("siThickness", "float", validation={"min": 0})]},
    }
    reference = {"schemaVersion": 3, "id": "reference", "revision": 7, "name": "Reference", "version": "V0", "owner": "RD",
                 "description": "Reference description", "origin": {"flowId": "ancestor", "revision": 1},
                 "definition": {"flowInputs": [{"flowInputId": "carrier", "name": "carrier"}, {"flowInputId": "soc", "name": "SoC", "inputLabel": "soc"}],
                     "stepRefs": [{"stepRefId": name, "stepLabel": name, "processStepTemplateId": name + "_tpl"} for name in ("rdl", "mold", "pnp", "grind")],
                     "flowEdges": []},
                 "configuration": {"inputBindings": {"carrier": {"kind": "catalog", "geometryId": "carrier"},
                     "soc": {"kind": "generator", "generatorId": "soc", "generatorVersion": 1, "parameters": {"siMaterial": "si", "siThickness": 200}}},
                     "stepConfigurations": {}}}
    for source, target in (("carrier", "pnp"), ("soc", "pnp"), ("pnp", "mold"), ("mold", "grind"), ("grind", "rdl")):
        incoming = {"kind": "flowInput", "flowInputId": source} if source in ("carrier", "soc") else {"kind": "stepOutput", "stepRefId": source, "outputPortId": "result_geometry"}
        reference["definition"]["flowEdges"].append({"edgeId": f"{source}_{target}", "source": incoming,
            "target": {"stepRefId": target, "inputPortId": "die_geometry" if source == "soc" else "main_geometry"}})
    for name in ("mold", "grind", "pnp", "rdl"):
        reference["configuration"]["stepConfigurations"][name] = {"selectedRecipeId": "selected", "recipeCandidates": [
            {"recipeId": "selected", "name": "Selected", "parameterValues": {}},
            {"recipeId": "other", "name": "Other", "parameterValues": {}}]}
    reference["configuration"]["stepConfigurations"]["mold"]["recipeCandidates"][1]["parameterValues"] = {"material": "original", "thickness": 9}
    template = {"schemaVersion": 3, "sourceRoot": "", "referenceFlow": {"id": "reference"},
                "output": {"name": "Converted", "owner": "RD", "version": "V1"}, "constants": {"overmolding": 20},
                "mappings": [], "placements": [{"expr": "soc.socInfo", "target": "step.pnp.placements"}],
                "rdl": [{"expr": "fsRDL", "target": "step.rdl.layers"}]}
    for kind, label, identity, spec in (
        ("step", "mold", "material", {"expr": "materialSelected.molding"}),
        ("step", "mold", "thickness", {"expr": "others.molding_thk + constant.overmolding"}),
        ("step", "grind", "thk", {"expr": "constant.overmolding"}),
        ("generator", "soc", "siThickness", {"expr": "others.topDieThk"}),
    ):
        template["mappings"].append({"target": f"{kind}.{label}.{identity}", **spec})
    pkg = {"materialSelected": {"molding": "EMC", "cu": "Cu", "fsPM1": "PI", "fsRDL1": "PI", "fsPM2": "PI"},
           "others": {"molding_thk": 100, "topDieThk": 50},
           "soc": {"socInfo": {"SoC-1": {"bottomLeftX": 0, "bottomLeftY": 0, "upperRightX": 100, "upperRightY": 200}}},
           "fsRDL": {"rdlCount": 1, "rdlPMInfo": {"PM2": {"pmThk": 4}, "PM1": {"pmThk": 3}},
                     "rdlRDLInfo": {"RDL1": {"rdlThk": 2, "rdlPatternDensity": 50}}}}
    return template, pkg, reference, definitions


if __name__ == "__main__":
    sys.exit(main())
