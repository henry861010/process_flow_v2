from __future__ import annotations

from .container import Container
from .features import Body, Bump, Circuit, Via
from .geometry import BoxGeometry, ConeGeometry, CylinderGeometry, PolygonGeometry
from .region import Region, TYPE_DIE, TYPE_TARGET
from ..serialization.schema import DEFAULT_UNIT_SYSTEM, GEOMETRY_SCHEMA_VERSION, deep_copy, normalize_geometry_structure
from ..utils.math_utils import math

ROOT_SCOPE = "root"


class ProcessGeometryState:
    def __init__(
        self,
        *,
        root=None,
        cursor_z=0,
        process_footprint=None,
        schema_version=GEOMETRY_SCHEMA_VERSION,
        unit_system=DEFAULT_UNIT_SYSTEM,
    ):
        self._root = root or Container(key="main")
        self._cursor_z = _finite_number(cursor_z, "cursorZ")
        self._process_footprint = (
            None if process_footprint is None else _normalize_footprint_spec(process_footprint)
        )
        self._schema_version = schema_version
        self._unit_system = unit_system
        self._scope_ids = {}
        self._scopes_by_id = {}
        self._next_scope_id = 1
        self._next_handle_id = 1
        self._register_scope_tree(self._root)

    @classmethod
    def create(cls, options=None):
        options = options or {}
        return cls(
            root=Container(key=options.get("key", "main")),
            unit_system=options.get("unit_system", options.get("unitSystem", DEFAULT_UNIT_SYSTEM)),
            schema_version=options.get("schema_version", options.get("schemaVersion", GEOMETRY_SCHEMA_VERSION)),
        )

    @classmethod
    def from_structure(cls, payload, options=None):
        options = options or {}
        structure = normalize_geometry_structure(payload)
        root = _container_from_payload(structure["root"])
        cursor_option = options.get("cursor_z", options.get("cursorZ", "geometryTop"))
        cursor_z = root.z_max() if cursor_option == "geometryTop" else cursor_option
        footprint = _resolve_restore_footprint(root, options.get("footprint"))
        return cls(
            root=root,
            cursor_z=cursor_z,
            process_footprint=footprint,
            schema_version=structure["schemaVersion"],
            unit_system=structure["unitSystem"],
        )

    def clone(self):
        return ProcessGeometryState.from_structure(
            self.to_geometry_structure(),
            {"cursor_z": self._cursor_z, "footprint": self._process_footprint},
        )

    def to_geometry_structure(self, schema_version=None, unit_system=None):
        return self._root.json(
            schema_version or self._schema_version,
            unit_system or self._unit_system,
        )

    def cursor_z(self):
        return self._cursor_z

    def set_cursor_z(self, z):
        self._cursor_z = _finite_number(z, "z")
        return self

    def advance_cursor_by(self, thickness):
        self._cursor_z += _positive_number(thickness, "thickness")
        return self

    def advance_cursor_to(self, z):
        target_z = _finite_number(z, "z")
        if target_z < self._cursor_z:
            raise ValueError("advance_cursor_to requires z to be at or above cursor_z")
        self._cursor_z = target_z
        return self

    def geometry_z_min(self):
        return self._root.z_min()

    def geometry_z_max(self):
        return self._root.z_max()

    def root_body_z_max(self):
        return _direct_body_z_max(self._root)

    def z_bounds(self):
        return {"min": self.geometry_z_min(), "max": self.geometry_z_max()}

    def bounds(self, scope=ROOT_SCOPE):
        return _container_bounds(self._resolve_scope(scope))

    def set_process_footprint(self, footprint):
        self._process_footprint = _normalize_footprint_spec(footprint)
        return self

    def set_box_footprint(self, *, bottom_left, top_right):
        return self.set_process_footprint(
            {"type": "box", "bottomLeft": bottom_left, "topRight": top_right}
        )

    def set_cylinder_footprint(self, *, center, radius):
        return self.set_process_footprint({"type": "cylinder", "center": center, "radius": radius})

    def set_polygon_footprint(self, *, polygons):
        return self.set_process_footprint({"type": "polygon", "polygons": polygons})

    def process_footprint(self):
        return None if self._process_footprint is None else deep_copy(self._process_footprint)

    def require_process_footprint(self):
        if self._process_footprint is None:
            raise ValueError(
                "process footprint is required. Call initialize...Layer or set_process_footprint first."
            )
        return deep_copy(self._process_footprint)

    def derive_process_footprint(self, *, from_="largestRootBody", scope=ROOT_SCOPE):
        self._process_footprint = _derive_footprint_from_container(self._resolve_scope(scope), from_)
        return self

    def initialize_layer(
        self,
        *,
        material,
        geometry,
        key=None,
        set_footprint=True,
        cursor_z="top",
        scope=ROOT_SCOPE,
    ):
        primitive = _geometry_from_spec(geometry)
        handle = self._add_body_object(Body(primitive, _require_string(material, "material")), scope=scope)
        if set_footprint:
            self._process_footprint = _footprint_from_geometry(primitive)
        if cursor_z == "top":
            self._cursor_z = primitive.z_max()
        else:
            self.set_cursor_z(cursor_z)
        _ = key
        return handle

    def initialize_box_layer(self, *, material, bottom_left, top_right, thickness, set_footprint=True):
        return self.initialize_layer(
            material=material,
            geometry={
                "type": "box",
                "bottomLeft": bottom_left,
                "topRight": top_right,
                "thickness": thickness,
            },
            set_footprint=set_footprint,
        )

    def initialize_cylinder_layer(self, *, material, center, radius, thickness, set_footprint=True):
        return self.initialize_layer(
            material=material,
            geometry={"type": "cylinder", "center": center, "radius": radius, "thickness": thickness},
            set_footprint=set_footprint,
        )

    def initialize_polygon_layer(self, *, material, polygons, thickness, set_footprint=True):
        return self.initialize_layer(
            material=material,
            geometry={"type": "polygon", "polygons": polygons, "thickness": thickness},
            set_footprint=set_footprint,
        )

    def initialize_cone_layer(
        self,
        *,
        material,
        center,
        bottom_radius,
        top_radius,
        thickness,
        set_footprint=False,
    ):
        return self.initialize_layer(
            material=material,
            geometry={
                "type": "cone",
                "center": center,
                "bottomRadius": bottom_radius,
                "topRadius": top_radius,
                "thickness": thickness,
            },
            set_footprint=set_footprint,
        )

    def deposit_layer(
        self,
        *,
        material,
        thickness,
        z=None,
        advance_cursor=True,
        scope=ROOT_SCOPE,
        xy_inset=0,
    ):
        layer_thickness = _positive_number(thickness, "thickness")
        bottom_z = _finite_number(self._cursor_z if z is None else z, "z")
        geometry = _geometry_from_footprint(
            self.require_process_footprint(),
            bottom_z,
            layer_thickness,
        ).copy_with_xy_inset(_finite_number(xy_inset, "xyInset"))
        handle = self._add_body_object(
            Body(geometry, _require_string(material, "material")),
            scope=scope,
        )
        if advance_cursor:
            self._cursor_z = bottom_z + layer_thickness
        return handle

    def fill_to(self, *, material, z, scope=ROOT_SCOPE):
        target_z = _finite_number(z, "z")
        if target_z <= self._cursor_z:
            raise ValueError("fill_to requires z to be above cursor_z")
        return self.deposit_layer(
            material=material,
            thickness=target_z - self._cursor_z,
            z=self._cursor_z,
            advance_cursor=True,
            scope=scope,
        )

    def deposit_geometry(self, *, material, geometry, advance_cursor=False, scope=ROOT_SCOPE):
        primitive = _geometry_from_spec(geometry)
        handle = self._add_body_object(Body(primitive, _require_string(material, "material")), scope=scope)
        if advance_cursor:
            self._cursor_z = primitive.z_max()
        return handle

    def deposit_box_layer(self, *, material, bottom_left, top_right, thickness, advance_cursor=False, scope=ROOT_SCOPE):
        return self.deposit_geometry(
            material=material,
            geometry={
                "type": "box",
                "bottomLeft": bottom_left,
                "topRight": top_right,
                "thickness": thickness,
            },
            advance_cursor=advance_cursor,
            scope=scope,
        )

    def deposit_cylinder_layer(self, *, material, center, radius, thickness, advance_cursor=False, scope=ROOT_SCOPE):
        return self.deposit_geometry(
            material=material,
            geometry={"type": "cylinder", "center": center, "radius": radius, "thickness": thickness},
            advance_cursor=advance_cursor,
            scope=scope,
        )

    def deposit_polygon_layer(self, *, material, polygons, thickness, advance_cursor=False, scope=ROOT_SCOPE):
        return self.deposit_geometry(
            material=material,
            geometry={"type": "polygon", "polygons": polygons, "thickness": thickness},
            advance_cursor=advance_cursor,
            scope=scope,
        )

    def deposit_cone_layer(
        self,
        *,
        material,
        center,
        bottom_radius,
        top_radius,
        thickness,
        advance_cursor=False,
        scope=ROOT_SCOPE,
    ):
        return self.deposit_geometry(
            material=material,
            geometry={
                "type": "cone",
                "center": center,
                "bottomRadius": bottom_radius,
                "topRadius": top_radius,
                "thickness": thickness,
            },
            advance_cursor=advance_cursor,
            scope=scope,
        )

    def add_via(self, *, material, density, direction, geometry, scope=ROOT_SCOPE, koz=0):
        return self._add_feature_object(
            Via(
                _geometry_from_spec(geometry),
                _finite_number(density, "density"),
                _require_string(material, "material"),
                _require_direction(direction, "via direction"),
                _non_negative_number(koz, "koz"),
            ),
            "via",
            scope,
        )

    def add_via_below_cursor(self, *, material, density, thickness, direction="-z", scope=ROOT_SCOPE, koz=0):
        via_thickness = _positive_number(thickness, "thickness")
        geometry = _geometry_from_footprint(
            self.require_process_footprint(),
            self._cursor_z - via_thickness,
            via_thickness,
        )
        return self._add_feature_object(
            Via(
                geometry,
                _finite_number(density, "density"),
                _require_string(material, "material"),
                _require_direction(direction, "via direction"),
                _non_negative_number(koz, "koz"),
            ),
            "via",
            scope,
        )

    def add_via_above_cursor(self, *, material, density, thickness, direction="+z", scope=ROOT_SCOPE, koz=0):
        via_thickness = _positive_number(thickness, "thickness")
        geometry = _geometry_from_footprint(
            self.require_process_footprint(),
            self._cursor_z,
            via_thickness,
        )
        return self._add_feature_object(
            Via(
                geometry,
                _finite_number(density, "density"),
                _require_string(material, "material"),
                _require_direction(direction, "via direction"),
                _non_negative_number(koz, "koz"),
            ),
            "via",
            scope,
        )

    def add_circuit(self, *, material, density, geometry, scope=ROOT_SCOPE, koz=0):
        return self._add_feature_object(
            Circuit(
                _geometry_from_spec(geometry),
                _finite_number(density, "density"),
                _require_string(material, "material"),
                _non_negative_number(koz, "koz"),
            ),
            "circuit",
            scope,
        )

    def add_circuit_at_cursor(self, *, material, density, thickness, scope=ROOT_SCOPE, koz=0):
        circuit_thickness = _positive_number(thickness, "thickness")
        return self._add_feature_object(
            Circuit(
                _geometry_from_footprint(
                    self.require_process_footprint(),
                    self._cursor_z,
                    circuit_thickness,
                ),
                _finite_number(density, "density"),
                _require_string(material, "material"),
                _non_negative_number(koz, "koz"),
            ),
            "circuit",
            scope,
        )

    def add_bump(self, *, material, density, direction, geometry, scope=ROOT_SCOPE, koz=0):
        return self._add_feature_object(
            Bump(
                _geometry_from_spec(geometry),
                _finite_number(density, "density"),
                _require_string(material, "material"),
                _require_direction(direction, "bump direction"),
                _non_negative_number(koz, "koz"),
            ),
            "bump",
            scope,
        )

    def add_bump_above_cursor(
        self,
        *,
        material,
        density,
        thickness,
        direction="+z",
        scope=ROOT_SCOPE,
        koz=0,
    ):
        bump_thickness = _positive_number(thickness, "thickness")
        geometry = _geometry_from_footprint(
            self.require_process_footprint(),
            self._cursor_z,
            bump_thickness,
        )
        return self._add_feature_object(
            Bump(
                geometry,
                _finite_number(density, "density"),
                _require_string(material, "material"),
                _require_direction(direction, "bump direction"),
                _non_negative_number(koz, "koz"),
            ),
            "bump",
            scope,
        )

    def apply_under_fill(self, *, material, thickness=None, thk=None, gap, scope=ROOT_SCOPE):
        underfill_material = _require_string(material, "material")
        underfill_thickness = _positive_number(thickness if thickness is not None else thk, "thickness")
        max_gap = _non_negative_number(gap, "gap")
        target_scope = self._resolve_scope(scope)
        cursor_z = self._cursor_z
        child_scopes = [
            {"child": child, "bounds": _container_bounds(child)}
            for child in target_scope.children()
        ]
        child_scopes = [item for item in child_scopes if item["bounds"]["zMax"] > cursor_z]

        child_fill_body_count = 0
        for item in child_scopes:
            child = item["child"]
            bounds = item["bounds"]
            bumps = _recursive_bumps(child)
            if len(bumps) == 0:
                continue
            bump_range = _feature_range(bumps)
            if bump_range["zMax"] <= bump_range["zMin"]:
                continue
            if _body_covers_underfill_range(child, bump_range, bounds):
                continue
            child.add_body(
                Body(
                    BoxGeometry(
                        [bounds["xMin"], bounds["yMin"], bump_range["zMin"]],
                        [bounds["xMax"], bounds["yMax"], bump_range["zMin"]],
                        bump_range["zMax"] - bump_range["zMin"],
                    ),
                    underfill_material,
                )
            )
            child_fill_body_count += 1

        gap_faces = [
            {
                "type": "BOX",
                "dim": [
                    item["bounds"]["xMin"],
                    item["bounds"]["yMin"],
                    item["bounds"]["xMax"],
                    item["bounds"]["yMax"],
                ],
            }
            for item in child_scopes
            if item["bounds"]["xMax"] > item["bounds"]["xMin"]
            and item["bounds"]["yMax"] > item["bounds"]["yMin"]
        ]
        gap_polygons = [] if len(gap_faces) < 2 else _underfill_gap_polygons(gap_faces, max_gap)

        gap_body_count = 0
        gap_scope = None
        if len(gap_polygons) > 0:
            gap_scope = Container(key="underfill-gap")
            gap_scope.add_body(
                Body(
                    PolygonGeometry(
                        [
                            [[x, y, cursor_z] for x, y in polygon]
                            for polygon in gap_polygons
                        ],
                        underfill_thickness,
                    ),
                    underfill_material,
                )
            )
            target_scope.attach_child(gap_scope)
            self._register_scope_tree(gap_scope)
            gap_body_count = 1

        return {
            "childFillBodyCount": child_fill_body_count,
            "gapBodyCount": gap_body_count,
            "gapScope": None if gap_scope is None else self._scope_ref(gap_scope),
        }

    def move(self, *, x=0, y=0, z=0, scope=ROOT_SCOPE, move_cursor=False):
        offset = {
            "x": _finite_number(x, "x"),
            "y": _finite_number(y, "y"),
            "z": _finite_number(z, "z"),
        }
        self._resolve_scope(scope).move(**offset)
        if move_cursor:
            self._cursor_z += offset["z"]
        return self

    def flip_around_z(self, *, z=0, scope=ROOT_SCOPE, normalize_z_min_to_zero=True, update_cursor=True):
        target_scope = self._resolve_scope(scope)
        target_scope.flip(_finite_number(z, "z"))
        if normalize_z_min_to_zero:
            target_scope.move(z=-target_scope.z_min())
        if update_cursor:
            self._cursor_z = target_scope.z_max()
        return self

    def grind_to(self, *, z, scope=ROOT_SCOPE, update_cursor=True):
        to_z = _finite_number(z, "z")
        self._resolve_scope(scope).grind_to(to_z)
        if update_cursor:
            self._cursor_z = min(self._cursor_z, to_z)
        return self

    def saw_to_box(
        self,
        *,
        bottom_left_x,
        bottom_left_y,
        top_right_x,
        top_right_y,
        scope=ROOT_SCOPE,
        update_footprint=True,
    ):
        bounds = _normalize_saw_box(
            bottom_left_x=bottom_left_x,
            bottom_left_y=bottom_left_y,
            top_right_x=top_right_x,
            top_right_y=top_right_y,
        )
        self._resolve_scope(scope).clip_xy_to_box(bounds)
        if update_footprint:
            self._process_footprint = _normalize_footprint_spec(
                {
                    "type": "box",
                    "bottomLeft": [bounds["xMin"], bounds["yMin"]],
                    "topRight": [bounds["xMax"], bounds["yMax"]],
                }
            )
        return self

    def remove_top_root_bodies(self, *, update_cursor=True):
        removed_count = self._root.remove_top_bodies()
        if update_cursor and removed_count > 0:
            self._cursor_z = self.root_body_z_max()
        return {"removedCount": removed_count}

    def bond_carrier_geometry(self, source, *, update_cursor=True):
        if not isinstance(source, ProcessGeometryState):
            raise ValueError("bond_carrier_geometry requires a ProcessGeometryState source")
        source_bodies = source._root.bodies()
        if len(source_bodies) == 0:
            raise ValueError("bond_carrier_geometry requires carrier source with at least one root direct body")

        source_bottom_z = min(body.z_min() for body in source_bodies)
        source_top_z = max(body.z_max() for body in source_bodies)
        target_bottom_z = self.geometry_z_max()
        z_offset = target_bottom_z - source_bottom_z

        for source_body in source_bodies:
            body = source_body.copy()
            body.move(z=z_offset)
            self._add_body_object(body)

        target_top_z = target_bottom_z + (source_top_z - source_bottom_z)
        if update_cursor:
            self._cursor_z = target_top_z
        return {
            "bondedBodyCount": len(source_bodies),
            "bottomZ": target_bottom_z,
            "topZ": target_top_z,
        }

    def place_geometry_state(self, source, *, x, y, bottom_z=None, anchor="bottomLeft", clone=True, scope=ROOT_SCOPE, key=None):
        if not isinstance(source, ProcessGeometryState):
            raise ValueError("place_geometry_state requires a ProcessGeometryState source")
        placed = source._root.copy() if clone else source._root
        if key is not None:
            placed._key = key
        source_bounds = _container_bounds(placed)
        target_point = _anchor_point(source_bounds, anchor)
        placed.move(
            x=_finite_number(x, "x") - target_point["x"],
            y=_finite_number(y, "y") - target_point["y"],
            z=_finite_number(self._cursor_z if bottom_z is None else bottom_z, "bottomZ") - source_bounds["zMin"],
        )
        parent = self._resolve_scope(scope)
        parent.attach_child(placed)
        self._register_scope_tree(placed)
        return self._scope_ref(placed)

    def place_geometry_states(self, source, placements):
        if not isinstance(placements, list):
            raise ValueError("place_geometry_states requires placements to be an array")
        return [self.place_geometry_state(source, **placement) for placement in placements]

    def root_scope_ref(self):
        return self._scope_ref(self._root)

    def find_scopes(self, *, key=None, id=None, recursive=True):
        matches = []

        def visit(container):
            ref = self._scope_ref(container)
            key_matches = key is None or container.key() == key
            id_matches = id is None or ref["id"] == id
            if key_matches and id_matches:
                matches.append(ref)
            if recursive:
                for child in container.children():
                    visit(child)

        visit(self._root)
        return matches

    def scope_summary(self, scope=ROOT_SCOPE):
        container = self._resolve_scope(scope)
        return {
            **self._scope_ref(container),
            "key": container.key(),
            "bounds": _container_bounds(container),
            "bodyCount": len(container.bodies()),
            "viaCount": len(container.vias()),
            "circuitCount": len(container.circuits()),
            "bumpCount": len(container.bumps()),
            "childCount": len(container.children()),
        }

    def inspect(self):
        return {
            "cursorZ": self._cursor_z,
            "unitSystem": self._unit_system,
            "footprint": self.process_footprint(),
            "bounds": self.bounds(),
            **self._counts(),
        }

    def _add_body_object(self, body, *, scope=ROOT_SCOPE):
        target_scope = self._resolve_scope(scope)
        target_scope.add_body(body)
        return self._handle("body", target_scope)

    def _add_feature_object(self, feature, type_, scope):
        target_scope = self._resolve_scope(scope)
        if type_ == "via":
            target_scope.add_via(feature)
        elif type_ == "circuit":
            target_scope.add_circuit(feature)
        elif type_ == "bump":
            target_scope.add_bump(feature)
        else:
            raise ValueError(f"Unsupported feature type: {type_}")
        return self._handle(type_, target_scope)

    def _resolve_scope(self, scope):
        if scope is None or scope == ROOT_SCOPE:
            return self._root
        if isinstance(scope, Container):
            return scope
        scope_id = scope if isinstance(scope, str) else scope.get("id")
        container = self._scopes_by_id.get(scope_id)
        if container is None:
            raise ValueError(f"Unknown geometry scope: {scope_id}")
        return container

    def _scope_ref(self, container):
        if id(container) not in self._scope_ids:
            self._register_scope(container)
        return {"id": self._scope_ids[id(container)]}

    def _handle(self, type_, scope):
        scope_ref = self._scope_ref(scope)
        handle = {
            "id": f"{type_}:{self._next_handle_id}",
            "type": type_,
            "scope": scope_ref,
        }
        self._next_handle_id += 1
        return handle

    def _register_scope_tree(self, container):
        self._register_scope(container)
        for child in container.children():
            self._register_scope_tree(child)

    def _register_scope(self, container):
        key = id(container)
        if key in self._scope_ids:
            return
        scope_id = ROOT_SCOPE if container is self._root else f"scope:{self._next_scope_id}"
        if container is not self._root:
            self._next_scope_id += 1
        self._scope_ids[key] = scope_id
        self._scopes_by_id[scope_id] = container

    def _counts(self):
        counts = {
            "bodyCount": 0,
            "viaCount": 0,
            "circuitCount": 0,
            "bumpCount": 0,
            "scopeCount": 0,
        }

        def visit(container):
            counts["scopeCount"] += 1
            counts["bodyCount"] += len(container.bodies())
            counts["viaCount"] += len(container.vias())
            counts["circuitCount"] += len(container.circuits())
            counts["bumpCount"] += len(container.bumps())

        _walk_container(self._root, visit)
        return counts


