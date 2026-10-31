"""Explicit opt-in registration; normal step execution never imports this module."""

from process_flow_schematic import SchematicRegistry

from .bump.schematic import present_schematic as present_bump
from .layer.rdl_schematic import present_circuit, present_schematic as present_rdl, present_via
from .uf.schematic import present_schematic as present_underfill


def register_presenters(registry: SchematicRegistry) -> None:
    registry.register("body", present_rdl, key="rdl")
    registry.register("body", present_underfill, key="uf")
    registry.register("via", present_via)
    registry.register("circuit", present_circuit)
    registry.register("bump", present_bump)
