"""Sparse RDL symbols owned by the RDL process, independent of execution."""

from process_flow_schematic import Primitive, SchematicContext, SchematicPart, base_material, slab


CONDUCTOR = "#f2cd3b"


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    return [slab("RDL · " + base_material(context.node.get("material", "Dielectric")), "#879c42")]


def present_via(context: SchematicContext) -> list[SchematicPart]:
    if context.node.get("density", 0) <= 0:
        return []
    primitives = []
    for x in (0.18, 0.5, 0.82):
        primitives.extend((
            Primitive(kind="rect", x=x - 0.012, y=0.12, width=0.024, height=0.76, fill=CONDUCTOR),
            Primitive(kind="rect", x=x - 0.045, y=0.06, width=0.09, height=0.13, fill=CONDUCTOR),
            Primitive(kind="rect", x=x - 0.045, y=0.81, width=0.09, height=0.13, fill=CONDUCTOR),
        ))
    return [SchematicPart(label="Via · " + base_material(context.node.get("material", "Conductor")),
                          fill=CONDUCTOR, primitives=tuple(primitives))]


def present_circuit(context: SchematicContext) -> list[SchematicPart]:
    if context.node.get("density", 0) <= 0:
        return []
    segments = ((0.05, 0.33, 0.32), (0.37, 0.67, 0.64),
                (0.7, 0.94, 0.32), (0.12, 0.36, 0.78))
    primitives = tuple(
        Primitive(kind="rect", x=start, y=y, width=end-start, height=0.12, fill=CONDUCTOR)
        for start, end, y in segments
    )
    return [SchematicPart(label="Circuit · " + base_material(context.node.get("material", "Conductor")),
                          fill=CONDUCTOR, primitives=primitives)]