def _container_from_payload(container):
    result = Container(key=container.get("key", ""))
    for body in container.get("bodies", []):
        result.add_body(Body(_geometry_from_payload(body["geometry"]), body["material"]))
    for via in container.get("vias", []):
        result.add_via(
            Via(
                _geometry_from_payload(via["geometry"]),
                via["density"],
                via["material"],
                via.get("direction"),
                via["koz"],
            )
        )
    for circuit in container.get("circuits", []):
        result.add_circuit(
            Circuit(
                _geometry_from_payload(circuit["geometry"]),
                circuit["density"],
                circuit["material"],
                circuit["koz"],
            )
        )
    for bump in container.get("bumps", []):
        result.add_bump(
            Bump(
                _geometry_from_payload(bump["geometry"]),
                bump["density"],
                bump["material"],
                bump.get("direction"),
                bump["koz"],
            )
        )
    for child in container.get("children", []):
        result.attach_child(_container_from_payload(child))
    return result


def _geometry_from_payload(geometry):
    _assert_object(geometry, "geometry")
    geometry_type = geometry.get("type")
    if geometry_type == "BoxGeometry":
        return BoxGeometry(_geometry_field(geometry, "bottom_left"), _geometry_field(geometry, "top_right"), _geometry_field(geometry, "thk"))
    if geometry_type == "CylinderGeometry":
        return CylinderGeometry(_geometry_field(geometry, "center"), _geometry_field(geometry, "bottom_radius"), _geometry_field(geometry, "thk"))
    if geometry_type == "PolygonGeometry":
        return PolygonGeometry(_geometry_field(geometry, "polys"), _geometry_field(geometry, "thk"))
    if geometry_type == "ConeGeometry":
        return ConeGeometry(
            _geometry_field(geometry, "center"),
            _geometry_field(geometry, "bottom_radius"),
            _geometry_field(geometry, "top_radius"),
            _geometry_field(geometry, "thk"),
        )
    raise ValueError(f"Unsupported geometry type: {geometry_type}")


