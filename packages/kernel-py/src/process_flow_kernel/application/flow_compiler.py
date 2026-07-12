from __future__ import annotations

import math
import re
from collections.abc import Mapping
from typing import Any

from .execution_plan import ExecutionPlan, PlannedGeometryInput, PlannedStep
from .flow_validation import analyze_flow_graph, upstream_step_ref_ids
from .resource_resolution import GeometryCatalogResolver
from ..serialization.schema import normalize_geometry_structure


_MISSING = object()


class FlowCompiler:
    def __init__(self, geometry_catalog: GeometryCatalogResolver):
        if geometry_catalog is None or not hasattr(geometry_catalog, "get_geometry"):
            raise ValueError("geometry_catalog with get_geometry(id) is required")
        self._geometry_catalog = geometry_catalog

    def validate_configuration(
        self,
        process_flow_template: Mapping[str, Any],
        configuration: Mapping[str, Any],
        step_templates,
        *,
        require_complete: bool,
        included_step_ref_ids: set[str] | None = None,
        resolve_resources: bool = False,
    ) -> None:
        analysis = analyze_flow_graph(process_flow_template, step_templates)
        included = included_step_ref_ids or set(analysis.step_refs_by_id)
        _validate_configuration_keys(configuration, analysis)
        _validate_step_configurations(
            configuration,
            analysis,
            included,
            require_complete=require_complete,
        )

        used_flow_input_ids = _used_flow_input_ids(
            analysis.incoming_edges_by_port,
            included,
        )
        bindings = configuration.get("inputBindings", {})
        embedded_geometries = configuration.get("embeddedGeometries", {})
        for flow_input_id in used_flow_input_ids:
            binding = bindings.get(flow_input_id, _MISSING)
            if binding is _MISSING:
                if require_complete and _flow_input_binding_required(
                    analysis,
                    flow_input_id,
                    included,
                ):
                    raise ValueError(f"Missing input binding: {flow_input_id}")
                continue
            _validate_binding_shape(flow_input_id, binding, embedded_geometries)
            if resolve_resources:
                self._resolve_binding(
                    flow_input_id,
                    analysis.flow_inputs_by_id[flow_input_id],
                    binding,
                    embedded_geometries,
                )

    def compile(
        self,
        process_flow_template: Mapping[str, Any],
        configuration: Mapping[str, Any],
        step_templates,
        *,
        output_step_ref_id: str | None = None,
    ) -> ExecutionPlan:
        analysis = analyze_flow_graph(process_flow_template, step_templates)
        included = (
            upstream_step_ref_ids(process_flow_template, output_step_ref_id)
            if output_step_ref_id is not None
            else set(analysis.step_refs_by_id)
        )
        self.validate_configuration(
            process_flow_template,
            configuration,
            step_templates,
            require_complete=True,
            included_step_ref_ids=included,
            resolve_resources=True,
        )

        bindings = configuration.get("inputBindings", {})
        embedded_geometries = configuration.get("embeddedGeometries", {})
        external_geometries = {}
        for flow_input_id in _used_flow_input_ids(analysis.incoming_edges_by_port, included):
            if flow_input_id not in bindings:
                continue
            external_geometries[flow_input_id] = self._resolve_binding(
                flow_input_id,
                analysis.flow_inputs_by_id[flow_input_id],
                bindings[flow_input_id],
                embedded_geometries,
            )

        step_configurations = configuration.get("stepConfigurations", {})
        planned_steps = []
        for step_ref_id in analysis.ordered_step_ref_ids:
            if step_ref_id not in included:
                continue
            step_ref = analysis.step_refs_by_id[step_ref_id]
            step_template = analysis.step_templates_by_ref_id[step_ref_id]
            raw_values = step_configurations.get(step_ref_id, {}).get("parameterValues", {})
            values = _normalize_parameter_values(
                step_template.get("parameterDefinitions", []),
                raw_values,
                require_complete=True,
            )
            geometry_inputs = {}
            for port in step_template.get("inputPorts", []):
                port_id = port["portId"]
                edge = analysis.incoming_edges_by_port.get((step_ref_id, port_id))
                if edge is None:
                    continue
                source = edge["source"]
                if source["kind"] == "flowInput":
                    if source["flowInputId"] not in external_geometries:
                        continue
                    geometry_inputs[port_id] = PlannedGeometryInput(
                        kind="external",
                        flow_input_id=source["flowInputId"],
                    )
                else:
                    geometry_inputs[port_id] = PlannedGeometryInput(
                        kind="stepOutput",
                        step_ref_id=source["stepRefId"],
                        output_port_id=source["outputPortId"],
                    )
            planned_steps.append(
                PlannedStep(
                    step_ref_id=step_ref_id,
                    step_label=step_ref.get("stepLabel") or step_template.get("name") or step_ref_id,
                    step_template=step_template,
                    raw_parameter_values=raw_values,
                    parameter_values=values,
                    geometry_inputs=geometry_inputs,
                    output_port_id="result_geometry",
                )
            )

        terminal_step_ref_ids = [
            step_ref_id
            for step_ref_id in analysis.terminal_step_ref_ids
            if step_ref_id in included
        ]
        if output_step_ref_id is not None:
            terminal_step_ref_ids = [output_step_ref_id]
        return ExecutionPlan(
            steps=tuple(planned_steps),
            external_geometries=external_geometries,
            terminal_step_ref_ids=tuple(terminal_step_ref_ids),
        )

    def resolve_flow_input(
        self,
        process_flow_template: Mapping[str, Any],
        configuration: Mapping[str, Any],
        step_templates,
        flow_input_id: str,
    ) -> Mapping[str, Any]:
        analysis = analyze_flow_graph(process_flow_template, step_templates)
        flow_input = analysis.flow_inputs_by_id.get(flow_input_id)
        if flow_input is None:
            raise ValueError(f"Flow input not found: {flow_input_id}")
        binding = configuration.get("inputBindings", {}).get(flow_input_id, _MISSING)
        if binding is _MISSING:
            raise ValueError(f"Missing input binding: {flow_input_id}")
        return self._resolve_binding(
            flow_input_id,
            flow_input,
            binding,
            configuration.get("embeddedGeometries", {}),
        )

    def _resolve_binding(self, flow_input_id, flow_input, binding, embedded_geometries):
        _validate_binding_shape(flow_input_id, binding, embedded_geometries)
        if binding["kind"] == "catalog":
            geometry_id = binding["geometryId"]
            geometry = self._geometry_catalog.get_geometry(geometry_id)
            if geometry is None:
                raise ValueError(f"Geometry entity not found: {geometry_id}")
        else:
            geometry = embedded_geometries[binding["localId"]]

        structure = geometry.get("structure")
        if not isinstance(structure, Mapping):
            raise ValueError(f"Geometry for flow input {flow_input_id} is missing structure")
        _validate_geometry_constraints(flow_input, geometry)
        return normalize_geometry_structure(structure)


