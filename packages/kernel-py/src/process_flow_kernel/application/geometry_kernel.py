from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .context import ProcessStepContext
from .execution_result import GeometryKernelExecutionResult
from .flow_validation import validate_flow_graph
from .options import ExecuteOptions
from ..domain.process_geometry_state import ProcessGeometryState
from ..infrastructure.module_resolver import ProcessStepModuleResolver
from ..serialization.geometry_hydration import (
    geometry_structure_to_process_geometry_state,
    process_geometry_state_to_geometry_structure,
)
from ..serialization.schema import normalize_geometry_structure

_MISSING = object()


class GeometryKernel:
    def __init__(
        self,
        *,
        geometry_repository,
        process_flow_template_repository,
        process_step_repository,
        process_flow_instance_repository=None,
        module_resolver=None,
    ):
        self._geometry_repository = _required_repository(geometry_repository, "geometry_repository")
        self._process_flow_instance_repository = process_flow_instance_repository
        self._process_flow_template_repository = _required_repository(
            process_flow_template_repository,
            "process_flow_template_repository",
        )
        self._process_step_repository = _required_repository(process_step_repository, "process_step_repository")
        self._module_resolver = module_resolver or ProcessStepModuleResolver()

    def execute(self, process_flow_instance_or_id, options: ExecuteOptions | Mapping[str, Any] | None = None):
        execute_options = ExecuteOptions.from_value(options)
        process_flow_instance = self._resolve_process_flow_instance(process_flow_instance_or_id)
        process_flow_template = self._get_by_id_or_throw(
            self._process_flow_template_repository,
            process_flow_instance.get("processFlowTemplateId"),
            "Process flow template",
        )
        step_templates_by_id = self._load_step_templates(process_flow_template)
        validate_flow_graph(process_flow_template, process_flow_instance, step_templates_by_id)

        step_value_sets_by_ref_id = {
            value_set["stepRefId"]: value_set
            for value_set in process_flow_instance.get("stepValueSets", [])
        }
        step_refs = process_flow_template.get("stepRefs", [])
        step_refs_by_id = {step_ref["stepRefId"]: step_ref for step_ref in step_refs}
        ordered_step_refs = _topological_step_refs(step_refs, process_flow_template.get("flowEdges", []))
        step_outputs = {}

        for step_ref in ordered_step_refs:
            step_template = step_templates_by_id[step_ref["processStepTemplateId"]]
            step_value_set = step_value_sets_by_ref_id[step_ref["stepRefId"]]
            field_values = step_value_set.get("fieldValues", [])
            runtime_geometry_inputs = self._resolve_geometry_inputs(
                step_ref=step_ref,
                step_template=step_template,
                step_value_set=step_value_set,
                process_flow_template=process_flow_template,
                step_outputs=step_outputs,
            )
            input_geometry = _main_or_first_geometry(runtime_geometry_inputs)
            state = (
                _geometry_input_to_process_geometry_state(input_geometry)
                if input_geometry is not None
                else ProcessGeometryState.create()
            )
            geometry_inputs = _serialize_geometry_input_map(runtime_geometry_inputs)
            values = _build_values(step_template.get("fieldDefinitions", []), field_values)
            process_module = self._module_resolver.resolve(step_template)

            def resolve_geometry(field_id):
                geometry = runtime_geometry_inputs.get(field_id)
                return None if geometry is None else _geometry_input_to_process_geometry_state(geometry)

            context = ProcessStepContext(
                kernel=self,
                state=state,
                values=values,
                raw_field_values=field_values,
                step_ref=step_ref,
                step_template=step_template,
                step_value_set=step_value_set,
                process_flow_template=process_flow_template,
                process_flow_instance=process_flow_instance,
                geometry_inputs=geometry_inputs,
                input_geometry=_main_or_first_geometry(geometry_inputs),
                geometry_resolver=resolve_geometry,
            )

            output = process_module.execute(context)
            step_outputs[step_ref["stepRefId"]] = _normalize_step_output_state(output, state)

        terminal_step_ref_ids = _find_terminal_step_ref_ids(step_refs_by_id, process_flow_template.get("flowEdges", []))
        selected_step_ref_id = execute_options.output_step_ref_id or (terminal_step_ref_ids[-1] if terminal_step_ref_ids else None)
        if not selected_step_ref_id:
            raise ValueError("Process flow does not contain an executable terminal step")
        selected_output = step_outputs.get(selected_step_ref_id)
        if selected_output is None:
            raise ValueError(f"No geometry output for terminal step {selected_step_ref_id}")
        geometry_structure = process_geometry_state_to_geometry_structure(selected_output)
        return GeometryKernelExecutionResult(
            geometry_structure=geometry_structure,
            step_outputs=_serialize_step_outputs(step_outputs),
            terminal_step_ref_ids=terminal_step_ref_ids,
        )

    def _resolve_process_flow_instance(self, process_flow_instance_or_id):
        if not isinstance(process_flow_instance_or_id, str):
            return process_flow_instance_or_id
        if self._process_flow_instance_repository is None:
            raise ValueError("process_flow_instance_repository is required when execute receives an id")
        return self._get_by_id_or_throw(
            self._process_flow_instance_repository,
            process_flow_instance_or_id,
            "Process flow instance",
        )

    def _load_step_templates(self, process_flow_template):
        result = {}
        for step_ref in process_flow_template.get("stepRefs", []):
            template_id = step_ref.get("processStepTemplateId")
            if template_id not in result:
                result[template_id] = self._get_by_id_or_throw(
                    self._process_step_repository,
                    template_id,
                    "Process step template",
                )
        return result

    def _resolve_geometry_inputs(
        self,
        *,
        step_ref,
        step_template,
        step_value_set,
        process_flow_template,
        step_outputs,
    ):
        geometry_inputs = {}
        geometry_fields = [field for field in step_template.get("fieldDefinitions", []) if _is_geometry_field(field)]
        for field in geometry_fields:
            edge = _find_incoming_edge(
                process_flow_template.get("flowEdges", []),
                step_ref["stepRefId"],
                field["id"],
            )
            source_type = edge.get("source", {}).get("sourceType")
            if source_type == "stepOutput":
                upstream_step_ref_id = edge["source"]["stepRefId"]
                upstream_geometry = step_outputs.get(upstream_step_ref_id)
                if upstream_geometry is None:
                    raise ValueError(
                        f"Step {step_ref['stepRefId']}.{field['id']} depends on missing output {upstream_step_ref_id}"
                    )
                geometry_inputs[field["id"]] = upstream_geometry
                continue

            field_value = _find_field_value(step_value_set.get("fieldValues", []), field["id"])
            entity = self._get_by_id_or_throw(self._geometry_repository, field_value, "Geometry entity")
            if "structure" not in entity or entity["structure"] is None:
                raise ValueError(f"Geometry entity {field_value} is missing structure")
            geometry_inputs[field["id"]] = normalize_geometry_structure(entity["structure"])
        return geometry_inputs

    def _get_by_id_or_throw(self, repository, id_, label):
        if id_ is None or id_ == "":
            raise ValueError(f"{label} id is required")
        value = repository.get_by_id(id_)
        if value is None:
            raise ValueError(f"{label} not found: {id_}")
        return value


