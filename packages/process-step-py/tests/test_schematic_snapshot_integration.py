"""Final-state composition through actual generator and process presenters."""
from __future__ import annotations

import copy
import unittest

from process_flow_geometry_generators import GeometryGeneratorRegistry, register_builtin_generators
from process_flow_geometry_generators.schematic_presenters import register_presenters as register_generator_presenters
from process_flow_kernel import BoxGeometry, PolygonGeometry, ProcessGeometryState, normalize_geometry_structure
from process_flow_kernel.application.material_instances import rewrite_geometry_materials
from process_flow_schematic import UNDERFILL_FILL, SchematicRegistry, compose_schematic
from process_flow_steps.schematic_presenters import register_presenters as register_step_presenters


def registry():
    result = SchematicRegistry()
    register_step_presenters(result)
    register_generator_presenters(result)
    return result


def bump(id, geometry, stage):
    return {"id": id, "geometry": geometry, "material": "SnAg", "density": 40,
            "stage": stage, "direction": "+z", "koz": 0}


def carrier_hbm_snapshot():
    return normalize_geometry_structure({"key": "carrier", "bodies": [{
        "id": "carrier", "material": "glass",
        "geometry": BoxGeometry([0, 0, 0], [10000, 10000, 0], 700).json(),
    }], "bumps": [bump("carrier-bump", BoxGeometry([0, 0, 700], [10000, 10000, 700], 25).json(), "reflowed")],
        "children": [{"id": "hbm", "key": "hbm", "bodies": [{
            "id": "hbm-package", "material": "HBM-package",
            "geometry": BoxGeometry([4000, 4000, 750], [6000, 6000, 750], 720).json(),
        }], "bumps": [bump("hbm-bump", BoxGeometry([4000, 4000, 725], [6000, 6000, 725], 25).json(), "reflowed")]}]})