def _validate_configuration_keys(configuration, analysis):
    input_bindings = configuration.get("inputBindings", {})
    step_configurations = configuration.get("stepConfigurations", {})
    embedded_geometries = configuration.get("embeddedGeometries", {})
    if not isinstance(input_bindings, Mapping):
        raise ValueError("inputBindings must be an object")
    if not isinstance(step_configurations, Mapping):
        raise ValueError("stepConfigurations must be an object")
    if not isinstance(embedded_geometries, Mapping):
        raise ValueError("embeddedGeometries must be an object")
    unknown_inputs = set(input_bindings) - set(analysis.flow_inputs_by_id)
    if unknown_inputs:
        raise ValueError(f"Unknown flow input binding: {sorted(unknown_inputs)[0]}")
    unknown_steps = set(step_configurations) - set(analysis.step_refs_by_id)
    if unknown_steps:
        raise ValueError(f"Unknown step configuration: {sorted(unknown_steps)[0]}")


def _validate_step_configurations(configuration, analysis, included, *, require_complete):
    step_configurations = configuration.get("stepConfigurations", {})
    for step_ref_id in included:
        step_template = analysis.step_templates_by_ref_id[step_ref_id]
        values = step_configurations.get(step_ref_id, {}).get("parameterValues", {})
        if not isinstance(values, Mapping):
            raise ValueError(f"Step {step_ref_id} parameterValues must be an object")
        _normalize_parameter_values(
            step_template.get("parameterDefinitions", []),
            values,
            require_complete=require_complete,
        )


def _normalize_parameter_values(definitions, values, *, require_complete):
    definitions_by_id = {definition["id"]: definition for definition in definitions}
    unknown = set(values) - set(definitions_by_id)
    if unknown:
        raise ValueError(f"Unknown parameter value: {sorted(unknown)[0]}")
    normalized = {}
    for parameter_id, definition in definitions_by_id.items():
        value = values.get(parameter_id, _MISSING)
        required = definition.get("required", True)
        if value is _MISSING or _is_empty_value(value):
            if require_complete and required:
                raise ValueError(f"Missing required parameter: {parameter_id}")
            normalized[parameter_id] = None if value is _MISSING else value
            continue
        normalized[parameter_id] = _normalize_parameter_value(
            definition,
            value,
            require_complete=require_complete,
        )
    return normalized