def _geometry_field(geometry, field_name):
    if field_name not in geometry:
        raise ValueError(f"Geometry {geometry.get('type')} missing field {field_name}")
    return geometry[field_name]


def _geometry_from_spec(spec):
    _assert_object(spec, "geometry")
    thickness = _positive_number(spec.get("thickness", spec.get("thk")), "thickness")
    spec_type = spec.get("type")
    if spec_type == "box":
        return BoxGeometry(
            _point3(spec.get("bottomLeft", spec.get("bottom_left")), "bottomLeft"),
            _point3(spec.get("topRight", spec.get("top_right")), "topRight"),
            thickness,
        )
    if spec_type == "cylinder":
        return CylinderGeometry(
            _point3(spec.get("center"), "center"),
            _positive_number(
                spec.get("radius", spec.get("bottomRadius", spec.get("bottom_radius"))),
                "radius",
            ),
            thickness,
        )
    if spec_type == "polygon":
        return PolygonGeometry(spec.get("polygons", spec.get("polys")), thickness)
    if spec_type == "cone":
        return ConeGeometry(
            _point3(spec.get("center"), "center"),
            _positive_number(spec.get("bottomRadius", spec.get("bottom_radius")), "bottomRadius"),
            _positive_number(spec.get("topRadius", spec.get("top_radius")), "topRadius"),
            thickness,
        )
    raise ValueError(f"Unsupported geometry spec type: {spec_type}")


