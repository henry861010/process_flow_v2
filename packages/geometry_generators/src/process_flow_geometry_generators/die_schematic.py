"""Single representative components retain their complete snapshot subtrees."""

from process_flow_schematic import (
    COMPONENT_MATRIX_FILL, ComponentHint, SchematicContext, SchematicPart,
    material_color, slab,
)


_LABELS = {"dram": "DRAM", "soc": "SoC", "soic": "SoIC", "hbm": "HBM", "vrm": "VRM", "cpo": "CPO"}


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    label = _LABELS.get(context.node.get("key"), "Die")
    return [SchematicPart(label=label, component=ComponentHint(
        label=label, role=str(context.node.get("key") or "die"),
        diagram_label=label if context.node.get("key") in ("soc", "hbm", "vrm") else None))]


def present_internal_matrix(context: SchematicContext) -> list[SchematicPart]:
    """Separate component insulation and encapsulation from process molding."""
    material = str(context.node.get("material", ""))
    label = str(context.node.get("key") or material)
    # The generic envelope role is also used outside HBM packages.
    fill = (material_color(material)
            if context.node.get("key") == "envelope" and context.container.get("key") != "hbm"
            else COMPONENT_MATRIX_FILL)
    return [slab(label, fill)]
