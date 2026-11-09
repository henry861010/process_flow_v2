"""Retained cavity slabs; layer climbs are supplied by the UF companion intent."""

from dataclasses import replace
from process_flow_schematic import SchematicContext, SchematicPart, UNDERFILL_FILL, base_material, slab


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    scope = context.container
    # A helper contains the physical gap polygon. Its XY topology is irrelevant
    # to the schematic; flow composition renders the process-owned layer fill.
    gap_helper = (context.ancestors and scope.get("key") is None and not scope.get("children")
            and not any(scope.get(name) for name in ("bumps", "vias", "circuits"))
            and all(body.get("key") == "uf" for body in scope.get("bodies", ())))
    if gap_helper and context.display_replaced:
        return []
    part = slab("UF · " + base_material(context.node.get("material", "Underfill")), UNDERFILL_FILL)
    return [replace(part, layout="span") if gap_helper else part]
