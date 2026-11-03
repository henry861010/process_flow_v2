"""Presentation composition root; never imported by kernel execution modules."""

from __future__ import annotations

from typing import Any

from process_flow_geometry_generators.schematic_presenters import (
    register_presenters as register_generator_presenters,
)
from process_flow_schematic import SCHEMATIC_VERSION, SchematicRegistry, compose_schematic
from process_flow_steps.schematic_presenters import (
    register_presenters as register_step_presenters,
)


# Bump the registry version when enabled presenters or their semantics change.
# Geometry hashes intentionally remain independent of presentation versions.
SCHEMATIC_REGISTRY_VERSION = 12
SCHEMATIC_PRESENTATION_VERSION = f"{SCHEMATIC_VERSION}:{SCHEMATIC_REGISTRY_VERSION}"


def build_schematic(geometry_structure: dict[str, Any]) -> dict[str, Any]:
    registry = SchematicRegistry()
    register_generator_presenters(registry)
    register_step_presenters(registry)
    return compose_schematic(geometry_structure, registry)
