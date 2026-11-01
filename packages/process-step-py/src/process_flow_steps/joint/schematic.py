"""Joint owns schematic presentation of the joined bump features it produces."""

from process_flow_schematic import Primitive, SchematicContext, SchematicPart, base_material


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    if context.node.get("stage") != "joined" or context.node.get("density", 0) <= 0:
        return []
    return [SchematicPart(
        label="Bump · " + base_material(context.node.get("material", "Bump")),
        fill="#d9b85e",
        primitives=(Primitive(kind="circle", cy=0.5, r=0.42, repeat_x=True,
                              fill="#d9b85e", stroke="#9a772e"),),
    )]
