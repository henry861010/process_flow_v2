"""Underfill display policy uses actual retained UF and bump geometry."""

from process_flow_schematic import SchematicContext, SchematicPart, base_material, slab

from .._schematic_helpers import has_bumps


_SUPPORT_KEYS = {"carrier", "carrier.panel", "carrier.wafer", "frame"}


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    label = "UF · " + base_material(context.node.get("material", "Underfill"))
    parts = [slab(label, "#efc490")] if has_bumps(context.container) else []

    # Gap bodies are placed in an unkeyed child scope by Under Fill. Find its
    # nearest assembly scope; only bump-containing components participate.
    eligible = ()
    for scope in reversed(context.ancestors):
        eligible = context.query((__name__, "participants", id(scope)), lambda: tuple(
            node["id"] for node in scope.get("children", ())
            if node.get("key") not in _SUPPORT_KEYS and has_bumps(node)))
        if eligible:
            break
    if not eligible and has_bumps(context.container):
        eligible = (context.container["id"],)
    if eligible:
        parts.append(SchematicPart(label=label, fill="#efc490", layout="bridges",
                                    eligible_container_ids=eligible))
    return parts