class SchematicSnapshotIntegrationTests(unittest.TestCase):
    def assert_filled_bump_row(self, symbols):
        self.assertTrue(symbols)
        self.assertTrue(all(shape["kind"] == "circle" for shape in symbols))
        rect = symbols[0]["clip"]
        radius = symbols[0]["r"]
        left = symbols[0]["cx"] - radius - rect["x"]
        right = rect["x"] + rect["width"] - symbols[-1]["cx"] - radius
        self.assertAlmostEqual(left, right)
        self.assertGreater(left, 0)
        self.assertLess(left, 2 * radius)

    def test_carrier_and_hbm_before_joint_show_only_paired_reflowed_bumps(self):
        for stage in ("deposited", "reflowed"):
            with self.subTest(stage=stage):
                snapshot = carrier_hbm_snapshot()
                snapshot["root"]["bumps"][0]["stage"] = stage
                snapshot["root"]["children"][0]["bumps"][0]["stage"] = stage
                before = copy.deepcopy(snapshot)
                document = compose_schematic(snapshot, registry())
                self.assertEqual(document["warnings"], [])
                self.assertEqual(document["schemaVersion"], 1)
                self.assertEqual(document["totalThickness"], 1470)
                self.assertFalse(any(shape["kind"] == "circle" for shape in document["shapes"]))
                expected = {"carrier", "hbm-package"}
                if stage == "reflowed":
                    expected.update(("carrier-bump", "hbm-bump"))
                    self.assertTrue(any(shape["kind"] == "path" for shape in document["shapes"]))
                self.assertEqual({source for item in document["items"] for source in item["sourceIds"]}, expected)
                self.assertEqual(snapshot, before)

    def test_carrier_and_hbm_after_joint_show_only_hbm_joint_row(self):
        state = ProcessGeometryState.from_structure(carrier_hbm_snapshot())
        state.join_bumps(joined_height=15)
        snapshot = state.to_geometry_structure()
        before = copy.deepcopy(snapshot)
        document = compose_schematic(snapshot, registry())
        self.assertEqual(document["warnings"], [])
        self.assertEqual(document["totalThickness"], 1435)
        self.assertFalse(any("carrier-bump" in item["sourceIds"] for item in document["items"]))
        joint = next(item for item in document["items"] if "hbm-bump" in item["sourceIds"])
        self.assertEqual((joint["zMin"], joint["zMax"], joint["thickness"]), (700, 715, 15))
        symbols = [shape for shape in document["shapes"] if shape["kind"] == "circle"]
        self.assert_filled_bump_row(symbols)
        self.assertTrue(all(shape["itemId"] == joint["id"] for shape in symbols))
        hbm = document["components"][0]
        self.assertEqual(hbm["label"], "HBM")
        self.assertEqual(symbols[0]["clip"]["x"], hbm["x"])
        self.assertEqual(symbols[0]["clip"]["width"], hbm["width"])
        for density in (1, 100):
            variant = copy.deepcopy(snapshot)
            variant["root"]["children"][0]["bumps"][0]["density"] = density
            expected = copy.deepcopy(document)
            next(item for item in expected["items"] if item["id"] == joint["id"])["densityValues"] = [density]
            self.assertEqual(compose_schematic(variant, registry()), expected)
        absent = copy.deepcopy(snapshot)
        absent["root"]["children"][0]["bumps"][0]["density"] = 0
        self.assertFalse(any(shape["kind"] == "circle" for shape in compose_schematic(absent, registry())["shapes"]))
        self.assertEqual(snapshot, before)

    def test_partial_width_joint_hides_all_unjoined_subcolumns(self):
        lower = bump("lower", BoxGeometry([0, 0, 0], [100, 100, 0], 10).json(), "reflowed")
        joined = bump("partial-joint", BoxGeometry([20, 20, 0], [30, 60, 0], 6).json(), "joined")
        unjoined = bump("unjoined", BoxGeometry([30, 20, 0], [60, 60, 0], 10).json(), "reflowed")
        snapshot = normalize_geometry_structure({"bumps": [lower], "children": [{
            "id": "die", "key": "soc", "bumps": [joined, unjoined], "bodies": [{
                "id": "silicon", "material": "Si",
                "geometry": BoxGeometry([20, 20, 10], [60, 60, 10], 50).json(),
            }],
        }]})
        document = compose_schematic(snapshot, registry())
        self.assertEqual(document["warnings"], [])
        component = document["components"][0]
        source_ids = {source for item in document["items"] for source in item["sourceIds"]}
        self.assertEqual(source_ids, {"partial-joint", "silicon"})
        symbols = [shape for shape in document["shapes"] if shape["kind"] == "circle"]
        self.assert_filled_bump_row(symbols)
        for symbol in symbols:
            self.assertEqual(symbol["clip"]["exclusions"], [])
            self.assertEqual(symbol["clip"]["x"], component["x"])
            self.assertEqual(symbol["clip"]["width"], component["width"] / 4)

    def test_grouped_runtime_material_instances_share_measurements_and_symbols(self):
        source = normalize_geometry_structure({"key": "lsi", "bodies": [
            {"id": "rdl", "key": "rdl", "material": "PI", "geometry": BoxGeometry([0, 0, 2], [10, 10, 2], 5).json()},
            {"id": "silicon", "material": "Si", "geometry": BoxGeometry([0, 0, 7], [10, 10, 7], 10).json()},
        ], "vias": [{"id": "via", "material": "Cu", "density": 1, "direction": "+z", "koz": 0,
                      "geometry": BoxGeometry([0, 0, 2], [10, 10, 2], 5).json()}],
            "bumps": [bump("bump", BoxGeometry([0, 0, 0], [10, 10, 0], 2).json(), "joined")]})
        main = ProcessGeometryState.create()
        main.initialize_box_layer(material="Carrier", bottom_left=[0, 0, 0], top_right=[100, 100, 0], thickness=100)
        for x, suffix in ((0, ""), (30, "_dup2")):
            renamed, _ = rewrite_geometry_materials(source, {material: material + suffix for material in ("PI", "Si", "Cu", "SnAg")})
            renamed["root"]["vias"][0]["density"] = 1 if not suffix else 99
            renamed["root"]["bumps"][0]["density"] = 1 if not suffix else 99
            main.place_geometry_state(ProcessGeometryState.from_structure(renamed), x=x, y=0, bottom_z=100)
        snapshot = main.to_geometry_structure()
        document = compose_schematic(snapshot, registry())
        self.assertEqual(document["warnings"], [])
        self.assertEqual(len(document["components"]), 3)
        lsi_items = [item for item in document["items"] if item["groupLabel"] == "LSI"]
        self.assertEqual(len(lsi_items), 4)
        self.assertTrue(all(len(item["sourceIds"]) == 2 for item in lsi_items))
        circles = [shape for shape in document["shapes"] if shape["kind"] == "circle"]
        self.assertGreater(len(circles), 9)
        for component in document["components"]:
            self.assert_filled_bump_row([shape for shape in circles if shape["clip"]["x"] == component["x"]])

    def test_actual_generated_lsi_after_joint_underfill_and_grind(self):
        generators = GeometryGeneratorRegistry()
        register_builtin_generators(generators)
        generated = generators.preview("lsi", {"generation": "gen2-bs-first"}, generator_version=1)
        source = generated["geometryEntityJson"]["structure"]
        before = copy.deepcopy(source)
        die = ProcessGeometryState.from_structure(source)
        main = ProcessGeometryState.create()
        main.initialize_box_layer(material="Si", bottom_left=[-10000, -10000, 0],
                                  top_right=[10000, 10000, 0], thickness=100)
        main.add_bump_above_cursor(material="SnAg", density=40, thickness=20, stage="reflowed")
        main.place_geometry_state(die, x=0, y=0, anchor="center", bottom_z=120)
        main.join_bumps(joined_height=25)
        main.apply_under_fill(material="UF", thk=25, gap=10, key="uf")
        carrier_before = next(body for body in main.to_geometry_structure()["root"]["children"][0]["bodies"]
                              if body.get("key") == "lsi.si_carrier")
        main.grind_to(z=carrier_before["geometry"]["bottom_left"][2] + 190)
        snapshot = main.to_geometry_structure()
        snapshot_before = copy.deepcopy(snapshot)
        document = compose_schematic(snapshot, registry())

        self.assertEqual(document["warnings"], [])
        self.assertEqual([component["label"] for component in document["components"]], ["LSI"] * 3)
        carrier = next(body for body in snapshot["root"]["children"][0]["bodies"] if body.get("key") == "lsi.si_carrier")
        carrier_row = next(item for item in document["items"] if carrier["id"] in item["sourceIds"])
        self.assertEqual(carrier_row["thickness"], 190)
        self.assertAlmostEqual(document["totalThickness"], 581.5)
        uf_shapes = [shape for shape in document["shapes"] if shape["fill"] == UNDERFILL_FILL]
        self.assertEqual(len(uf_shapes), 5)  # Three cavities and two representative gaps.
        lower_id = snapshot["root"]["bumps"][0]["id"]
        self.assertFalse(any(lower_id in item["sourceIds"] for item in document["items"]))
        circles = [shape for shape in document["shapes"] if shape["kind"] == "circle"]
        for component in document["components"]:
            self.assert_filled_bump_row([shape for shape in circles if shape["clip"]["x"] == component["x"]])
        self.assertTrue(all(shape["clip"]["exclusions"] == [] for shape in circles))
        self.assertEqual(snapshot, snapshot_before)
        self.assertEqual(source, before)

    def test_hidden_polygon_deposit_preserves_source_geometry(self):
        lower = bump("lower", PolygonGeometry([
            [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0]],
            [[5, 5, 0], [15, 5, 0], [15, 15, 0], [5, 15, 0]],
        ], 10).json(), "reflowed")
        children = []
        for id, a, b in (("in-hole", [7, 7, 0], [13, 13, 0]),
                         ("overlap", [17, 7, 0], [19, 13, 0])):
            children.append({"id": id, "key": "soc", "bumps": [
                bump(id + "-bump", BoxGeometry(a, b, 6).json(), "joined")],
                "bodies": [{"id": id + "-body", "material": "Si",
                    "geometry": BoxGeometry([a[0], a[1], 6], [b[0], b[1], 6], 50).json()}]})
        snapshot = normalize_geometry_structure({"bumps": [lower], "children": children})
        before = copy.deepcopy(snapshot)
        document = compose_schematic(snapshot, registry())
        self.assertEqual(document["warnings"], [])
        self.assertFalse(any("lower" in item["sourceIds"] for item in document["items"]))
        circles = [shape for shape in document["shapes"] if shape["kind"] == "circle"]
        for component in document["components"]:
            self.assert_filled_bump_row([shape for shape in circles if shape["clip"]["x"] == component["x"]])
        self.assertEqual(snapshot, before)


if __name__ == "__main__":
    unittest.main()
