from __future__ import annotations

import unittest

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetNotApplicable, MeshControlSetRegistry
from process_flow_mesh_control.contracts import MeshControlSetResult


def hbm_structure(*, core_count=3, base_gap=20, core_gap=20, top_molding=30):
    def body(body_id, z, thickness, material="Si", key=None):
        result = {
            "id": body_id,
            "material": material,
            "geometry": {
                "type": "BoxGeometry",
                "bottom_left": [0, 0, z],
                "top_right": [100, 100, z],
                "thk": thickness,
            },
        }
        if key:
            result["key"] = key
        return result

    children = [{"id": "container:hbm-base-die", "bodies": [body("body:hbm-base-die", 0, 100)]}]
    for index in range(core_count):
        z = 100 + base_gap + index * (50 + core_gap)
        sequence = f"{index + 1:02d}"
        children.append({
            "id": f"container:hbm-core-die-{sequence}",
            "bodies": [body(f"body:hbm-core-die-{sequence}", z, 50)],
        })
    top = 100 + base_gap + core_count * 50 + (core_count - 1) * core_gap + top_molding
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "id": "container:hbm-root",
            "key": "hbm",
            "bodies": [body("body:hbm-molding", 0, top, "EMC", "envelope")],
            "children": children,
        },
    }


class HbmExampleTests(unittest.TestCase):
    def setUp(self):
        self.registry = MeshControlSetRegistry()

    def apply(self, structure):
        return self.registry.apply("hbm-example", ProcessGeometryState.from_structure(structure))[1]

    def test_multi_core_resolves_real_boundaries(self):
        result = self.apply(hbm_structure())
        self.assertEqual(result.mesh_control["globalElementSize"], 500)
        self.assertEqual(result.mesh_control["symmetry"], "full")
        self.assertEqual(
            [(item["startZ"]["value"], item["endZ"]["value"]) for item in result.mesh_control["controls"]],
            [(0, 100), (100, 120), (120, 170), (170, 190), (190, 240), (240, 260), (260, 310), (310, 340)],
        )
        self.assertTrue(all(item["reference"] == {"kind": "container", "id": "container:hbm-root"} for item in result.mesh_control["controls"]))

    def test_single_core_and_zero_intervals_are_omitted(self):
        result = self.apply(hbm_structure(core_count=1, base_gap=0, top_molding=0))
        self.assertEqual(len(result.mesh_control["controls"]), 2)
        self.assertEqual(
            [item["label"] for item in result.details if item["status"] == "omitted"],
            ["Base-to-core gap", "Top molding"],
        )
        two_core = self.apply(hbm_structure(core_count=2, core_gap=0))
        self.assertIn(
            "Core-to-core gap 1",
            [item["label"] for item in two_core.details if item["status"] == "omitted"],
        )

    def test_wrong_geometry_and_broken_generator_shape_are_rejected(self):
        wrong = hbm_structure()
        wrong["root"]["key"] = "dram"
        with self.assertRaises(MeshControlSetNotApplicable):
            self.apply(wrong)
        broken = hbm_structure()
        broken["root"]["children"][1]["id"] = "container:unexpected"
        with self.assertRaises(MeshControlSetNotApplicable):
            self.apply(broken)

    def test_registry_rejects_a_set_that_mutates_input_state(self):
        class MutatingSet:
            def definition(self):
                return {"id": "mutating", "version": "1", "label": "Mutating", "description": "test"}

            def build(self, state):
                state.set_cursor_z(123)
                return MeshControlSetResult(mesh_control={}, details=[])

        state = ProcessGeometryState.from_structure(hbm_structure())
        registry = MeshControlSetRegistry((MutatingSet(),))
        with self.assertRaisesRegex(ValueError, "modified its input geometry"):
            registry.apply("mutating", state)


if __name__ == "__main__":
    unittest.main()
