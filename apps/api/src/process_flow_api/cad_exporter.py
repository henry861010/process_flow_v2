from __future__ import annotations

import math
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from process_flow_kernel import classify_polygon_loops, normalize_geometry_structure, stable_id

JsonObject = dict[str, Any]

MATERIAL_COLOR_RULES = [
    (["cu", "copper", "metal", "rdl", "via"], "#d29b2a"),
    (["solder", "snag", "sac", "bga", "c4", "ubump", "bump"], "#d8dee2"),
    (["silicon", "si", "die", "logic", "hbm", "interposer"], "#7f8788"),
    (["bt", "abf", "substrate", "panel", "carrier"], "#2e7d5b"),
    (["dielectric", "polyimide", "pi", "photo", "pm", "underfill"], "#2aa6b8"),
    (["mold", "molding", "emc", "epoxy", "resin"], "#b9c0bd"),
    (["glass", "wafer"], "#94c9cf"),
]

MATERIAL_FALLBACK_COLORS = [
    "#8f9894",
    "#7b72b8",
    "#bc5f58",
    "#3b82a0",
    "#8a9741",
    "#b77935",
    "#5d8f73",
    "#a15786",
]


class CadExportError(RuntimeError):
    pass


@dataclass(frozen=True)
class CadExportOptions:
    include_feature_bodies: bool = False
    volume_tolerance: float = 1e-6
    linear_deflection: float = 0.1
    angular_deflection: float = 0.1
    step_schema: str = "AP242"


@dataclass
class CadBody:
    id: str
    source_ids: list[str]
    container_id: str
    container_key: str
    material: str
    shape: Any
    body_kind: Literal["body", "feature"] = "body"
    feature_type: str | None = None
    density: Any = None


@dataclass
class CadExportResult:
    files: dict[str, bytes]
    bodies: list[CadBody]


def export_cad_bytes(
    geometry_structure: JsonObject,
    *,
    format: Literal["glb", "step"],
) -> bytes:
    normalized_format = _normalize_format(format)
    converter = CadQueryConverter(
        CadExportOptions(include_feature_bodies=normalized_format == "step")
    )
    result = converter.convert(geometry_structure, formats=[normalized_format])
    return result.files[normalized_format]


def convert_cad_bodies(
    geometry_structure: JsonObject,
    *,
    include_feature_bodies: bool = False,
) -> list[CadBody]:
    converter = CadQueryConverter(
        CadExportOptions(include_feature_bodies=include_feature_bodies)
    )
    return converter.convert_bodies(geometry_structure)


