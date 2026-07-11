from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class FlowGraphAnalysis:
    step_refs_by_id: Mapping[str, Mapping[str, Any]]
    step_templates_by_ref_id: Mapping[str, Mapping[str, Any]]
    flow_inputs_by_id: Mapping[str, Mapping[str, Any]]
    incoming_edges_by_port: Mapping[tuple[str, str], Mapping[str, Any]]
    ordered_step_ref_ids: Sequence[str]
    terminal_step_ref_ids: Sequence[str]


def validate_flow_graph(process_flow_template, step_templates):
    analyze_flow_graph(process_flow_template, step_templates)


def validate_process_step_template(step_template):
    _validate_step_template_ports(step_template)


def analyze_flow_graph(process_flow_template, step_templates) -> FlowGraphAnalysis:
    step_templates_by_id = _template_map(step_templates)
    step_refs_by_id = _unique_items(
        process_flow_template.get("stepRefs", []),
        "stepRefId",
        "ProcessFlowTemplate.stepRefs",
    )
    flow_inputs_by_id = _unique_items(
        process_flow_template.get("flowInputs", []),
        "flowInputId",
        "ProcessFlowTemplate.flowInputs",
    )

    step_templates_by_ref_id = {}
    input_ports_by_step = {}
    output_ports_by_step = {}
    for step_ref_id, step_ref in step_refs_by_id.items():
        step_label = step_ref.get("stepLabel")
        if step_label is not None and not isinstance(step_label, str):
            raise ValueError("ProcessFlowTemplate.stepRefs[] stepLabel must be a string when provided")
        template_id = step_ref.get("processStepTemplateId")
        step_template = step_templates_by_id.get(template_id)
        if step_template is None:
            raise ValueError(f"Process step template not found: {template_id}")
        _validate_step_template_ports(step_template)
        step_templates_by_ref_id[step_ref_id] = step_template
        input_ports_by_step[step_ref_id] = _unique_items(
            step_template.get("inputPorts", []),
            "portId",
            f"ProcessStepTemplate {template_id}.inputPorts",
        )
        output_ports_by_step[step_ref_id] = _unique_items(
            step_template.get("outputPorts", []),
            "portId",
            f"ProcessStepTemplate {template_id}.outputPorts",
        )

    incoming_edges_by_port = {}
    step_output_edges = []
    outgoing_output_ports = set()
    edge_ids = set()
    used_flow_input_ids = set()
    for edge in process_flow_template.get("flowEdges", []):
        edge_id = edge.get("edgeId")
        if not isinstance(edge_id, str) or not edge_id.strip():
            raise ValueError("ProcessFlowTemplate.flowEdges[] edgeId must be a non-empty string")
        if edge_id in edge_ids:
            raise ValueError(f"Duplicate flow edge id: {edge_id}")
        edge_ids.add(edge_id)

        target = edge.get("target", {})
        target_step_ref_id = target.get("stepRefId")
        input_port_id = target.get("inputPortId")
        if target_step_ref_id not in step_refs_by_id:
            raise ValueError(f"Flow edge target stepRefId not found: {target_step_ref_id}")
        target_port = input_ports_by_step[target_step_ref_id].get(input_port_id)
        if target_port is None:
            raise ValueError(
                f"Flow edge target input port not found: {target_step_ref_id}.{input_port_id}"
            )
        target_key = (target_step_ref_id, input_port_id)
        if target_key in incoming_edges_by_port:
            raise ValueError(
                f"Multiple incoming edges for input port {target_step_ref_id}.{input_port_id}"
            )
        incoming_edges_by_port[target_key] = edge

        source = edge.get("source", {})
        source_kind = source.get("kind")
        if source_kind == "flowInput":
            flow_input_id = source.get("flowInputId")
            flow_input = flow_inputs_by_id.get(flow_input_id)
            if flow_input is None:
                raise ValueError(f"Flow input not found: {flow_input_id}")
            _assert_matching_data_type(flow_input, target_port, edge_id)
            used_flow_input_ids.add(flow_input_id)
            continue
        if source_kind != "stepOutput":
            raise ValueError(f"Unsupported flow edge source kind: {source_kind}")

        source_step_ref_id = source.get("stepRefId")
        output_port_id = source.get("outputPortId")
        if source_step_ref_id not in step_refs_by_id:
            raise ValueError(f"Flow edge source stepRefId not found: {source_step_ref_id}")
        if source_step_ref_id == target_step_ref_id:
            raise ValueError(f"Step output edge cannot target the same step: {source_step_ref_id}")
        source_port = output_ports_by_step[source_step_ref_id].get(output_port_id)
        if source_port is None:
            raise ValueError(
                f"Flow edge source output port not found: {source_step_ref_id}.{output_port_id}"
            )
        _assert_matching_data_type(source_port, target_port, edge_id)
        output_key = (source_step_ref_id, output_port_id)
        if output_key in outgoing_output_ports:
            raise ValueError(
                f"Step output port fan-out is not supported: {source_step_ref_id}.{output_port_id}"
            )
        outgoing_output_ports.add(output_key)
        step_output_edges.append((source_step_ref_id, target_step_ref_id))

    for step_ref_id, ports in input_ports_by_step.items():
        for port_id, port in ports.items():
            if port.get("required", True) and (step_ref_id, port_id) not in incoming_edges_by_port:
                raise ValueError(f"Missing incoming edge for input port {step_ref_id}.{port_id}")

    ordered_step_ref_ids = _topological_step_ref_ids(step_refs_by_id, step_output_edges)
    unused_flow_input_ids = set(flow_inputs_by_id) - used_flow_input_ids
    if unused_flow_input_ids:
        raise ValueError(
            f"Flow input is not connected: {sorted(unused_flow_input_ids)[0]}"
        )
    source_step_ids = {source for source, _ in step_output_edges}
    terminal_step_ref_ids = [
        step_ref_id
        for step_ref_id in step_refs_by_id
        if step_ref_id not in source_step_ids
    ]
    return FlowGraphAnalysis(
        step_refs_by_id=step_refs_by_id,
        step_templates_by_ref_id=step_templates_by_ref_id,
        flow_inputs_by_id=flow_inputs_by_id,
        incoming_edges_by_port=incoming_edges_by_port,
        ordered_step_ref_ids=ordered_step_ref_ids,
        terminal_step_ref_ids=terminal_step_ref_ids,
    )


