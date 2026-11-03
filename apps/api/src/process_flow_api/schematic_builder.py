"""Presentation composition root; never imported by kernel execution modules."""

from __future__ import annotations

from typing import Any, Mapping

from process_flow_geometry_generators.schematic_presenters import (
    register_presenters as register_generator_presenters,
)
from process_flow_schematic import SCHEMATIC_VERSION, SchematicLayoutPlan, SchematicRegistry, compose_schematic
from process_flow_steps.schematic_presenters import (
    register_presenters as register_step_presenters,
)


# Bump the registry version when enabled presenters or their semantics change.
# Geometry hashes intentionally remain independent of presentation versions.
SCHEMATIC_REGISTRY_VERSION = 18
SCHEMATIC_PRESENTATION_VERSION = f"{SCHEMATIC_VERSION}:{SCHEMATIC_REGISTRY_VERSION}"


def schematic_registry() -> SchematicRegistry:
    registry = SchematicRegistry()
    register_generator_presenters(registry)
    register_step_presenters(registry)
    return registry


def build_schematic(
    geometry_structure: dict[str, Any],
    *,
    layout_plan: SchematicLayoutPlan | None = None,
    component_bindings: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    return compose_schematic(geometry_structure, schematic_registry(),
                             layout_plan=layout_plan, component_bindings=component_bindings)
