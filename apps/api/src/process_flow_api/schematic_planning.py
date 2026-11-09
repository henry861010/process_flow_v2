"""Resource adapters for the schematic kernel; no process layout rules."""
from __future__ import annotations

import hashlib
import json

from process_flow_kernel import GeometryArtifact

from process_flow_schematic.flow import FlowNode, FlowSource, FlowSchematicPlan, bind_flow_snapshots, plan_flow
from process_flow_schematic.scene import SCENE_VERSION
from process_flow_schematic.scene_layout import SCENE_LAYOUT_POLICY_VERSION
from process_flow_steps.schematic_layout import (
    SCHEMATIC_DESCRIPTOR_VERSION, SchematicDescriptorContext,
    SchematicDescriptorRegistry, register_descriptors,
)

from .schematic_builder import SCHEMATIC_PRESENTATION_VERSION, schematic_registry
from .services import preview_compiler, preview_request_identity, resolve_preview_flow_input, validate_preview_step


def schematic_layout_fingerprint(context):
    identity = preview_request_identity(context)
    identity.pop("target", None)
    identity.pop("sourceLabel", None)
    definition = dict(identity["definition"])
    definition["stepRefs"] = sorted(
        ({key: value for key, value in ref.items() if key != "stepLabel"} for ref in definition.get("stepRefs", [])),
        key=lambda ref: ref["stepRefId"],
    )
    definition["flowEdges"] = sorted(definition.get("flowEdges", []), key=lambda edge: edge["edgeId"])
    definition["flowInputs"] = sorted(
        ({key: value for key, value in item.items() if key != "name"}
         for item in definition.get("flowInputs", [])), key=lambda item: item["flowInputId"])
    identity["definition"] = definition
    identity["stepTemplates"] = sorted(identity["stepTemplates"], key=lambda item: item["id"])
    return hashlib.sha256(json.dumps(
        [SCENE_VERSION, SCHEMATIC_DESCRIPTOR_VERSION, SCENE_LAYOUT_POLICY_VERSION,
         SCHEMATIC_PRESENTATION_VERSION, identity],
        sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode()).hexdigest()[:24]


def plan_flow_schematic(context, generators, *, resolved_inputs=None) -> FlowSchematicPlan:
    compiler = preview_compiler(context, generators)
    templates = {template["id"]: template for template in context.step_templates}
    templates_by_ref = {ref["stepRefId"]: templates.get(ref["processStepTemplateId"], {})
                        for ref in context.definition.get("stepRefs", [])}
    incoming = {}
    for edge in context.definition.get("flowEdges", []):
        source = edge["source"]
        incoming.setdefault(edge["target"]["stepRefId"], []).append((
            edge["target"]["inputPortId"],
            FlowSource(source["kind"], source.get("flowInputId", source.get("stepRefId")),
                       source.get("outputPortId", "result_geometry") if source["kind"] == "stepOutput" else None),
        ))
    nodes = tuple(FlowNode(ref["stepRefId"], templates.get(ref["processStepTemplateId"], {}).get("program", ""),
                           tuple(incoming.get(ref["stepRefId"], ())))
                  for ref in context.definition.get("stepRefs", []))
    descriptors = SchematicDescriptorRegistry()
    register_descriptors(descriptors)

    artifacts = {}
    def resolve_input(input_id):
        value = (resolved_inputs[input_id] if resolved_inputs is not None and input_id in resolved_inputs
                 else resolve_preview_flow_input(context, generators, input_id, compiler=compiler, as_artifact=True))
        artifacts[input_id] = value if isinstance(value, GeometryArtifact) else GeometryArtifact.from_structure(value)
        return artifacts[input_id].structure

    def parameters(step_id):
        validate_preview_step(context, generators, step_id, compiler=compiler)
        configuration = context.configuration.get("stepConfigurations", {}).get(step_id, {})
        recipe = next(recipe for recipe in configuration.get("recipeCandidates", ())
                      if recipe["recipeId"] == configuration.get("selectedRecipeId"))
        return compiler.normalize_step_parameters(templates_by_ref[step_id], recipe.get("parameterValues", {}))

    def describe(node, values, sources):
        return descriptors.describe(SchematicDescriptorContext(node.id, node.program, values, sources))

    return plan_flow(nodes, fingerprint=schematic_layout_fingerprint(context), registry=schematic_registry(),
                     resolve_input=resolve_input, resolve_parameters=parameters, describe=describe,
                     resolve_polygon_lookup=lambda input_id: artifacts[input_id].polygons.get,
                     active_ports=lambda node, values: descriptors.input_ports(node.program, values, tuple(port for port, _ in node.inputs)))


def bind_schematic_snapshots(planning, prepared, snapshots):
    inputs = (prepared.execution_plan.external_geometries if prepared.execution_plan is not None else {})
    return bind_flow_snapshots(planning, snapshots,
                              input_structures={key: value.structure for key, value in inputs.items()},
                              input_cursors={key: value.runtime_snapshot.cursor_z for key, value in inputs.items()
                                             if value.runtime_snapshot is not None})