class CadQueryConverter:
    def __init__(self, options: CadExportOptions | None = None):
        self.options = options or CadExportOptions()
        self.cq = _load_cadquery()

    def convert(
        self,
        payload: JsonObject,
        *,
        formats: list[Literal["glb", "step"]] | None = None,
    ) -> CadExportResult:
        requested_formats = formats or ["step", "glb"]
        structure = normalize_geometry_structure(payload)
        bodies = self._convert_container(structure["root"])
        visible_bodies = [
            body
            for body in bodies
            if not self._is_empty_shape(body.shape)
            and self._shape_volume(body.shape) > self.options.volume_tolerance
        ]
        if not visible_bodies:
            raise CadExportError("Geometry export produced no visible CAD bodies.")

        files = {}
        for export_format in requested_formats:
            normalized_format = _normalize_format(export_format)
            files[normalized_format] = self._export_bodies(
                visible_bodies,
                normalized_format,
                structure,
            )
        return CadExportResult(files=files, bodies=bodies)

    def convert_bodies(self, payload: JsonObject) -> list[CadBody]:
        structure = normalize_geometry_structure(payload)
        return self._convert_container(structure["root"])

    def _convert_container(self, container: JsonObject) -> list[CadBody]:
        direct_bodies = [self._body_to_cad(container, body) for body in container["bodies"]]
        direct_feature_bodies = (
            self._container_features_to_cad(container)
            if self.options.include_feature_bodies
            else []
        )

        direct_feature_bodies = self._resolve_sibling_bodies(container, direct_feature_bodies)
        feature_cut_tool = self._union_shapes([body.shape for body in direct_feature_bodies])
        if feature_cut_tool is not None:
            for body in direct_bodies:
                body.shape = self._subtract_tool(body.shape, feature_cut_tool)

        direct_bodies = self._resolve_sibling_bodies(container, direct_bodies)
        direct_solids = [*direct_bodies, *direct_feature_bodies]

        descendant_bodies = []
        for child in container["children"]:
            descendant_bodies.extend(self._convert_container(child))

        cut_tool = self._union_shapes([body.shape for body in descendant_bodies])
        if cut_tool is not None:
            for body in direct_solids:
                body.shape = self._subtract_tool(body.shape, cut_tool)

        return [*direct_solids, *descendant_bodies]

    def _body_to_cad(self, container: JsonObject, body: JsonObject) -> CadBody:
        return CadBody(
            id=body["id"],
            source_ids=[body["id"]],
            container_id=container["id"],
            container_key=container.get("key") or "",
            material=body.get("material") or "generic",
            shape=self._geometry_to_shape(body["geometry"]),
        )

    def _container_features_to_cad(self, container: JsonObject) -> list[CadBody]:
        return [
            *[self._feature_to_cad(container, "via", feature) for feature in container["vias"]],
            *[
                self._feature_to_cad(container, "circuit", feature)
                for feature in container["circuits"]
            ],
            *[self._feature_to_cad(container, "bump", feature) for feature in container["bumps"]],
        ]

    def _feature_to_cad(
        self,
        container: JsonObject,
        feature_type: str,
        feature: JsonObject,
    ) -> CadBody:
        return CadBody(
            id=stable_id("feature-body", [container["id"], feature_type, feature["id"]]),
            source_ids=[feature["id"]],
            container_id=container["id"],
            container_key=container.get("key") or "",
            material=feature_material_name(feature_type, feature.get("material"), feature.get("density")),
            shape=self._geometry_to_shape(feature["geometry"]),
            body_kind="feature",
            feature_type=feature_type,
            density=feature.get("density"),
        )

    def _resolve_sibling_bodies(
        self,
        container: JsonObject,
        bodies: list[CadBody],
    ) -> list[CadBody]:
        if len(bodies) <= 1:
            return bodies

        self._raise_on_cross_material_overlap(bodies)
        components = self._same_material_overlap_components(bodies)
        resolved = []
        for component in components:
            if len(component) == 1:
                resolved.append(component[0])
                continue

            material = component[0].material
            source_ids = [source_id for body in component for source_id in body.source_ids]
            fused_shape = self._union_shapes([body.shape for body in component])
            resolved.append(
                CadBody(
                    id=stable_id("body-union", [container["id"], material], {"sourceIds": source_ids}),
                    source_ids=source_ids,
                    container_id=container["id"],
                    container_key=container.get("key") or "",
                    material=material,
                    shape=fused_shape,
                )
            )
        return resolved

    def _raise_on_cross_material_overlap(self, bodies: list[CadBody]) -> None:
        for left_index, left in enumerate(bodies):
            for right in bodies[left_index + 1 :]:
                if left.material == right.material:
                    continue
                if self._has_overlap(left.shape, right.shape):
                    raise CadExportError(
                        "Overlapping sibling bodies with different materials: "
                        f"{left.id} ({left.material}) and {right.id} ({right.material})"
                    )

    def _same_material_overlap_components(self, bodies: list[CadBody]) -> list[list[CadBody]]:
        remaining = list(bodies)
        components = []
        while remaining:
            seed = remaining.pop(0)
            component = [seed]
            changed = True
            while changed:
                changed = False
                for candidate in list(remaining):
                    if candidate.material != seed.material:
                        continue
                    if any(self._has_overlap(candidate.shape, body.shape) for body in component):
                        remaining.remove(candidate)
                        component.append(candidate)
                        changed = True
            components.append(component)
        return components

    def _geometry_to_shape(self, geometry: JsonObject):
        if not isinstance(geometry, dict):
            raise CadExportError(f"Unknown geometry payload: {geometry!r}")

        geometry_type = geometry.get("type")
        if geometry_type == "BoxGeometry":
            _require_geometry_fields(geometry, ["bottom_left", "top_right", "thk"])
            return self._box_to_shape(geometry)
        if geometry_type == "CylinderGeometry":
            _require_geometry_fields(geometry, ["center", "bottom_radius", "thk"])
            return self._cylinder_to_shape(geometry)
        if geometry_type == "ConeGeometry":
            _require_geometry_fields(geometry, ["center", "bottom_radius", "top_radius", "thk"])
            return self._cone_to_shape(geometry)
        if geometry_type == "PolygonGeometry":
            _require_geometry_fields(geometry, ["polys", "thk"])
            return self._polygons_to_shape(geometry)
        raise CadExportError(f"Unknown geometry type: {geometry_type}")

    def _box_to_shape(self, geometry: JsonObject):
        x1, y1, z1 = geometry["bottom_left"]
        x2, y2, z2 = geometry["top_right"]
        if z1 != z2:
            raise CadExportError("BoxGeometry bottom_left and top_right must share the same Z.")
        x_min, x_max = sorted([float(x1), float(x2)])
        y_min, y_max = sorted([float(y1), float(y2)])
        thickness = _positive_number(geometry["thk"], "BoxGeometry.thk")
        if x_min == x_max or y_min == y_max:
            raise CadExportError("BoxGeometry footprint must be non-empty.")
        return (
            self.cq.Workplane("XY")
            .box(x_max - x_min, y_max - y_min, thickness, centered=(False, False, False))
            .translate((x_min, y_min, float(z1)))
            .val()
        )

    def _cylinder_to_shape(self, geometry: JsonObject):
        center = geometry["center"]
        radius = _positive_number(geometry["bottom_radius"], "CylinderGeometry.bottom_radius")
        thickness = _positive_number(geometry["thk"], "CylinderGeometry.thk")
        return self.cq.Solid.makeCylinder(
            radius,
            thickness,
            pnt=self.cq.Vector(center[0], center[1], center[2]),
            dir=self.cq.Vector(0, 0, 1),
        )

    def _cone_to_shape(self, geometry: JsonObject):
        center = geometry["center"]
        bottom_radius = _positive_number(geometry["bottom_radius"], "ConeGeometry.bottom_radius")
        top_radius = _non_negative_number(geometry["top_radius"], "ConeGeometry.top_radius")
        thickness = _positive_number(geometry["thk"], "ConeGeometry.thk")
        return self.cq.Solid.makeCone(
            bottom_radius,
            top_radius,
            thickness,
            pnt=self.cq.Vector(center[0], center[1], center[2]),
            dir=self.cq.Vector(0, 0, 1),
        )

    def _polygons_to_shape(self, geometry: JsonObject):
        thickness = _positive_number(geometry["thk"], "PolygonGeometry.thk")
        shapes = []
        for region in classify_polygon_loops(geometry["polys"]):
            shape = self._loop_to_prism(region.outer, thickness, region.z)
            for hole in region.holes:
                shape = self._cut(shape, self._loop_to_prism(hole, thickness, region.z))
            shapes.append(shape)
        return self._union_shapes(shapes)

    def _loop_to_prism(self, loop: list[list[float]], height: float, z: float):
        points = [(point[0], point[1]) for point in loop]
        return (
            self.cq.Workplane("XY")
            .polyline(points)
            .close()
            .extrude(height)
            .translate((0, 0, z))
            .val()
        )

    def _export_bodies(
        self,
        bodies: list[CadBody],
        export_format: Literal["glb", "step"],
        structure: JsonObject,
    ) -> bytes:
        assembly = self._assembly_from_bodies(bodies)
        with tempfile.TemporaryDirectory(prefix="process-flow-cad-export-") as tmp:
            suffix = ".glb" if export_format == "glb" else ".step"
            output_path = Path(tmp) / f"preview{suffix}"
            if export_format == "step":
                self._set_step_options(structure.get("unitSystem", "um"))
                assembly.export(str(output_path), "STEP", unit=self._step_unit(structure.get("unitSystem", "um")))
            elif export_format == "glb":
                self._export_glb_z_up(assembly, output_path)
            else:
                raise CadExportError(f"Unsupported CAD export format: {export_format}")
            return output_path.read_bytes()

    def _assembly_from_bodies(self, bodies: list[CadBody]):
        assembly = self.cq.Assembly(name="process-flow-geometry")
        for index, body in enumerate(bodies):
            color = self.cq.Color(*hex_to_srgb(material_color_hex(body.material)))
            assembly.add(body.shape, name=body_label_name(body, index), color=color)
        return assembly

    def _export_glb_z_up(self, assembly: Any, output_path: Path) -> None:
        try:
            from cadquery.occ_impl.assembly import toCAF
            from OCP.Message import Message_ProgressRange
            from OCP.RWGltf import RWGltf_CafWriter
            from OCP.TColStd import TColStd_IndexedDataMapOfStringString
            from OCP.TCollection import TCollection_AsciiString
        except ImportError as error:
            raise CadExportError("CadQuery OCP GLB modules are unavailable.") from error

        # CadQuery's high-level GLTF exporter rotates +Z-up models to glTF's
        # conventional +Y-up coordinate system. The Process Flow viewer is Z-up,
        # matching the geometry structure and the previous exporter path, so write
        # CAF directly and intentionally keep coordinates unchanged.
        _, doc = toCAF(
            assembly,
            True,
            True,
            self.options.linear_deflection,
            self.options.angular_deflection,
        )
        writer = RWGltf_CafWriter(TCollection_AsciiString(str(output_path)), True)
        result = writer.Perform(
            doc,
            TColStd_IndexedDataMapOfStringString(),
            Message_ProgressRange(),
        )
        if result is False:
            raise CadExportError("GLB export failed.")

    def _set_step_options(self, unit_system: str) -> None:
        try:
            from OCP.Interface import Interface_Static
            from OCP.STEPCAFControl import STEPCAFControl_Controller
            from OCP.STEPControl import STEPControl_Controller
        except ImportError as error:
            raise CadExportError("CadQuery OCP STEP modules are unavailable.") from error

        _call_static(STEPControl_Controller, "Init")
        _call_static(STEPCAFControl_Controller, "Init")
        schema = "AP242DIS" if self.options.step_schema.upper() == "AP242" else self.options.step_schema
        set_cval = getattr(Interface_Static, "SetCVal_s", None) or getattr(
            Interface_Static,
            "SetCVal",
        )
        if set_cval("write.step.schema", schema) is False:
            raise CadExportError(f"Unsupported STEP schema: {self.options.step_schema}")
        if set_cval("write.step.unit", self._step_unit(unit_system)) is False:
            raise CadExportError(f"Unsupported STEP unit system: {unit_system}")

    @staticmethod
    def _step_unit(unit_system: str) -> str:
        units = {
            "um": "UM",
            "mm": "MM",
            "cm": "CM",
            "m": "M",
            "inch": "INCH",
        }
        return units.get(str(unit_system).lower(), str(unit_system).upper())

    def _union_shapes(self, shapes: list[Any]):
        filtered = [shape for shape in shapes if not self._is_empty_shape(shape)]
        if not filtered:
            return None
        result = filtered[0]
        for shape in filtered[1:]:
            result = self._fuse(result, shape)
        return result

    def _has_overlap(self, left, right) -> bool:
        if self._is_empty_shape(left) or self._is_empty_shape(right):
            return False
        if not self._bounding_boxes_overlap(left, right):
            return False
        common = self._common(left, right)
        return self._shape_volume(common) > self.options.volume_tolerance

    def _bounding_boxes_overlap(self, left, right) -> bool:
        left_box = self._bounding_box(left)
        right_box = self._bounding_box(right)
        return (
            left_box["xmin"] <= right_box["xmax"]
            and right_box["xmin"] <= left_box["xmax"]
            and left_box["ymin"] <= right_box["ymax"]
            and right_box["ymin"] <= left_box["ymax"]
            and left_box["zmin"] <= right_box["zmax"]
            and right_box["zmin"] <= left_box["zmax"]
        )

    @staticmethod
    def _bounding_box(shape) -> dict[str, float]:
        box = shape.BoundingBox()
        return {
            "xmin": _get_number_attr(box, "xmin"),
            "ymin": _get_number_attr(box, "ymin"),
            "zmin": _get_number_attr(box, "zmin"),
            "xmax": _get_number_attr(box, "xmax"),
            "ymax": _get_number_attr(box, "ymax"),
            "zmax": _get_number_attr(box, "zmax"),
        }

    @staticmethod
    def _shape_volume(shape) -> float:
        if shape is None:
            return 0
        volume = shape.Volume()
        return abs(float(volume)) if math.isfinite(volume) else 0

    @staticmethod
    def _is_empty_shape(shape) -> bool:
        return shape is None

    def _fuse(self, left, right):
        return left.fuse(right)

    def _cut(self, left, right):
        return left.cut(right)

    def _common(self, left, right):
        return left.intersect(right)

    def _subtract_tool(self, shape, tool):
        if self._is_empty_shape(shape) or self._is_empty_shape(tool):
            return shape
        if not self._bounding_boxes_overlap(shape, tool):
            return shape

        common = self._common(shape, tool)
        overlap_volume = self._shape_volume(common)
        if overlap_volume <= self.options.volume_tolerance:
            return shape

        shape_volume = self._shape_volume(shape)
        if shape_volume - overlap_volume <= self.options.volume_tolerance:
            return None
        return self._cut(shape, tool)