def _required_repository(repository, name):
    if repository is None or not hasattr(repository, "get_by_id"):
        raise ValueError(f"{name} with get_by_id(id) is required")
    return repository


def _topological_step_refs(step_refs, flow_edges):
    step_ref_ids = {step_ref["stepRefId"] for step_ref in step_refs}
    incoming_counts = {step_ref["stepRefId"]: 0 for step_ref in step_refs}
    outgoing = {step_ref["stepRefId"]: [] for step_ref in step_refs}
    for edge in flow_edges:
        if edge.get("source", {}).get("sourceType") != "stepOutput":
            continue
        source = edge["source"]["stepRefId"]
        target = edge.get("target", {}).get("stepRefId")
        if source not in step_ref_ids or target not in step_ref_ids:
            continue
        outgoing[source].append(target)
        incoming_counts[target] += 1

    queue = [step_ref["stepRefId"] for step_ref in step_refs if incoming_counts[step_ref["stepRefId"]] == 0]
    by_id = {step_ref["stepRefId"]: step_ref for step_ref in step_refs}
    ordered = []
    while queue:
        step_ref_id = queue.pop(0)
        ordered.append(by_id[step_ref_id])
        for target in outgoing[step_ref_id]:
            incoming_counts[target] -= 1
            if incoming_counts[target] == 0:
                queue.append(target)
    if len(ordered) != len(step_refs):
        raise ValueError("Process flow contains a cycle in stepOutput edges")
    return ordered


