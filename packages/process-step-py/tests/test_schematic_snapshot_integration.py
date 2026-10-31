"""Final-state composition through actual generator and process presenters."""
from __future__ import annotations

import copy
import unittest

from process_flow_geometry_generators import GeometryGeneratorRegistry, register_builtin_generators
from process_flow_geometry_generators.schematic_presenters import register_presenters as register_generator_presenters
from process_flow_kernel import BoxGeometry, PolygonGeometry, ProcessGeometryState, normalize_geometry_structure
from process_flow_kernel.application.material_instances import rewrite_geometry_materials
from process_flow_schematic import SchematicRegistry, compose_schematic
from process_flow_steps.schematic_presenters import register_presenters as register_step_presenters


def registry():
    result = SchematicRegistry()
    register_step_presenters(result)
    register_generator_presenters(result)
    return result


def bump(id, geometry, stage):
    return {"id": id, "geometry": geometry, "material": "SnAg", "density": 40,
            "stage": stage, "direction": "+z", "koz": 0}


class SchematicSnapshotIntegrationTests(unittest.TestCase):
    def test_partial_width_joint_preserves_unjoined_subcolumn(self):
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
        row = next(item for item in document["items"] if "lower" in item["sourceIds"])
        symbols = [shape for shape in document["shapes"] if shape["itemId"] == row["id"]]
        self.assertEqual(len(symbols), 3)
        for symbol in symbols:
            exclusions = symbol["clip"]["exclusions"]
            self.assertEqual(len(exclusions), 1)
            self.assertEqual(exclusions[0]["x"], component["x"])
            self.assertEqual(exclusions[0]["width"], component["width"] / 4)
            unjoined_x = component["x"] + component["width"] * 0.75
            self.assertFalse(any(cut["x"] <= unjoined_x <= cut["x"] + cut["width"] for cut in exclusions))
        unjoined_row = next(item for item in document["items"] if "unjoined" in item["sourceIds"])
        self.assertEqual(len([shape for shape in document["shapes"] if shape["itemId"] == unjoined_row["id"]]), 3)

    def test_grouped_runtime_material_instances_share_measurements_and_symbols(self):
        source = normalize_geometry_structure({"key": "lsi", "bodies": [
            {"id": "rdl", "key": "rdl", "material": "PI", "geometry": BoxGeometry([0, 0, 2], [10, 10, 2], 5).json()},
            {"id": "silicon", "material": "Si", "geometry": BoxGeometry([0, 0, 7], [10, 10, 7], 10).json()},
        ], "vias": [{"id": "via", "material": "Cu", "density": 1, "direction": "+z", "koz": 0,
                      "geometry": BoxGeometry([0, 0, 2], [10, 10, 2], 5).json()}],
            "bumps": [bump("bump", BoxGeometry([0, 0, 0], [10, 10, 0], 2).json(), "reflowed")]})
        main = ProcessGeometryState.create()
        main.initialize_box_layer(material="Carrier", bottom_left=[0, 0, 0], top_right=[100, 100, 0], thickness=100)
        for x, suffix in ((0, ""), (30, "_dup2")):
            renamed, _ = rewrite_geometry_materials(source, {material: material + suffix for material in ("PI", "Si", "Cu", "SnAg")})
            renamed["root"]["vias"][0]["density"] = 1 if not suffix else 99
            main.place_geometry_state(ProcessGeometryState.from_structure(renamed), x=x, y=0, bottom_z=100)
        snapshot = main.to_geometry_structure()
        document = compose_schematic(snapshot, registry())
        self.assertEqual(document["warnings"], [])
        self.assertEqual(len(document["components"]), 3)
        lsi_items = [item for item in document["items"] if item["groupLabel"] == "LSI"]
        self.assertEqual(len(lsi_items), 4)
        self.assertTrue(all(len(item["sourceIds"]) == 2 for item in lsi_items))
        self.assertEqual(len([shape for shape in document["shapes"] if shape["kind"] == "circle"]), 9)

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
        uf_shapes = [shape for shape in document["shapes"] if shape["fill"] == "#efc490"]
        self.assertEqual(len(uf_shapes), 5)  # Three cavities and two representative gaps.
        lower_id = snapshot["root"]["bumps"][0]["id"]
        lower_item = next(item for item in document["items"] if lower_id in item["sourceIds"])
        lower_symbols = [shape for shape in document["shapes"] if shape["itemId"] == lower_item["id"]]
        self.assertEqual(len(lower_symbols), 3)
        self.assertTrue(all(len(shape["clip"]["exclusions"]) == 3 for shape in lower_symbols))
        self.assertEqual(snapshot, snapshot_before)
        self.assertEqual(source, before)

    def test_frozen_snapshot_preserves_polygon_holes_when_resolving_ownership(self):
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
        document = compose_schematic(snapshot, registry())
        self.assertEqual(document["warnings"], [])
        row = next(item for item in document["items"] if "lower" in item["sourceIds"])
        symbols = [shape for shape in document["shapes"] if shape["itemId"] == row["id"]]
        self.assertEqual(len(symbols), 3)
        overlap_component = next(component for component in document["components"] if "overlap" in component["sourceIds"])
        for symbol in symbols:
            self.assertEqual(len(symbol["clip"]["exclusions"]), 1)
            self.assertEqual(symbol["clip"]["exclusions"][0]["x"], overlap_component["x"])


if __name__ == "__main__":
    unittest.main()
