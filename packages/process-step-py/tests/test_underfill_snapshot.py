"""Retained UF after physical placement and XY cutting."""
import copy
import json
import unittest

from process_flow_geometry_generators.schematic_presenters import register_presenters as generators
from process_flow_kernel import BoxGeometry, ProcessGeometryState, normalize_geometry_structure
from process_flow_schematic import SchematicRegistry, UNDERFILL_FILL, compose_schematic
from process_flow_steps.schematic_presenters import register_presenters as steps


def assembly(bumped=()):
    state = ProcessGeometryState.create()
    state.initialize_box_layer(material="base", bottom_left=[0, 0, 0],
                               top_right=[24, 10, 0], thickness=4)
    for role, x in (("soc", 0), ("hbm", 14)):
        bottom = 2 if role in bumped else 0
        root = {"key": role, "bodies": [{"material": "Si", "geometry":
                BoxGeometry([0, 0, bottom], [10, 10, bottom], 10).json()}]}
        if role in bumped:
            root["bumps"] = [{"material": "SnAg", "density": 40, "stage": "joined",
                              "direction": "-z", "koz": 0, "geometry":
                              BoxGeometry([0, 0, 0], [10, 10, 0], 2).json()}]
        state.place_geometry_state(ProcessGeometryState.from_structure(normalize_geometry_structure(root)),
                                   x=x, y=0, bottom_z=4, anchor="bottomLeft")
    result = state.apply_under_fill(material="UF", thk=6, gap=5, key="uf")
    return state, result


def document(state):
    registry = SchematicRegistry()
    generators(registry)
    steps(registry)
    snapshot = state.to_geometry_structure()
    before = copy.deepcopy(snapshot)
    result = compose_schematic(snapshot, registry)
    assert snapshot == before
    json.dumps(result, allow_nan=False)
    return result


def uf_shapes(result):
    return [shape for shape in result["shapes"] if shape["fill"] == UNDERFILL_FILL]


class UnderfillSnapshotTests(unittest.TestCase):
    def test_standalone_retained_gap_is_a_slab_without_connectivity_inference(self):
        for bumped in ((), ("soc",), ("hbm",), ("soc", "hbm")):
            with self.subTest(bumped=bumped):
                state, counts = assembly(bumped)
                self.assertEqual(counts["gapBodyCount"], 1)
                self.assertEqual(counts["childFillBodyCount"], len(bumped))
                result = document(state)
                self.assertEqual(result["warnings"], [])
                left, right = result["components"]
                bridges = [shape for shape in uf_shapes(result)
                           if shape["x"] == left["x"] + left["width"]
                           and shape["x"] + shape["width"] == right["x"]]
                self.assertEqual(len(bridges), 0)
                self.assertEqual(len(uf_shapes(result)), 1 + len(bumped))
                self.assertEqual(sorted(item["thickness"] for item in result["items"] if item["material"] == "UF"),
                                 sorted([6] + [2] * len(bumped)))

    def test_saw_keeps_retained_gap_measurements_without_inventing_a_removed_endpoint(self):
        state, _ = assembly()
        state.saw_to_box(bottom_left_x=0, bottom_left_y=0, top_right_x=12, top_right_y=10)
        result = document(state)
        self.assertEqual(result["warnings"], [])
        self.assertEqual([component["label"] for component in result["components"]], ["SoC"])
        self.assertEqual(len(uf_shapes(result)), 1)
        retained = [item for item in result["items"] if item["material"] == "UF"]
        self.assertEqual(len(retained), 1)
        self.assertEqual((retained[0]["zMin"], retained[0]["zMax"], retained[0]["thickness"]), (4, 10, 6))
        self.assertFalse(any("retained fill connects" in note for note in result["notes"]))


if __name__ == "__main__":
    unittest.main()
