"""Single representative components retain their complete snapshot subtrees."""

from process_flow_schematic import ComponentHint, SchematicContext, SchematicPart


_LABELS = {"dram": "DRAM", "soc": "SoC", "soic": "SoIC", "hbm": "HBM", "vrm": "VRM", "cpo": "CPO"}


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    label = _LABELS.get(context.node.get("key"), "Die")
    return [SchematicPart(label=label, component=ComponentHint(label=label))]