def upstream_step_ref_ids(
    process_flow_template: Mapping[str, Any],
    output_step_ref_id: str,
) -> set[str]:
    step_ref_ids = {
        step_ref.get("stepRefId")
        for step_ref in process_flow_template.get("stepRefs", [])
    }
    if output_step_ref_id not in step_ref_ids:
        raise ValueError(f"Preview stepRefId not found: {output_step_ref_id}")
    incoming = {}
    for edge in process_flow_template.get("flowEdges", []):
        source = edge.get("source", {})
        if source.get("kind") != "stepOutput":
            continue
        target_step_ref_id = edge.get("target", {}).get("stepRefId")
        incoming.setdefault(target_step_ref_id, set()).add(source.get("stepRefId"))

    included = set()
    pending = [output_step_ref_id]
    while pending:
        step_ref_id = pending.pop()
        if step_ref_id in included:
            continue
        included.add(step_ref_id)
        pending.extend(incoming.get(step_ref_id, ()))
    return included


def _validate_step_template_ports(step_template: Mapping[str, Any]) -> None:
    template_id = step_template.get("id")
    input_ports = _unique_items(
        step_template.get("inputPorts", []),
        "portId",
        f"ProcessStepTemplate {template_id}.inputPorts",
    )
    output_ports = _unique_items(
        step_template.get("outputPorts", []),
        "portId",
        f"ProcessStepTemplate {template_id}.outputPorts",
    )
    primary_ports = [
        port for port in input_ports.values()
        if port.get("role") == "primary"
    ]
    if len(primary_ports) != 1 or primary_ports[0].get("portId") != "main_geometry":
        raise ValueError(
            f"Process step template {template_id} must define one primary main_geometry input port"
        )
    if primary_ports[0].get("required", True) is not True:
        raise ValueError(
            f"Process step template {template_id} main_geometry input port must be required"
        )
    if set(output_ports) != {"result_geometry"}:
        raise ValueError(
            f"Process step template {template_id} must define exactly one result_geometry output port"
        )
    for port in [*input_ports.values(), *output_ports.values()]:
        if port.get("dataType") != "geometry":
            raise ValueError(f"Unsupported process step port dataType: {port.get('dataType')}")

    _validate_parameter_definitions(
        step_template.get("parameterDefinitions", []),
        f"ProcessStepTemplate {template_id}.parameterDefinitions",
    )