def _load_cadquery():
    try:
        import cadquery as cq
    except ImportError as error:
        raise CadExportError(
            "CadQuery is required for CAD export. Install apps/api dependencies first."
        ) from error
    return cq


def _normalize_format(value: str) -> Literal["glb", "step"]:
    normalized = str(value).strip().lower()
    if normalized in ("glb", "step"):
        return normalized  # type: ignore[return-value]
    raise CadExportError(f"Unsupported CAD export format: {value}")


def _require_geometry_fields(geometry: JsonObject, fields: list[str]) -> None:
    for field in fields:
        if field not in geometry:
            raise CadExportError(f"Geometry {geometry.get('type')} missing field {field}")


def _positive_number(value: Any, label: str) -> float:
    number = _finite_number(value, label)
    if number <= 0:
        raise CadExportError(f"{label} must be a positive finite number.")
    return number


def _non_negative_number(value: Any, label: str) -> float:
    number = _finite_number(value, label)
    if number < 0:
        raise CadExportError(f"{label} must be a non-negative finite number.")
    return number


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise CadExportError(f"{label} must be a finite number.") from None
    if not math.isfinite(number):
        raise CadExportError(f"{label} must be a finite number.")
    return number


def _get_number_attr(value: Any, name: str) -> float:
    attr = getattr(value, name)
    resolved = attr() if callable(attr) else attr
    return float(resolved)


