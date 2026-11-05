"""Joint owns schematic presentation of the joined bump features it produces."""

from math import pi, sin

from process_flow_schematic import (
    CONDUCTOR_FILL, CONDUCTOR_OUTLINE, OUTLINE, SOLDER_FILL,
    Primitive, SchematicContext, SchematicPart, base_material,
)


def _joined_bump():
    # A bulging solder body between two flat contacts, with heights 1:4:1.
    right_side = tuple((0.92 + 0.08 * sin(pi * index / 32), 1 / 6 + (2 / 3) * index / 32)
                       for index in range(33))
    left_side = tuple((1 - x, y) for x, y in reversed(right_side))
    solder = ((0.08, 1 / 6), *right_side, *left_side)
    top = ((0.08, 0.0), (0.92, 0.0), (0.92, 1 / 6), (0.08, 1 / 6))
    bottom = tuple((x, 1 - y) for x, y in top)
    return tuple(Primitive(kind="path", points=points, closed=True, repeat_x=True,
                           r=0.5, fill=fill, stroke=stroke)
                 for points, fill, stroke in (
                     (solder, SOLDER_FILL, OUTLINE),
                     (top, CONDUCTOR_FILL, CONDUCTOR_OUTLINE),
                     (bottom, CONDUCTOR_FILL, CONDUCTOR_OUTLINE)))


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    if context.node.get("stage") != "joined" or context.node.get("density", 0) <= 0:
        return []
    return [SchematicPart(
        label="Bump · " + base_material(context.node.get("material", "Bump")),
        fill=SOLDER_FILL, primitives=_joined_bump(),
    )]
