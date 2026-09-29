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
            "bumps": [{"id": "bump:source", "material": "Sn", "geometry": box(5, 2), "density": 50, "direction": "+z", "koz": 0}],
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
        state.find_geometry(kind="body")[0]["material"] = "changed"
        self.assertEqual(state.to_geometry_structure(), structure)

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
