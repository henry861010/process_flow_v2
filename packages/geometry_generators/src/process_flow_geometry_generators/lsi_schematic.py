"""Representative placement owned by the LSI generator."""

from process_flow_schematic import ADHESIVE_FILL, ComponentHint, SchematicContext, SchematicPart, slab


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    return [SchematicPart(label="LSI", component=ComponentHint(label="LSI", representative_count=3))]


def present_adhesive(context: SchematicContext) -> list[SchematicPart]:
    label = str(context.node.get("key") or context.node.get("material", ""))
    return [slab(label, ADHESIVE_FILL)]