def _normalize_footprint_spec(footprint):
    _assert_object(footprint, "footprint")
    footprint_type = footprint.get("type")
    if footprint_type == "box":
        return {
            "type": "box",
            "bottomLeft": _point2(footprint.get("bottomLeft", footprint.get("bottom_left")), "bottomLeft"),
            "topRight": _point2(footprint.get("topRight", footprint.get("top_right")), "topRight"),
        }
    if footprint_type == "cylinder":
        return {
            "type": "cylinder",
            "center": _point2(footprint.get("center"), "center"),
            "radius": _positive_number(footprint.get("radius"), "radius"),
        }
    if footprint_type == "polygon":
        return {
            "type": "polygon",
            "polygons": _polygon2(footprint.get("polygons", footprint.get("polys"))),
        }
    if footprint_type == "cone":
        return {
            "type": "cone",
            "center": _point2(footprint.get("center"), "center"),
            "bottomRadius": _positive_number(footprint.get("bottomRadius", footprint.get("bottom_radius")), "bottomRadius"),
            "topRadius": _positive_number(footprint.get("topRadius", footprint.get("top_radius")), "topRadius"),
        }
    raise ValueError(f"Unsupported footprint type: {footprint_type}")


def _geometry_from_footprint(footprint, z, thickness):
    bottom_z = _finite_number(z, "z")
    thk = _positive_number(thickness, "thickness")
    footprint_type = footprint.get("type")
    if footprint_type == "box":
        return BoxGeometry(
            [footprint["bottomLeft"][0], footprint["bottomLeft"][1], bottom_z],
            [footprint["topRight"][0], footprint["topRight"][1], bottom_z],
            thk,
        )
    if footprint_type == "cylinder":
        return CylinderGeometry(
            [footprint["center"][0], footprint["center"][1], bottom_z],
            footprint["radius"],
            thk,
        )
    if footprint_type == "polygon":
        return PolygonGeometry(
            [
                [[point[0], point[1], bottom_z] for point in poly]
                for poly in footprint["polygons"]
            ],
            thk,
        )
    if footprint_type == "cone":
        return ConeGeometry(
            [footprint["center"][0], footprint["center"][1], bottom_z],
            footprint["bottomRadius"],
            footprint["topRadius"],
            thk,
        )
    raise ValueError(f"Unsupported footprint type: {footprint_type}")