def _normalize_parameter_value(definition, value, *, require_complete):
    value_type = definition.get("valueType")
    if value_type in ("string", "materialRef"):
        if not isinstance(value, str):
            raise ValueError(f"Parameter {definition['id']} must be a string")
        normalized = value
    elif value_type == "integer":
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or int(value) != value
        ):
            raise ValueError(f"Parameter {definition['id']} must be an integer")
        normalized = int(value)
    elif value_type == "float":
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            raise ValueError(f"Parameter {definition['id']} must be a number")
        normalized = float(value)
    elif value_type == "boolean":
        if not isinstance(value, bool):
            raise ValueError(f"Parameter {definition['id']} must be a boolean")
        normalized = value
    elif value_type in ("string[]", "materialRef[]", "integer[]", "float[]"):
        if not isinstance(value, list):
            raise ValueError(f"Parameter {definition['id']} must be an array")
        scalar_type = value_type[:-2]
        child_definition = {**definition, "valueType": scalar_type}
        normalized = [
            _normalize_parameter_value(
                child_definition,
                item,
                require_complete=require_complete,
            )
            for item in value
        ]
    elif value_type == "coordinates":
        normalized = _normalize_coordinates(definition["id"], value)
    elif value_type == "fieldGroupArray":
        normalized = _normalize_parameter_group(
            definition,
            value,
            require_complete=require_complete,
        )
    else:
        raise ValueError(f"Unsupported parameter valueType: {value_type}")
    _validate_parameter_rule(definition, normalized)
    return normalized


def _normalize_coordinates(parameter_id, value):
    if not isinstance(value, list):
        raise ValueError(f"Parameter {parameter_id} must be a coordinate array")
    normalized = []
    for coordinate in value:
        if (
            not isinstance(coordinate, list)
            or len(coordinate) != 2
            or any(
                not isinstance(point, list) or len(point) != 2
                for point in coordinate
            )
            or any(
                isinstance(number, bool)
                or not isinstance(number, (int, float))
                or not math.isfinite(number)
                for point in coordinate
                for number in point
            )
        ):
            raise ValueError(
                f"Parameter {parameter_id} must contain [[xMin, yMin], [xMax, yMax]] rectangles"
            )
        rectangle = [
            [float(coordinate[0][0]), float(coordinate[0][1])],
            [float(coordinate[1][0]), float(coordinate[1][1])],
        ]
        if rectangle[1][0] <= rectangle[0][0] or rectangle[1][1] <= rectangle[0][1]:
            raise ValueError(
                f"Parameter {parameter_id} rectangles must have top-right greater than bottom-left"
            )
        if any(_coordinate_rectangles_equal(rectangle, existing) for existing in normalized):
            raise ValueError(f"Parameter {parameter_id} contains duplicate coordinates")
        normalized.append(rectangle)
    return normalized


def _coordinate_rectangles_equal(left, right, tolerance=1e-6):
    return all(
        math.isclose(
            left[point_index][axis_index],
            right[point_index][axis_index],
            rel_tol=0,
            abs_tol=tolerance,
        )
        for point_index in range(2)
        for axis_index in range(2)
    )


def _normalize_parameter_group(definition, value, *, require_complete):
    if not isinstance(value, Mapping) or not isinstance(value.get("items"), list):
        raise ValueError(f"Parameter {definition['id']} must contain items")
    repeat_definition = definition.get("repeatDefinition", {})
    item_definitions = repeat_definition.get("itemParameterDefinitions", [])
    items = value["items"]
    min_items = repeat_definition.get("minItems")
    max_items = repeat_definition.get("maxItems")
    if require_complete and min_items is not None and len(items) < min_items:
        raise ValueError(f"Parameter {definition['id']} requires at least {min_items} items")
    if max_items is not None and len(items) > max_items:
        raise ValueError(f"Parameter {definition['id']} allows at most {max_items} items")
    normalized = []
    item_ids = set()
    for item in items:
        if not isinstance(item, Mapping) or not isinstance(item.get("values"), Mapping):
            raise ValueError(f"Parameter {definition['id']} item values must be an object")
        item_id = item.get("itemId")
        if not isinstance(item_id, str) or not item_id or item_id in item_ids:
            raise ValueError(f"Parameter {definition['id']} itemId must be unique")
        item_ids.add(item_id)
        item_values = _normalize_parameter_values(
            item_definitions,
            item["values"],
            require_complete=require_complete,
        )
        normalized.append({"_itemId": item_id, "_index": item.get("index"), **item_values})
    return normalized


