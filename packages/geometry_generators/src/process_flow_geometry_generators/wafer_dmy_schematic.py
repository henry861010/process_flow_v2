"""Wafer dummy semantics; the kernel owns the paired representation policy."""

from process_flow_schematic import ComponentHint, SchematicContext, SchematicPart


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    return [SchematicPart(label="Wafer DMY", component=ComponentHint(
        label="Wafer DMY", role="wafer-dmy", diagram_label="DMY"))]