def _footprint_from_geometry(geometry):
    if isinstance(geometry, BoxGeometry):
        bottom_left = geometry.bottom_left()
        top_right = geometry.top_right()
        return _normalize_footprint_spec(
            {
                "type": "box",
                "bottomLeft": [bottom_left[0], bottom_left[1]],
                "topRight": [top_right[0], top_right[1]],
            }
        )
    if isinstance(geometry, CylinderGeometry):
        center = geometry.center()
        return _normalize_footprint_spec(
            {
                "type": "cylinder",
                "center": [center[0], center[1]],
                "radius": geometry.bottom_radius(),
            }
        )
    if isinstance(geometry, PolygonGeometry):
        return _normalize_footprint_spec(
            {
                "type": "polygon",
                "polygons": [
                    [[point[0], point[1]] for point in poly]
                    for poly in geometry.polygons()
                ],
            }
        )
    if isinstance(geometry, ConeGeometry):
        center = geometry.center()
        return _normalize_footprint_spec(
            {
                "type": "cone",
                "center": [center[0], center[1]],
                "bottomRadius": geometry.bottom_radius(),
                "topRadius": geometry.top_radius(),
            }
        )
    raise ValueError("Unsupported geometry for process footprint")


def _resolve_restore_footprint(root, footprint):
    if footprint is None:
        return None
    if isinstance(footprint, dict) and "derive" in footprint:
        return _derive_footprint_from_container(root, footprint["derive"])
    return _normalize_footprint_spec(footprint)


