"""Representative placement owned by the LSI generator."""

from process_flow_schematic import ComponentHint, SchematicContext, SchematicPart


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    return [SchematicPart(label="LSI", component=ComponentHint(label="LSI", representative_count=3))]
