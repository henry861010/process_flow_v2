"""LSI semantics; representative placement belongs to the schematic kernel."""

from process_flow_schematic import ADHESIVE_FILL, ComponentHint, SchematicContext, SchematicPart, slab


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    return [SchematicPart(label="LSI", component=ComponentHint(label="LSI", role="lsi", diagram_label="LSI"))]


def present_adhesive(context: SchematicContext) -> list[SchematicPart]:
    label = str(context.node.get("key") or context.node.get("material", ""))
    return [slab(label, ADHESIVE_FILL)]