def _derive_footprint_from_container(container, strategy):
    if strategy == "geometryBounds":
        bounds = _container_bounds(container)
        return _normalize_footprint_spec(
            {
                "type": "box",
                "bottomLeft": [bounds["xMin"], bounds["yMin"]],
                "topRight": [bounds["xMax"], bounds["yMax"]],
            }
        )
    bodies = container.bodies()
    if len(bodies) == 0:
        raise ValueError(f"derive_process_footprint {strategy} requires a direct body")
    if strategy in ("firstRootBody", "firstDirectBody"):
        return _footprint_from_geometry(bodies[0].geometry())
    if strategy in ("largestRootBody", "largestDirectBody"):
        largest = bodies[0]
        for body in bodies[1:]:
            if _xy_area(body.geometry()) > _xy_area(largest.geometry()):
                largest = body
        return _footprint_from_geometry(largest.geometry())
    raise ValueError(f"Unsupported footprint derivation strategy: {strategy}")


def _container_bounds(container):
    bounds = []

    def visit(current):
        for feature in [*current.bodies(), *current.vias(), *current.circuits(), *current.bumps()]:
            bounds.append(_geometry_bounds(feature.geometry()))

    _walk_container(container, visit)
    if len(bounds) == 0:
        return {"xMin": 0, "xMax": 0, "yMin": 0, "yMax": 0, "zMin": 0, "zMax": 0}
    aggregate = bounds[0]
    for item in bounds[1:]:
        aggregate = {
            "xMin": min(aggregate["xMin"], item["xMin"]),
            "xMax": max(aggregate["xMax"], item["xMax"]),
            "yMin": min(aggregate["yMin"], item["yMin"]),
            "yMax": max(aggregate["yMax"], item["yMax"]),
            "zMin": min(aggregate["zMin"], item["zMin"]),
            "zMax": max(aggregate["zMax"], item["zMax"]),
        }
    return aggregate


