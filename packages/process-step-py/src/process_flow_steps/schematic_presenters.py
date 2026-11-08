"""Explicit opt-in registration; normal step execution never imports this module."""

from process_flow_schematic import ADHESIVE_FILL, ComponentHint, SchematicPart, SchematicRegistry, base_material, slab

from .joint.schematic import present_schematic as present_joint
from .layer.rdl_schematic import present_circuit, present_schematic as present_rdl, present_via
from .pnp.schematic import present_schematic as present_pnp
from .uf.schematic import present_schematic as present_underfill


def _present_adhesive(context):
    return [slab(base_material(context.node.get("material", "Adhesive")), ADHESIVE_FILL)]


def _present_bump(context):
    if context.node.get("stage") == "joined":
        return present_joint(context)
    if context.node.get("stage") == "reflowed":
        return present_pnp(context)
    return []


def _present_coating_target(context):
    role = context.node["key"]
    label = "CoW" if role == "cow" else "Lid"
    return [SchematicPart(label, component=ComponentHint(
        label, role=role, diagram_label=label, nesting="arranged" if role == "cow" else "structural"))]


def register_presenters(registry: SchematicRegistry) -> None:
    for key in ("daf", "fow", "flow", "tim"):
        registry.register("body", _present_adhesive, key=key)
    for key in ("cow", "lid"):
        registry.register("container", _present_coating_target, key=key)
    registry.register("body", present_rdl, key="rdl")
    registry.register("body", present_underfill, key="uf")
    registry.register("via", present_via)
    registry.register("circuit", present_circuit)
    registry.register("bump", _present_bump)
