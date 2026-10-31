"""Bump symbols and post-joint ownership belong to the bump process package."""

from math import isclose

from process_flow_kernel.domain.bump_operations import footprints_overlap
from process_flow_schematic import Primitive, SchematicContext, SchematicPart, base_material, geometry_bounds

from .._schematic_helpers import footprint_geometry, walk


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    if context.node.get("density", 0) <= 0:
        return []
    occluded_by = []
    if context.node.get("stage") == "reflowed":
        own_geometry = footprint_geometry(context.node["geometry"])
        for child in context.container.get("children", ()):
            for descendant in walk(child):
                for bump in descendant.get("bumps", ()):
                    if bump.get("stage") != "joined" or bump.get("density", 0) <= 0:
                        continue
                    bounds = geometry_bounds(bump.get("geometry", {}))
                    if bounds is None or not isclose(bounds.z_min, context.bounds.z_min, abs_tol=1e-7):
                        continue
                    if footprints_overlap(own_geometry, footprint_geometry(bump["geometry"])):
                        # A partial joint owns its footprint, not the entire die column.
                        occluded_by.append(bump["id"])
    return [SchematicPart(
        label="Bump · " + base_material(context.node.get("material", "Bump")),
        fill="#d9b85e",
        primitives=tuple(Primitive(kind="circle", cx=x, cy=0.5, r=0.42,
                                    fill="#d9b85e", stroke="#9a772e")
                         for x in (0.2, 0.5, 0.8)),
        occluded_by=tuple(dict.fromkeys(occluded_by)),
    )]