def _geometry_bounds(geometry):
    if isinstance(geometry, BoxGeometry):
        bottom_left = geometry.bottom_left()
        top_right = geometry.top_right()
        return {
            "xMin": min(bottom_left[0], top_right[0]),
            "xMax": max(bottom_left[0], top_right[0]),
            "yMin": min(bottom_left[1], top_right[1]),
            "yMax": max(bottom_left[1], top_right[1]),
            "zMin": geometry.z_min(),
            "zMax": geometry.z_max(),
        }
    if isinstance(geometry, PolygonGeometry):
        nodes = [point for poly in geometry.polygons() for point in poly]
        return {
            "xMin": min(node[0] for node in nodes),
            "xMax": max(node[0] for node in nodes),
            "yMin": min(node[1] for node in nodes),
            "yMax": max(node[1] for node in nodes),
            "zMin": geometry.z_min(),
            "zMax": geometry.z_max(),
        }
    if isinstance(geometry, (CylinderGeometry, ConeGeometry)):
        center = geometry.center()
        radius = max(geometry.bottom_radius(), geometry.top_radius()) if isinstance(geometry, ConeGeometry) else geometry.bottom_radius()
        return {
            "xMin": center[0] - radius,
            "xMax": center[0] + radius,
            "yMin": center[1] - radius,
            "yMax": center[1] + radius,
            "zMin": geometry.z_min(),
            "zMax": geometry.z_max(),
        }
    raise ValueError("Unsupported geometry for bounds")


def _walk_container(container, visitor):
    visitor(container)
    for child in container.children():
        _walk_container(child, visitor)


