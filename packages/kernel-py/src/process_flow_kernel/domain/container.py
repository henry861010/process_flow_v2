from __future__ import annotations

from .features import Body, Bump, Circuit, Via
from .geometry import BoxGeometry, ConeGeometry, CylinderGeometry, PolygonGeometry
from ..serialization.schema import DEFAULT_UNIT_SYSTEM, GEOMETRY_SCHEMA_VERSION, normalize_geometry_structure


class Container:
    def __init__(self, key="", parent=None):
        self._key = key
        self._bodies = []
        self._vias = []
        self._circuits = []
        self._bumps = []
        self._parent = parent
        self._children = []

    def key(self):
        return self._key

    def parent(self):
        return self._parent

    def _set_parent(self, parent):
        self._parent = parent

    def children(self):
        return list(self._children)

    def bodies(self):
        return list(self._bodies)

    def vias(self):
        return list(self._vias)

    def circuits(self):
        return list(self._circuits)

    def bumps(self):
        return list(self._bumps)

    def add_body(self, body):
        self._bodies.append(body)
        return body

    def add_via(self, via):
        self._vias.append(via)
        return via

    def add_circuit(self, circuit):
        self._circuits.append(circuit)
        return circuit

    def add_bump(self, bump):
        self._bumps.append(bump)
        return bump

    def add_body_box(self, material, node1, node2, thk):
        return self.add_body(Body(BoxGeometry(node1, node2, thk), material))

    def add_body_polygon(self, material, polys, thk):
        return self.add_body(Body(PolygonGeometry(polys, thk), material))

    def add_body_cylinder(self, material, center, bottom_radius, thk):
        return self.add_body(Body(CylinderGeometry(center, bottom_radius, thk), material))

    def add_body_cone(self, material, center, bottom_radius, top_radius, thk):
        return self.add_body(Body(ConeGeometry(center, bottom_radius, top_radius, thk), material))

    def remove_top_bodies(self):
        if len(self._bodies) == 0:
            return 0
        top_z = max(body.z_max() for body in self._bodies)
        original_length = len(self._bodies)
        self._bodies = [body for body in self._bodies if body.z_max() != top_z]
        return original_length - len(self._bodies)

    def attach_child(self, child):
        if not isinstance(child, Container):
            raise ValueError("attachChild requires a Container child")
        if child is self:
            raise ValueError("attachChild cannot attach a container to itself")
        if self._is_descendant_of(child):
            raise ValueError("attachChild cannot create a container cycle")
        if child in self._children:
            raise ValueError("attachChild cannot attach the same child twice")
        parent = child.parent()
        if parent is not None:
            parent.detach_child(child)
        child._set_parent(self)
        self._children.append(child)
        return child

    def detach_child(self, child):
        if child not in self._children:
            raise ValueError("detachChild child is not attached to this container")
        self._children.remove(child)
        child._set_parent(None)
        return child

    def thk(self):
        return self.z_max() - self.z_min()

    def z_max(self):
        values = [feature.z_max() for feature in self._direct_features()]
        values.extend(child.z_max() for child in self._children)
        return 0 if len(values) == 0 else max(values)

    def z_min(self):
        values = [feature.z_min() for feature in self._direct_features()]
        values.extend(child.z_min() for child in self._children)
        return 0 if len(values) == 0 else min(values)

    def copy(self):
        copied = Container(key=self.key())
        for body in self._bodies:
            copied.add_body(body.copy())
        for via in self._vias:
            copied.add_via(via.copy())
        for circuit in self._circuits:
            copied.add_circuit(circuit.copy())
        for bump in self._bumps:
            copied.add_bump(bump.copy())
        for child in self._children:
            copied.attach_child(child.copy())
        return copied

    def move(self, x=0, y=0, z=0):
        for feature in self._direct_features():
            feature.move(x=x, y=y, z=z)
        for child in self._children:
            child.move(x=x, y=y, z=z)

    def resize_xy_by(self, delta_x, delta_y):
        for feature in self._direct_features():
            feature.resize_xy_by(delta_x, delta_y)
        for child in self._children:
            child.resize_xy_by(delta_x, delta_y)

    def grind_to(self, to_z):
        self._vias = self._features_after_clip(self._vias, to_z)
        self._circuits = self._features_after_clip(self._circuits, to_z)
        self._bumps = self._features_after_clip(self._bumps, to_z)
        self._bodies = self._features_after_clip(self._bodies, to_z)

        children = []
        for child in self._children:
            if child.grind_to(to_z):
                children.append(child)
        self._children = children
        return self.has_geometry()

    def clip_xy_to_box(self, bounds):
        self._vias = self._features_after_xy_clip(self._vias, bounds)
        self._circuits = self._features_after_xy_clip(self._circuits, bounds)
        self._bumps = self._features_after_xy_clip(self._bumps, bounds)
        self._bodies = self._features_after_xy_clip(self._bodies, bounds)

        children = []
        for child in self._children:
            if child.clip_xy_to_box(bounds):
                children.append(child)
        self._children = children
        return self.has_geometry()

    def flip(self, around_z=0):
        for feature in self._direct_features():
            feature.flip(around_z)
        for child in self._children:
            child.flip(around_z)

    def has_geometry(self):
        return (
            len(self._bodies) > 0
            or len(self._vias) > 0
            or len(self._circuits) > 0
            or len(self._bumps) > 0
            or any(child.has_geometry() for child in self._children)
        )

    def tree_json(self):
        return {
            "key": self._key,
            "bodies": [body.json() for body in self._bodies],
            "vias": [via.json() for via in self._vias],
            "circuits": [circuit.json() for circuit in self._circuits],
            "bumps": [bump.json() for bump in self._bumps],
            "children": [child.tree_json() for child in self._children],
        }

    def json(self, schema_version=GEOMETRY_SCHEMA_VERSION, unit_system=DEFAULT_UNIT_SYSTEM):
        return normalize_geometry_structure(self.tree_json(), schema_version, unit_system)

    def _direct_features(self):
        return [*self._bodies, *self._vias, *self._circuits, *self._bumps]

    @staticmethod
    def _features_after_clip(features, to_z):
        return [feature for feature in features if feature.clip_top_to(to_z)]

    @staticmethod
    def _features_after_xy_clip(features, bounds):
        return [feature for feature in features if feature.clip_xy_to_box(bounds)]

    def _is_descendant_of(self, container):
        current = self
        while current is not None:
            if current is container:
                return True
            current = current.parent()
        return False
