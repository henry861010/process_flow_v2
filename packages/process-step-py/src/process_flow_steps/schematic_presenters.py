"""Explicit opt-in registration; normal step execution never imports this module."""

from process_flow_schematic import SchematicRegistry

from .joint.schematic import present_schematic as present_joint
from .layer.rdl_schematic import present_circuit, present_schematic as present_rdl, present_via
from .pnp.schematic import present_schematic as present_pnp
from .uf.schematic import present_schematic as present_underfill


def _present_bump(context):
    if context.node.get("stage") == "joined":
        return present_joint(context)
    if context.node.get("stage") == "reflowed":
        return present_pnp(context)
    return []


def register_presenters(registry: SchematicRegistry) -> None:
    registry.register("body", present_rdl, key="rdl")
    registry.register("body", present_underfill, key="uf")
    registry.register("via", present_via)
    registry.register("circuit", present_circuit)
    registry.register("bump", _present_bump)
