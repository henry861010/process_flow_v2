"""Carriers and frames remain stack layers rather than representative dies."""

from process_flow_schematic import CARRIER_FILL, Primitive, SchematicContext, SchematicPart, base_material


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    return []


def present_carrier(context: SchematicContext) -> list[SchematicPart]:
    return [SchematicPart(base_material(context.node.get("material", "Carrier")), CARRIER_FILL,
                          primitives=(Primitive(),), diagram_label="Carrier")]