def _validate_parameter_definitions(parameters, label):
    parameter_ids = set()
    for parameter in parameters:
        parameter_id = parameter.get("id")
        if not isinstance(parameter_id, str) or not parameter_id.strip():
            raise ValueError("ParameterDefinition.id must be a non-empty string")
        if parameter_id in parameter_ids:
            raise ValueError(f"Duplicate parameter definition id: {parameter_id}")
        parameter_ids.add(parameter_id)
        validation = parameter.get("validation") or {}
        minimum = validation.get("min")
        maximum = validation.get("max")
        if minimum is not None and maximum is not None and minimum > maximum:
            raise ValueError(f"Parameter definition {parameter_id} has an invalid numeric range")
        min_length = validation.get("minLength")
        max_length = validation.get("maxLength")
        if min_length is not None and min_length < 0:
            raise ValueError(f"Parameter definition {parameter_id} minLength cannot be negative")
        if max_length is not None and max_length < 0:
            raise ValueError(f"Parameter definition {parameter_id} maxLength cannot be negative")
        if min_length is not None and max_length is not None and min_length > max_length:
            raise ValueError(f"Parameter definition {parameter_id} has an invalid length range")
        regex = validation.get("regex")
        if regex:
            try:
                re.compile(regex)
            except re.error as error:
                raise ValueError(
                    f"Parameter definition {parameter_id} has an invalid regex: {error}"
                ) from error
        if parameter.get("valueType") == "fieldGroupArray":
            repeat_definition = parameter.get("repeatDefinition")
            if not isinstance(repeat_definition, Mapping):
                raise ValueError(
                    f"Parameter definition {parameter_id} requires repeatDefinition"
                )
            min_items = repeat_definition.get("minItems")
            max_items = repeat_definition.get("maxItems")
            if min_items is not None and min_items < 0:
                raise ValueError(
                    f"Parameter definition {parameter_id} minItems cannot be negative"
                )
            if max_items is not None and max_items < 0:
                raise ValueError(
                    f"Parameter definition {parameter_id} maxItems cannot be negative"
                )
            if min_items is not None and max_items is not None and min_items > max_items:
                raise ValueError(
                    f"Parameter definition {parameter_id} has an invalid item range"
                )
            _validate_parameter_definitions(
                repeat_definition.get("itemParameterDefinitions", []),
                f"{label}.{parameter_id}.itemParameterDefinitions",
            )
        elif parameter.get("repeatDefinition") is not None:
            raise ValueError(
                f"Parameter definition {parameter_id} cannot define repeatDefinition"
            )


def _unique_items(items, id_key, label):
    result = {}
    for item in items:
        id_ = item.get(id_key)
        if not isinstance(id_, str) or not id_.strip():
            raise ValueError(f"{label}[] {id_key} must be a non-empty string")
        if id_ in result:
            raise ValueError(f"Duplicate {id_key}: {id_}")
        result[id_] = item
    return result


def _template_map(step_templates):
    if isinstance(step_templates, Mapping):
        return step_templates
    return {template.get("id"): template for template in step_templates}


def _assert_matching_data_type(source, target, edge_id):
    if source.get("dataType") != target.get("dataType"):
        raise ValueError(f"Flow edge dataType mismatch: {edge_id}")


def _topological_step_ref_ids(step_refs_by_id, edges):
    outgoing = {step_ref_id: [] for step_ref_id in step_refs_by_id}
    incoming_count = {step_ref_id: 0 for step_ref_id in step_refs_by_id}
    for source, target in edges:
        outgoing[source].append(target)
        incoming_count[target] += 1

    queue = [
        step_ref_id
        for step_ref_id in step_refs_by_id
        if incoming_count[step_ref_id] == 0
    ]
    ordered = []
    while queue:
        step_ref_id = queue.pop(0)
        ordered.append(step_ref_id)
        for target in outgoing[step_ref_id]:
            incoming_count[target] -= 1
            if incoming_count[target] == 0:
                queue.append(target)
    if len(ordered) != len(step_refs_by_id):
        raise ValueError("Process flow contains a cycle in stepOutput edges")
    return ordered
