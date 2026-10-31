"""Representative placement owned by the wafer dummy generator."""

from process_flow_schematic import ComponentHint, SchematicContext, SchematicPart


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    return [SchematicPart(label="Wafer DMY", component=ComponentHint(
        label="Wafer DMY", representative_count=2, placement="edges"))]
