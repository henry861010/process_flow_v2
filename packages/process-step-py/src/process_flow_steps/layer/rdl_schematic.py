"""Representative RDL symbols owned by the process, independent of density."""

from math import isclose
from random import Random

from process_flow_schematic import (
    CONDUCTOR_FILL, MATRIX_FILL, Primitive, SchematicContext, SchematicPart,
    base_material, geometry_bounds, slab,
)


_TRACK_COUNT = 9
_VIA_HALF_WIDTH = 0.016


def _via_centers(row):
    """Stable illustrative jitter; no identity, density or physical XY seed."""
    centers = []
    for index in range(_TRACK_COUNT):
        track = Random(f"rdl-track-{index}")
        center = (index + 0.5) / _TRACK_COUNT + track.uniform(-0.003, 0.003)
        offset = track.uniform(0.024, 0.027) * track.choice((-1, 1))
        jitter = Random(f"rdl-row-{row}-track-{index}").uniform(-0.0015, 0.0015)
        centers.append(center + offset * (-1 if row % 2 else 1) + jitter)
    return tuple(centers)


def _segments(first, second):
    return tuple((min(a, b) - _VIA_HALF_WIDTH, max(a, b) + _VIA_HALF_WIDTH)
                 for a, b in zip(first, second))


def _build_routes(container):
    vias, circuits = [], []
    for collection, target in (("vias", vias), ("circuits", circuits)):
        for node in container.get(collection, ()):
            bounds = geometry_bounds(node.get("geometry", {}))
            if bounds is not None and bounds.thickness > 0:
                target.append((node, bounds))

    def footprint(bounds):
        return bounds.x_min, bounds.y_min, bounds.x_max, bounds.y_max

    # Only actual, unambiguous contacts link routes. Detached stacks and other
    # footprints must not change the random pattern of an existing chain.
    contacts = {}
    neighbors = {id(node): set() for node, _ in vias}
    for circuit, bounds in circuits:
        below, above = [], []
        for via, via_bounds in vias:
            if footprint(via_bounds) != footprint(bounds):
                continue
            if isclose(via_bounds.z_max, bounds.z_min, rel_tol=0, abs_tol=1e-7):
                below.append(id(via))
            if isclose(via_bounds.z_min, bounds.z_max, rel_tol=0, abs_tol=1e-7):
                above.append(id(via))
        contacts[id(circuit)] = (below, above)
        if len(below) == len(above) == 1:
            neighbors[below[0]].add(above[0])
            neighbors[above[0]].add(below[0])

    by_id = {id(node): (node, bounds) for node, bounds in vias}
    rows, via_positions = {}, {}
    remaining = set(by_id)
    for node, _ in vias:
        if id(node) not in remaining:
            continue
        component, pending = set(), [id(node)]
        while pending:
            current = pending.pop()
            if current in component:
                continue
            component.add(current)
            pending.extend(neighbors[current] - component)
        remaining.difference_update(component)
        # Etch order reverses with Z on flip, retaining each physical via's X.
        ordered = sorted(component, key=lambda key: by_id[key][1].z_min,
                         reverse=node.get("direction") == "+z")
        for row, key in enumerate(ordered):
            rows[key] = row
            via_positions[key] = _via_centers(row)

    circuit_segments = {}
    for circuit, _ in circuits:
        below, above = contacts[id(circuit)]
        if len(below) == len(above) == 1:
            first, second = via_positions[below[0]], via_positions[above[0]]
        elif len(below) + len(above) == 1:
            key = (below or above)[0]
            first, second = via_positions[key], _via_centers(rows[key] + 1)
        else:
            first, second = _via_centers(0), _via_centers(1)
        circuit_segments[id(circuit)] = _segments(first, second)
    return via_positions, circuit_segments


def _routes(context):
    return context.query(("rdl-routes", id(context.container)), lambda: _build_routes(context.container))


def present_schematic(context: SchematicContext) -> list[SchematicPart]:
    return [slab("RDL · " + base_material(context.node.get("material", "Dielectric")), MATRIX_FILL)]


def present_via(context: SchematicContext) -> list[SchematicPart]:
    centers = _routes(context)[0].get(id(context.node)) or _via_centers(0)
    # Only vias occupying an RDL dielectric layer use the etched taper.
    # TMV and other component vias are illustrated as straight pillars.
    is_rdl = any(body.get("key") == "rdl"
                 and geometry_bounds(body.get("geometry", {})) == context.bounds
                 for body in context.container.get("bodies", ()))
    if not is_rdl:
        primitives = tuple(
            Primitive(kind="rect", x=x - _VIA_HALF_WIDTH, y=0,
                      width=2 * _VIA_HALF_WIDTH, height=1,
                      fill=CONDUCTOR_FILL, stroke="none")
            for x in centers
        )
        return [SchematicPart(label="Via · " + base_material(context.node.get("material", "Conductor")),
                              fill=CONDUCTOR_FILL, primitives=primitives)]
    # Local y=0 is the upper Z boundary. Etching narrows in the via's
    # direction; the kernel reverses that direction when the structure flips.
    top, bottom = (0.008, 0.016) if context.node.get("direction") == "+z" else (0.016, 0.008)
    primitives = tuple(
        Primitive(kind="path", points=((x - top, 0), (x + top, 0),
                                       (x + bottom, 1), (x - bottom, 1)),
                  closed=True, fill=CONDUCTOR_FILL, stroke="none")
        for x in centers
    )
    return [SchematicPart(label="Via · " + base_material(context.node.get("material", "Conductor")),
                          fill=CONDUCTOR_FILL, primitives=primitives)]


def present_circuit(context: SchematicContext) -> list[SchematicPart]:
    # Each rectangle connects opposite ends to its upper and lower via rows.
    # A terminal circuit uses a virtual opposite end to retain its wider shape.
    segments = _routes(context)[1].get(id(context.node)) or _segments(_via_centers(0), _via_centers(1))
    primitives = tuple(
        Primitive(kind="rect", x=left, y=0, width=right - left, height=1,
                  fill=CONDUCTOR_FILL, stroke="none")
        for left, right in segments
    )
    return [SchematicPart(label="Circuit · " + base_material(context.node.get("material", "Conductor")),
                          fill=CONDUCTOR_FILL, primitives=primitives)]