def _recursive_bumps(container):
    bumps = []
    _walk_container(container, lambda current: bumps.extend(current.bumps()))
    return bumps


def _recursive_bodies(container):
    bodies = []
    _walk_container(container, lambda current: bodies.extend(current.bodies()))
    return bodies


def _feature_range(features):
    result = {
        "xMin": float("inf"),
        "xMax": float("-inf"),
        "yMin": float("inf"),
        "yMax": float("-inf"),
        "zMin": float("inf"),
        "zMax": float("-inf"),
    }
    for feature in features:
        bounds = _geometry_bounds(feature.geometry())
        result = {
            "xMin": min(result["xMin"], bounds["xMin"]),
            "xMax": max(result["xMax"], bounds["xMax"]),
            "yMin": min(result["yMin"], bounds["yMin"]),
            "yMax": max(result["yMax"], bounds["yMax"]),
            "zMin": min(result["zMin"], feature.z_min()),
            "zMax": max(result["zMax"], feature.z_max()),
        }
    return result


def _body_covers_underfill_range(container, z_range, xy_bounds):
    for body in _recursive_bodies(container):
        bounds = _geometry_bounds(body.geometry())
        if (
            math.f_le(bounds["zMin"], z_range["zMin"])
            and math.f_ge(bounds["zMax"], z_range["zMax"])
            and math.f_le(bounds["xMin"], xy_bounds["xMin"])
            and math.f_ge(bounds["xMax"], xy_bounds["xMax"])
            and math.f_le(bounds["yMin"], xy_bounds["yMin"])
            and math.f_ge(bounds["yMax"], xy_bounds["yMax"])
        ):
            return True
    return False


def _underfill_gap_polygons(faces, gap):
    region = Region(faces)
    region.set_gap(gap, set_to=TYPE_TARGET, target_mask=TYPE_DIE, is_recursive=True)
    return region.get_outline(TYPE_TARGET)


def _direct_body_z_max(container):
    bodies = container.bodies()
    return 0 if len(bodies) == 0 else max(body.z_max() for body in bodies)


def _normalize_saw_box(*, bottom_left_x, bottom_left_y, top_right_x, top_right_y):
    x_min = _finite_number(bottom_left_x, "bottomLeftX")
    y_min = _finite_number(bottom_left_y, "bottomLeftY")
    x_max = _finite_number(top_right_x, "topRightX")
    y_max = _finite_number(top_right_y, "topRightY")
    if math.f_le(x_max, x_min):
        raise ValueError("saw_to_box requires topRightX to be greater than bottomLeftX")
    if math.f_le(y_max, y_min):
        raise ValueError("saw_to_box requires topRightY to be greater than bottomLeftY")
    return {"xMin": x_min, "xMax": x_max, "yMin": y_min, "yMax": y_max}


def _anchor_point(bounds, anchor):
    if anchor == "bottomLeft":
        return {"x": bounds["xMin"], "y": bounds["yMin"]}
    if anchor == "center":
        return {
            "x": (bounds["xMin"] + bounds["xMax"]) / 2,
            "y": (bounds["yMin"] + bounds["yMax"]) / 2,
        }
    if anchor == "origin":
        return {"x": 0, "y": 0}
    raise ValueError(f"Unsupported placement anchor: {anchor}")


def _xy_area(geometry):
    bounds = _geometry_bounds(geometry)
    return (bounds["xMax"] - bounds["xMin"]) * (bounds["yMax"] - bounds["yMin"])


def _point2(value, label):
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError(f"{label} must be a two-number point")
    return [
        _finite_number(value[0], f"{label}[0]"),
        _finite_number(value[1], f"{label}[1]"),
    ]


def _point3(value, label):
    if not isinstance(value, list) or len(value) < 3:
        raise ValueError(f"{label} must be a three-number point")
    return [
        _finite_number(value[0], f"{label}[0]"),
        _finite_number(value[1], f"{label}[1]"),
        _finite_number(value[2], f"{label}[2]"),
    ]


def _polygon2(polygons):
    if not isinstance(polygons, list):
        raise ValueError("polygons must be an array")
    return [[_point2(point, "polygon point") for point in poly] for poly in polygons]


def _finite_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if number in (float("inf"), float("-inf")) or number != number:
        raise ValueError(f"{label} must be a finite number")
    return number


def _positive_number(value, label):
    number = _finite_number(value, label)
    if number <= 0:
        raise ValueError(f"{label} must be positive")
    return number


def _non_negative_number(value, label):
    number = _finite_number(value, label)
    if number < 0:
        raise ValueError(f"{label} must be non-negative")
    return number


def _require_string(value, label):
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _require_direction(value, label):
    if value not in ("+z", "-z"):
        raise ValueError(f'{label} must be "+z" or "-z"')
    return value


def _assert_object(value, label):
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
