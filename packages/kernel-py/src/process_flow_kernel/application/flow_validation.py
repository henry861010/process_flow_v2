from __future__ import annotations

_MISSING = object()


def validate_flow_graph(process_flow_template, process_flow_instance, step_templates):
    step_templates_by_id = _template_map(step_templates)
    step_refs = process_flow_template.get("stepRefs", [])
    flow_edges = process_flow_template.get("flowEdges", [])
    step_ref_ids = []
    step_refs_by_id = {}

    for step_ref in step_refs:
        step_ref_id = step_ref.get("stepRefId")
        if not isinstance(step_ref_id, str) or step_ref_id.strip() == "":
            raise ValueError("ProcessFlowTemplate.stepRefs[] stepRefId must be a non-empty string")
        if step_ref_id in step_refs_by_id:
            raise ValueError(f"Duplicate stepRefId: {step_ref_id}")
        step_refs_by_id[step_ref_id] = step_ref
        step_ref_ids.append(step_ref_id)

        template_id = step_ref.get("processStepTemplateId")
        if template_id not in step_templates_by_id:
            raise ValueError(f"Process step template not found: {template_id}")

    if process_flow_instance.get("processFlowTemplateId") != process_flow_template.get("id"):
        raise ValueError("ProcessFlowInstance.processFlowTemplateId must match ProcessFlowTemplate.id")

    value_sets_by_ref = {}
    for value_set in process_flow_instance.get("stepValueSets", []):
        step_ref_id = value_set.get("stepRefId")
        if step_ref_id not in step_refs_by_id:
            raise ValueError(f"StepValueSet stepRefId does not exist in flow template: {step_ref_id}")
        if step_ref_id in value_sets_by_ref:
            raise ValueError(f"Duplicate StepValueSet for stepRefId {step_ref_id}")
        value_sets_by_ref[step_ref_id] = value_set

        expected_template_id = step_refs_by_id[step_ref_id].get("processStepTemplateId")
        if value_set.get("processStepTemplateId") != expected_template_id:
            raise ValueError(
                f"StepValueSet {step_ref_id} processStepTemplateId must match stepRef"
            )

    for step_ref_id in step_ref_ids:
        if step_ref_id not in value_sets_by_ref:
            raise ValueError(f"Missing StepValueSet for stepRefId {step_ref_id}")

    geometry_fields_by_step = {}
    for step_ref_id, step_ref in step_refs_by_id.items():
        template = step_templates_by_id[step_ref["processStepTemplateId"]]
        fields = {
            field.get("id"): field
            for field in template.get("fieldDefinitions", [])
            if field.get("valueType") == "geometryRef"
        }
        geometry_fields_by_step[step_ref_id] = fields

    incoming_by_target = {}
    outgoing_step_output_counts = {}
    step_output_edges = []

    for edge in flow_edges:
        source_type = edge.get("source", {}).get("sourceType")
        if source_type not in ("geometryRef", "stepOutput"):
            raise ValueError(f"Unsupported flow edge sourceType: {source_type}")

        target = edge.get("target", {})
        target_step_ref_id = target.get("stepRefId")
        target_field_id = target.get("targetFieldId")
        if target_step_ref_id not in step_refs_by_id:
            raise ValueError(f"Flow edge target stepRefId not found: {target_step_ref_id}")
        target_fields = geometry_fields_by_step[target_step_ref_id]
        if target_field_id not in target_fields:
            raise ValueError(
                f"Flow edge target {target_step_ref_id}.{target_field_id} must be a geometryRef field"
            )

        target_key = (target_step_ref_id, target_field_id)
        if target_key in incoming_by_target:
            raise ValueError(
                f"Multiple incoming geometry edges for {target_step_ref_id}.{target_field_id}"
            )
        incoming_by_target[target_key] = edge

        value = _find_field_value(value_sets_by_ref[target_step_ref_id].get("fieldValues", []), target_field_id)
        if value is _MISSING:
            raise ValueError(f"Missing FieldValue for geometry field {target_step_ref_id}.{target_field_id}")

        if source_type == "geometryRef":
            if not isinstance(value, str) or value.strip() == "":
                raise ValueError(
                    f"{target_step_ref_id}.{target_field_id} must contain a geometry entity id string"
                )
            continue

        source_step_ref_id = edge.get("source", {}).get("stepRefId")
        if source_step_ref_id not in step_refs_by_id:
            raise ValueError(f"Flow edge source stepRefId not found: {source_step_ref_id}")
        if source_step_ref_id == target_step_ref_id:
            raise ValueError(f"Step output edge cannot target the same step: {source_step_ref_id}")
        if value is not None:
            raise ValueError(
                f"{target_step_ref_id}.{target_field_id} must be null for stepOutput source"
            )
        outgoing_step_output_counts[source_step_ref_id] = outgoing_step_output_counts.get(source_step_ref_id, 0) + 1
        if outgoing_step_output_counts[source_step_ref_id] > 1:
            raise ValueError(f"Step output fan-out is not allowed: {source_step_ref_id}")
        step_output_edges.append((source_step_ref_id, target_step_ref_id))

    for step_ref_id, fields in geometry_fields_by_step.items():
        for field_id in fields:
            if (step_ref_id, field_id) not in incoming_by_target:
                raise ValueError(f"Missing incoming geometry edge for {step_ref_id}.{field_id}")

    _assert_step_output_dag(step_ref_ids, step_output_edges)
    return None


def _template_map(step_templates):
    if isinstance(step_templates, dict):
        return step_templates
    return {template.get("id"): template for template in step_templates}


def _find_field_value(field_values, field_id):
    for field_value in field_values:
        if field_value.get("fieldId") == field_id:
            return field_value.get("value")
    return _MISSING


def _assert_step_output_dag(step_ref_ids, edges):
    outgoing = {step_ref_id: [] for step_ref_id in step_ref_ids}
    incoming_count = {step_ref_id: 0 for step_ref_id in step_ref_ids}
    for source, target in edges:
        outgoing[source].append(target)
        incoming_count[target] += 1

    queue = [step_ref_id for step_ref_id in step_ref_ids if incoming_count[step_ref_id] == 0]
    visited = []
    while queue:
        step_ref_id = queue.pop(0)
        visited.append(step_ref_id)
        for target in outgoing[step_ref_id]:
            incoming_count[target] -= 1
            if incoming_count[target] == 0:
                queue.append(target)

    if len(visited) != len(step_ref_ids):
        raise ValueError("Process flow contains a cycle in stepOutput edges")
