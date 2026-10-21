"""Project immutable station recipes into one executable configuration."""
from __future__ import annotations

from copy import deepcopy
from collections.abc import Mapping

from .flow_dependencies import analyze_flow_dependencies
from .flow_validation import analyze_flow_graph


def instance_flow_configuration(instance: Mapping) -> dict:
    configurations = {}
    for step_id, station in instance.get("stepConfigurations", {}).items():
        active = station.get("activeRecipeId")
        recipe = next((item for item in station.get("recipes", []) if item["id"] == active), None)
        if active is not None and recipe is None:
            raise ValueError(f"Step {step_id} active recipe not found: {active}")
        if recipe is not None:
            configurations[step_id] = {"parameterValues": deepcopy(recipe["parameterValues"])}
    return {
        "inputBindings": deepcopy(instance.get("inputBindings", {})),
        "stepConfigurations": configurations,
        "embeddedGeometries": {},
    }


def resolve_instance_configuration(instance: Mapping, template: Mapping, step_templates,
                                   *, output_step_ref_id: str | None = None) -> dict:
    configuration = instance_flow_configuration(instance)
    analysis = analyze_flow_graph(template, step_templates)
    unknown = set(instance.get("stepConfigurations", {})) - set(analysis.step_refs_by_id)
    if unknown:
        raise ValueError(f"Unknown instance station: {sorted(unknown)[0]}")
    roots = {output_step_ref_id} if output_step_ref_id is not None else None
    dependencies = analyze_flow_dependencies(analysis, configuration, roots)
    for step_id in sorted(dependencies.step_ref_ids):
        if step_id not in configuration["stepConfigurations"]:
            raise ValueError(f"Step {step_id} has no active recipe")
    return configuration
