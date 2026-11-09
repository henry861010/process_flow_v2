"""External polygon boundary: canonicalize before assigning derived structure IDs."""
from .immutable import thaw
from .schema import normalize_geometry_structure
from ..utils.polygon import PolygonSnapshot


def polygon_features(root, path="structure.root"):
    for collection in ("bodies", "vias", "circuits", "bumps"):
        for index, feature in enumerate(root.get(collection, ())):
            if feature.get("geometry", {}).get("type") == "PolygonGeometry":
                yield feature, f"{path}.{collection}[{index}].geometry.polys"
    for index, child in enumerate(root.get("children", ())):
        yield from polygon_features(child, f"{path}.children[{index}]")


def parse_polygon_structure(payload):
    copied = thaw(payload)
    root = copied.get("root", copied)
    parsed = []
    for feature, path in polygon_features(root):
        try:
            data = PolygonSnapshot.from_external(feature["geometry"]["polys"])
        except (ValueError, TypeError, KeyError) as error:
            raise ValueError(f"{path}: {error}") from error
        feature["geometry"]["polys"] = data.coordinates()
        parsed.append(data)
    structure = normalize_geometry_structure(copied)
    # The ID-indexed runtime payload must never silently replace another node.
    from ..domain.process_geometry_state import _validate_structure_ids
    _validate_structure_ids(structure["root"])
    polygons = {feature["id"]: data for (feature, _), data in
                zip(polygon_features(structure["root"]), parsed, strict=True)}
    return structure, polygons