def _call_static(owner: Any, name: str) -> Any:
    method = getattr(owner, f"{name}_s", None) or getattr(owner, name)
    return method()


def material_color_hex(material: Any) -> str:
    normalized = normalize_material_name(material).lower()
    for tests, color in MATERIAL_COLOR_RULES:
        if any(material_matches(normalized, token) for token in tests):
            return color
    index = stable_hash(normalized) % len(MATERIAL_FALLBACK_COLORS)
    return MATERIAL_FALLBACK_COLORS[index]


def feature_material_name(feature_type: str, material: Any, density: Any) -> str:
    return "_".join(
        [
            sanitize_material_token(feature_type),
            sanitize_material_token(normalize_material_name(material)),
            sanitize_density_token(density),
        ]
    )


def body_label_name(body: CadBody, index: int) -> str:
    return f"{normalize_material_name(body.material)} body {index + 1}"


def normalize_material_name(material: Any) -> str:
    value = "" if material is None else str(material)
    return value.strip() or "generic"


def sanitize_density_token(density: Any) -> str:
    if density is None or density == "":
        return "unknown"
    try:
        numeric = float(density)
        raw = str(int(numeric)) if numeric.is_integer() else str(numeric)
    except (TypeError, ValueError):
        raw = str(density).strip()
    return sanitize_material_token(raw.replace("-", "minus").replace(".", "p"))


def sanitize_material_token(value: Any) -> str:
    token = re.sub(r"[^A-Za-z0-9]+", "_", str(value).strip()).strip("_")
    return token or "generic"


def material_matches(material: str, token: str) -> bool:
    if token == "sac":
        return re.search(r"(^|[^a-z0-9])sac([0-9]|[^a-z0-9]|$)", material) is not None
    if len(token) <= 3:
        return re.search(rf"(^|[^a-z0-9]){re.escape(token)}([^a-z0-9]|$)", material) is not None
    return token in material


def hex_to_srgb(hex_value: str) -> tuple[float, float, float]:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", hex_value)
    if not match:
        raise CadExportError(f"Invalid material color: {hex_value}")
    value = match.group(1)
    return tuple(int(value[offset : offset + 2], 16) / 255 for offset in (0, 2, 4))


def stable_hash(value: str) -> int:
    result = 0
    for char in value:
        result = (result * 31 + ord(char)) & 0xFFFFFFFF
    return result
