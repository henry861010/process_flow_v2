"""Read-only helpers for the process presenters' serialized snapshot input."""

from process_flow_kernel import BoxGeometry, ConeGeometry, CylinderGeometry, PolygonGeometry


def walk(container):
    yield container
    for child in container.get("children", ()):
        yield from walk(child)


def has_bumps(container):
    return any(node.get("bumps") for node in walk(container))


def polygon_data(context, node):
    from process_flow_kernel.domain.geometry import PolygonSnapshot
    def build():
        data = None if context.polygon_lookup is None else context.polygon_lookup(str(node.get("id", "")))
        return data if isinstance(data, PolygonSnapshot) else PolygonSnapshot.from_external(node["geometry"]["polys"])
    return context.query(("polygon-data", id(node)), build)


def footprint_geometry(payload, *, polygon=None):
    """Use the kernel's geometry semantics, including polygon holes."""
    kind = payload.get("type")
    thickness = payload.get("thk", payload.get("thickness", 0))
    if kind in ("BoxGeometry", "box"):
        return BoxGeometry(payload.get("bottom_left", payload.get("bottomLeft")),
                           payload.get("top_right", payload.get("topRight")), thickness)
    if kind in ("PolygonGeometry", "polygon"):
        return PolygonGeometry(polygon if polygon is not None else payload.get("polys", payload.get("polygons")), thickness)
    if kind in ("CylinderGeometry", "cylinder"):
        return CylinderGeometry(payload["center"], payload.get("bottom_radius", payload.get("bottomRadius")), thickness)
    if kind in ("ConeGeometry", "cone"):
        return ConeGeometry(payload["center"], payload.get("bottom_radius", payload.get("bottomRadius")),
                            payload.get("top_radius", payload.get("topRadius")), thickness)
    raise ValueError(f"Unsupported bump footprint: {kind}")