def _find_terminal_step_ref_ids(step_refs_by_id, flow_edges):
    sources = {
        edge["source"]["stepRefId"]
        for edge in flow_edges
        if edge.get("source", {}).get("sourceType") == "stepOutput"
    }
    return [step_ref_id for step_ref_id in step_refs_by_id.keys() if step_ref_id not in sources]


def _find_incoming_edge(flow_edges, step_ref_id, field_id):
    for edge in flow_edges:
        target = edge.get("target", {})
        if target.get("stepRefId") == step_ref_id and target.get("targetFieldId") == field_id:
            return edge
    raise ValueError(f"Missing incoming geometry edge for {step_ref_id}.{field_id}")


def _find_field_value(field_values, field_id):
    for field_value in field_values:
        if field_value.get("fieldId") == field_id:
            return field_value.get("value")
    return _MISSING


def _is_geometry_field(field):
    return field.get("valueType") == "geometryRef"


def _build_values(field_definitions, field_values):
    result = {}
    for field in field_definitions:
        if _is_geometry_field(field):
            continue
        value = _find_field_value(field_values, field.get("id"))
        result[field.get("id")] = _normalize_field_value(field, None if value is _MISSING else value)
    return result


def _normalize_field_value(field, value):
    value_type = field.get("valueType")
    if value_type == "integer":
        if value in ("", None):
            return None
        return int(value)
    if value_type == "float":
        if value in ("", None):
            return None
        return float(value)
    if value_type == "boolean":
        return value is True
    if value_type == "fieldGroupArray":
        return _normalize_field_group_array(field, value)
    return value


def _normalize_field_group_array(field, value):
    if not isinstance(value, dict) or not isinstance(value.get("items"), list):
        return []
    child_fields = field.get("repeatDefinition", {}).get("itemFieldDefinitions", [])
    normalized_items = []
    for item in value["items"]:
        normalized = {
            "_itemId": item.get("itemId"),
            "_index": item.get("index"),
        }
        for child_field in child_fields:
            child_value = _find_field_value(item.get("fieldValues", []), child_field.get("id"))
            normalized[child_field["id"]] = _normalize_field_value(
                child_field,
                None if child_value is _MISSING else child_value,
            )
        normalized_items.append(normalized)
    return normalized_items


def _first_map_value(map_):
    for value in map_.values():
        return value
    return None


def _main_or_first_geometry(map_):
    return map_.get("main_geometry") or _first_map_value(map_)


def _normalize_step_output_state(output, fallback_state):
    resolved_output = fallback_state if output is None else output
    return _geometry_input_to_process_geometry_state(resolved_output)


def _geometry_input_to_process_geometry_state(value):
    if isinstance(value, ProcessGeometryState):
        return value.clone()
    if hasattr(value, "to_geometry_structure") and callable(value.to_geometry_structure):
        return geometry_structure_to_process_geometry_state(value.to_geometry_structure())
    return geometry_structure_to_process_geometry_state(value)


def _serialize_step_outputs(step_outputs):
    return {
        step_ref_id: process_geometry_state_to_geometry_structure(output)
        for step_ref_id, output in step_outputs.items()
    }


def _serialize_geometry_input_map(geometry_inputs):
    return {
        field_id: process_geometry_state_to_geometry_structure(input_)
        for field_id, input_ in geometry_inputs.items()
    }
