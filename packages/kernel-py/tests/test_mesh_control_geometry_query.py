from __future__ import annotations

import unittest

from process_flow_kernel import ProcessGeometryState, normalize_geometry_structure


def box(z, thickness):
    return {
        "type": "BoxGeometry",
        "bottom_left": [0, 0, z],
        "top_right": [10, 10, z],
        "thk": thickness,
    }


class MeshControlGeometryQueryTests(unittest.TestCase):
    def test_round_trips_ids_and_queries_all_five_kinds_without_exposing_state(self):
        structure = normalize_geometry_structure({
            "id": "container:source",
            "key": "hbm",
            "bodies": [{"id": "body:source", "key": "envelope", "material": "EMC", "geometry": box(0, 10)}],
            "vias": [{"id": "via:source", "material": "Cu", "geometry": box(1, 2), "density": 50, "direction": "+z", "koz": 0}],
            "circuits": [{"id": "circuit:source", "material": "Cu", "geometry": box(3, 2), "density": 50, "koz": 0}],
            "bumps": [{"id": "bump:source", "material": "Sn", "geometry": box(5, 2), "density": 50, "direction": "+z", "koz": 0, "stage": "reflowed"}],
            "children": [{"id": "container:child", "bodies": [{"id": "body:child", "material": "Si", "geometry": box(2, 4)}]}],
        })
        state = ProcessGeometryState.from_structure(structure)
        self.assertEqual(state.to_geometry_structure(), structure)
        self.assertEqual(
            {node["kind"] for node in state.find_geometry()},
            {"container", "body", "via", "circuit", "bump"},
        )
        self.assertEqual(state.find_geometry(kind="via")[0]["containerId"], "container:source")
        self.assertEqual(state.find_geometry(kind="body", material="Si")[0]["zMax"], 6)
        self.assertEqual(state.find_geometry(kind="container", id="container:child")[0]["parentId"], "container:source")
        for node in state.find_geometry():
            self.assertEqual(
                [node[field] for field in ("xMin", "xMax", "yMin", "yMax")],
                [0, 10, 0, 10],
            )
        state.find_geometry(kind="body")[0]["material"] = "changed"
        state.find_geometry(kind="body")[0]["xMax"] = 999
        self.assertEqual(state.to_geometry_structure(), structure)

    def test_xy_bounds_cover_all_shapes_nested_features_and_empty_subtrees(self):
        shapes = [
            ({"type": "BoxGeometry", "bottom_left": [8, 6, 5],
              "top_right": [2, 1, 5], "thk": 3}, [2, 8, 1, 6]),
            ({"type": "PolygonGeometry", "polys": [[[-8, 1, 5], [-2, 1, 5],
              [-4, 9, 5]]], "thk": 3}, [-8, -2, 1, 9]),
            ({"type": "CylinderGeometry", "center": [20, -10, 5],
              "bottom_radius": 4, "thk": 3}, [16, 24, -14, -6]),
            ({"type": "ConeGeometry", "center": [-20, 10, 5],
              "bottom_radius": 2, "top_radius": 6, "thk": 3}, [-26, -14, 4, 16]),
        ]
        for geometry, expected in shapes:
            with self.subTest(shape=geometry["type"]):
                state = ProcessGeometryState.from_structure(normalize_geometry_structure({
                    "id": "root",
                    "children": [
                        {"id": "empty"},
                        {"id": "outer", "children": [{"id": "nested", "bodies": [
                            {"id": "feature", "material": "Si", "geometry": geometry},
                        ]}]},
                    ],
                }))
                nodes = {node["id"]: node for node in state.find_geometry()}
                for node_id in ("root", "outer", "nested", "feature"):
                    self.assertEqual(
                        [nodes[node_id][field] for field in ("xMin", "xMax", "yMin", "yMax")],
                        expected,
                    )
                self.assertEqual(
                    [nodes["empty"][field] for field in ("xMin", "xMax", "yMin", "yMax")],
                    [None] * 4,
                )
                self.assertEqual((nodes["feature"]["zMin"], nodes["feature"]["zMax"]), (5, 8))

    def test_container_xy_bounds_aggregate_all_feature_kinds_and_descendants(self):
        state = ProcessGeometryState.from_structure(normalize_geometry_structure({
            "id": "root",
            "children": [
                {"id": "empty"},
                {"id": "left", "bodies": [{"id": "body:left", "material": "Si", "geometry": {
                    "type": "BoxGeometry", "bottom_left": [-30, 10, 2],
                    "top_right": [-20, 20, 2], "thk": 5,
                }}]},
                {"id": "right", "bumps": [{"id": "bump:right", "material": "Sn", "geometry": {
                    "type": "BoxGeometry", "bottom_left": [20, -50, 2],
                    "top_right": [40, -40, 2], "thk": 5,
                }, "density": 50, "direction": "+z", "koz": 0, "stage": "reflowed"}]},
            ],
        }))
        root = state.find_geometry(id="root")[0]
        self.assertEqual([root[field] for field in ("xMin", "xMax", "yMin", "yMax")], [-30, 40, -50, 20])

    def test_placing_two_copies_regenerates_structure_ids(self):
        source = ProcessGeometryState.from_structure(normalize_geometry_structure({
            "id": "container:die",
            "key": "hbm",
            "bodies": [{"id": "body:die", "material": "Si", "geometry": box(0, 2)}],
        }))
        destination = ProcessGeometryState.create()
        destination.place_geometry_state(source, x=0, y=0, bottom_z=0, anchor="origin")
        destination.place_geometry_state(source, x=20, y=0, bottom_z=0, anchor="origin")
        ids = [node["id"] for node in destination.find_geometry()]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(source.to_geometry_structure()["root"]["id"], "container:die")


if __name__ == "__main__":
    unittest.main()