def _validate_parameter_rule(definition, value):
    validation = definition.get("validation") or {}
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if validation.get("min") is not None:
            if validation.get("exclusiveMin") and value <= validation["min"]:
                raise ValueError(f"Parameter {definition['id']} must be greater than {validation['min']}")
            if not validation.get("exclusiveMin") and value < validation["min"]:
                raise ValueError(f"Parameter {definition['id']} must be at least {validation['min']}")
        if validation.get("max") is not None:
            if validation.get("exclusiveMax") and value >= validation["max"]:
                raise ValueError(f"Parameter {definition['id']} must be less than {validation['max']}")
            if not validation.get("exclusiveMax") and value > validation["max"]:
                raise ValueError(f"Parameter {definition['id']} must be at most {validation['max']}")
    if isinstance(value, str):
        if validation.get("minLength") is not None and len(value) < validation["minLength"]:
            raise ValueError(f"Parameter {definition['id']} is too short")
        if validation.get("maxLength") is not None and len(value) > validation["maxLength"]:
            raise ValueError(f"Parameter {definition['id']} is too long")
        if validation.get("regex") and re.fullmatch(validation["regex"], value) is None:
            raise ValueError(f"Parameter {definition['id']} does not match its required pattern")


def _validate_binding_shape(flow_input_id, binding, embedded_geometries):
    if not isinstance(binding, Mapping):
        raise ValueError(f"Input binding {flow_input_id} must be an object")
    kind = binding.get("kind")
    if kind == "catalog":
        geometry_id = binding.get("geometryId")
        if not isinstance(geometry_id, str) or not geometry_id.strip():
            raise ValueError(f"Catalog binding {flow_input_id} requires geometryId")
        return
    if kind == "embedded":
        local_id = binding.get("localId")
        if not isinstance(local_id, str) or not local_id.strip():
            raise ValueError(f"Embedded binding {flow_input_id} requires localId")
        if local_id not in embedded_geometries:
            raise ValueError(f"Embedded geometry not found: {local_id}")
        return
    raise ValueError(f"Unsupported input binding kind: {kind}")


def _validate_geometry_constraints(flow_input, geometry):
    constraints = flow_input.get("geometryConstraints") or {}
    entity_types = constraints.get("entityTypes") or []
    if entity_types and geometry.get("entityType") not in entity_types:
        raise ValueError(
            f"Geometry entityType {geometry.get('entityType')} is not accepted by {flow_input['flowInputId']}"
        )
    categories = constraints.get("categories") or []
    category = geometry.get("category")
    if categories and not any(
        category == accepted or (isinstance(category, str) and category.startswith(f"{accepted}."))
        for accepted in categories
    ):
        raise ValueError(
            f"Geometry category {category} is not accepted by {flow_input['flowInputId']}"
        )
    formats = constraints.get("structureFormats") or []
    if formats and geometry.get("structureFormat", "standard") not in formats:
        raise ValueError(
            f"Geometry structureFormat is not accepted by {flow_input['flowInputId']}"
        )


def _used_flow_input_ids(incoming_edges_by_port, included_step_ref_ids):
    result = set()
    for (step_ref_id, _), edge in incoming_edges_by_port.items():
        source = edge.get("source", {})
        if step_ref_id in included_step_ref_ids and source.get("kind") == "flowInput":
            result.add(source["flowInputId"])
    return result


def _flow_input_binding_required(analysis, flow_input_id, included_step_ref_ids):
    if analysis.flow_inputs_by_id[flow_input_id].get("required", True):
        return True
    for (step_ref_id, input_port_id), edge in analysis.incoming_edges_by_port.items():
        if step_ref_id not in included_step_ref_ids:
            continue
        source = edge.get("source", {})
        if source.get("kind") != "flowInput" or source.get("flowInputId") != flow_input_id:
            continue
        step_template = analysis.step_templates_by_ref_id[step_ref_id]
        input_port = next(
            port
            for port in step_template.get("inputPorts", [])
            if port.get("portId") == input_port_id
        )
        if input_port.get("required", True):
            return True
    return False


def _is_empty_value(value):
    return value is None or value == ""
