"""Paired motifs use final PnP geometry, never execution-time drawing state."""
from __future__ import annotations

import copy
import unittest

from process_flow_kernel import BoxGeometry, CylinderGeometry, PolygonGeometry, ProcessGeometryState, ProcessStepContext, normalize_geometry_structure
from process_flow_steps.joint.mr_joint import execute as mr_joint
from process_flow_steps.joint.tcb_joint import execute as tcb_joint
from test_schematic_snapshot_integration import bump, registry
from process_flow_schematic import CONDUCTOR_FILL, SOLDER_FILL, compose_schematic


def snapshot(*, lower_height=20, upper_height=15, x=10):
    return normalize_geometry_structure({"key": "carrier", "bodies": [{
        "id": "carrier", "material": "glass",
        "geometry": BoxGeometry([0, 0, 0], [100, 100, 0], 100).json(),
    }], "bumps": [dict(bump("lower", BoxGeometry([0, 0, 100], [100, 100, 100], lower_height).json(), "reflowed"), material="LowerSolder")],
        "children": [die("die", x, lower_height, upper_height)]})


def die(id, x, lower_height=20, upper_height=15):
    bottom = 100 + lower_height
    return {"id": id, "key": "hbm", "bodies": [{
        "id": id + "-body", "material": "HBM-package",
        "geometry": BoxGeometry([x, 10, bottom + upper_height], [x + 20, 30, bottom + upper_height], 50).json(),
    }], "bumps": [dict(bump(id + "-upper", BoxGeometry([x, 10, bottom], [x + 20, 30, bottom], upper_height).json(), "reflowed"),
                      material="UpperSolder")]}


def motifs(document, source_id, fill=SOLDER_FILL):
    ids = {item["id"] for item in document["items"] if source_id in item["sourceIds"]}
    return [shape for shape in document["shapes"]
            if shape["kind"] == "path" and shape["itemId"] in ids and shape["fill"] == fill]


class PnpSchematicTests(unittest.TestCase):
    def assert_pair(self, document, upper_id="die-upper", lower_id="lower"):
        uppers, lowers = motifs(document, upper_id), motifs(document, lower_id)
        self.assertGreater(len(uppers), 0)
        self.assertEqual(len(uppers), len(lowers))
        component = next(component for component in document["components"] if "die" in component["sourceIds"])
        for upper, lower in zip(uppers, lowers):
            self.assertEqual([point[0] for point in upper["points"]], [point[0] for point in lower["points"]])
            self.assertAlmostEqual(max(point[1] for point in upper["points"]),
                                   min(point[1] for point in lower["points"]))
            for shape in (upper, lower):
                self.assertTrue(shape["closed"])
                self.assertEqual(shape["clip"]["x"], component["x"])
                self.assertEqual(shape["clip"]["width"], component["width"])
                self.assertGreater(min(point[0] for point in shape["points"]), component["x"])
                self.assertLess(max(point[0] for point in shape["points"]), component["x"] + component["width"])
        for source_id, is_upper in ((upper_id, True), (lower_id, False)):
            contacts = motifs(document, source_id, CONDUCTOR_FILL)
            cups = motifs(document, source_id)
            self.assertEqual(len(contacts), len(cups))
            for contact, cup in zip(contacts, cups):
                top, bottom = min(p[1] for p in contact["points"]), max(p[1] for p in contact["points"])
                self.assertAlmostEqual(bottom - top, contact["clip"]["height"] / 3)
                self.assertAlmostEqual(top if is_upper else bottom,
                                       contact["clip"]["y"] + (0 if is_upper else contact["clip"]["height"]))
                self.assertAlmostEqual(bottom if is_upper else top,
                                       min(p[1] for p in cup["points"]) if is_upper else max(p[1] for p in cup["points"]))
        self.assertEqual(document["warnings"], [])

    def test_pair_has_shared_centers_and_correct_source_measurements(self):
        for lower_height, upper_height in ((20, 20), (20, 5), (3, 40)):
            with self.subTest(heights=(lower_height, upper_height)):
                source = snapshot(lower_height=lower_height, upper_height=upper_height)
                before = copy.deepcopy(source)
                document = compose_schematic(source, registry())
                self.assert_pair(document)
                for source_id, material, bottom, thickness in (
                    ("lower", "LowerSolder", 100, lower_height),
                    ("die-upper", "UpperSolder", 100 + lower_height, upper_height),
                ):
                    item = next(item for item in document["items"] if source_id in item["sourceIds"])
                    self.assertEqual(item["material"], material)
                    self.assertEqual((item["zMin"], item["zMax"], item["thickness"]), (bottom, bottom + thickness, thickness))
                self.assertEqual(document["totalThickness"], 150 + lower_height + upper_height)
                self.assertEqual(source, before)

    def test_single_side_deposited_zero_density_and_missing_contact_are_hidden(self):
        base = snapshot()
        cases = []
        for side in ("lower", "upper"):
            for field, value in (("stage", "deposited"), ("density", 0)):
                source = copy.deepcopy(base)
                target = source["root"] if side == "lower" else source["root"]["children"][0]
                target["bumps"][0][field] = value
                cases.append((f"{side}-{field}", source))
            source = copy.deepcopy(base)
            target = source["root"] if side == "lower" else source["root"]["children"][0]
            target["bumps"] = []
            cases.append((f"missing-{side}", source))
        source = copy.deepcopy(base)
        source["root"]["children"] = []
        cases.append(("formation-only", source))
        for x in (100, 110):
            cases.append((f"x={x}", snapshot(x=x)))
        source = copy.deepcopy(base)
        source["root"]["children"][0] = die("die", 10, lower_height=21)
        cases.append(("z-gap", source))
        for name, source in cases:
            with self.subTest(name=name):
                document = compose_schematic(source, registry())
                self.assertFalse(any(shape["kind"] in ("path", "circle") for shape in document["shapes"]))
                self.assertEqual(document["warnings"], [])

    def test_unique_match_and_kernel_contact_tolerance(self):
        source = snapshot()
        lower = source["root"]["bumps"][0]
        second = copy.deepcopy(lower)
        second["id"] = "ambiguous"
        source["root"]["bumps"].append(second)
        self.assertFalse(motifs(compose_schematic(source, registry()), "die-upper"))
        source = snapshot()
        source["root"]["children"][0] = die("die", 10, lower_height=20 + 1e-6)
        self.assert_pair(compose_schematic(source, registry()))

    def test_positive_density_changes_do_not_change_motif_spacing(self):
        source = snapshot()
        reference = compose_schematic(source, registry())
        for density in (1, 100):
            variant = copy.deepcopy(source)
            variant["root"]["bumps"][0]["density"] = density
            variant["root"]["children"][0]["bumps"][0]["density"] = density
            expected = copy.deepcopy(reference)
            for item in expected["items"]:
                if "densityValues" in item:
                    item["densityValues"] = [density]
            self.assertEqual(compose_schematic(variant, registry()), expected)

    def test_true_footprints_handle_circle_boundary_holes_and_overhang(self):
        cases = [
            (CylinderGeometry([0, 0, 100], 50, 20).json(), 45, True),
            (CylinderGeometry([0, 0, 100], 50, 20).json(), 50, False),
            (PolygonGeometry([
                [[0, 0, 100], [100, 0, 100], [100, 100, 100], [0, 100, 100]],
                [[5, 5, 100], [45, 5, 100], [45, 45, 100], [5, 45, 100]],
            ], 20).json(), 10, False),
        ]
        for geometry, x, visible in cases:
            with self.subTest(geometry=geometry["type"], x=x):
                source = snapshot(x=x)
                source["root"]["bumps"][0]["geometry"] = geometry
                document = compose_schematic(source, registry())
                self.assertEqual(bool(motifs(document, "die-upper")), visible)
                self.assertEqual(document["warnings"], [])

    def test_equivalent_pairs_merge_sources_but_not_an_unpaired_die(self):
        source = snapshot()
        source["root"]["children"].extend((die("duplicate", 60), die("unpaired", 150)))
        duplicate = source["root"]["children"][1]
        duplicate["bumps"][0]["material"] += "_dup2"
        duplicate["bumps"][0]["density"] = 99
        document = compose_schematic(source, registry())
        self.assertEqual(len(document["components"]), 2)
        paired = next(component for component in document["components"] if "die" in component["sourceIds"])
        self.assertEqual(paired["sourceIds"], ["die", "duplicate"])
        upper = next(item for item in document["items"] if "die-upper" in item["sourceIds"])
        self.assertEqual(upper["densityValues"], [40, 99])
        self.assertEqual(len(motifs(document, "die-upper")), len(motifs(document, "duplicate-upper")))
        self.assertFalse(motifs(document, "unpaired-upper"))
        self.assert_pair(document)

    def test_different_lower_materials_and_heights_keep_pairs_separate(self):
        source = snapshot()
        source["root"]["bumps"][0]["geometry"] = BoxGeometry([0, 0, 100], [40, 100, 100], 20).json()
        source["root"]["bumps"].append(dict(
            bump("lower2", BoxGeometry([60, 0, 110], [100, 100, 110], 10).json(), "reflowed"), material="OtherSolder"))
        source["root"]["children"].append(die("different", 70))
        document = compose_schematic(source, registry())
        self.assertEqual(len(document["components"]), 2)
        lower2 = next(item for item in document["items"] if "lower2" in item["sourceIds"])
        self.assertEqual((lower2["material"], lower2["zMin"], lower2["thickness"]), ("OtherSolder", 110, 10))

    def test_each_assembly_scope_supports_pairs_inside_a_nested_component(self):
        inner = snapshot()["root"]
        inner["id"] = "nested-assembly"
        inner["key"] = "hbm"
        source = normalize_geometry_structure({"children": [inner]})
        document = compose_schematic(source, registry())
        self.assertTrue(motifs(document, "die-upper"))
        self.assertTrue(motifs(document, "lower"))
        self.assertEqual(document["warnings"], [])

    def test_mr_and_tcb_joint_replace_opposing_cups_with_two_contact_joint(self):
        for execute in (mr_joint, tcb_joint):
            with self.subTest(joint=execute.__module__):
                state = ProcessGeometryState.from_structure(snapshot())
                self.assertTrue(motifs(compose_schematic(state.to_geometry_structure(), registry()), "die-upper"))
                values = {"bump_joined_height": 25}
                execute(ProcessStepContext(state=state, values=values, raw_parameter_values=values,
                    step_ref={}, step_template={}, step_configuration={}, geometry_inputs={},
                    input_geometry=state.to_geometry_structure(), geometry_resolver=lambda port: state))
                after = state.to_geometry_structure()
                document = compose_schematic(after, registry())
                solder = motifs(document, "die-upper")
                contacts = motifs(document, "die-upper", CONDUCTOR_FILL)
                self.assertTrue(solder)
                self.assertEqual(len(contacts), 2 * len(solder))
                for body in solder:
                    height = max(p[1] for p in body["points"]) - min(p[1] for p in body["points"])
                    self.assertAlmostEqual(height, body["clip"]["height"] * 4 / 6)
                for contact in contacts:
                    height = max(p[1] for p in contact["points"]) - min(p[1] for p in contact["points"])
                    self.assertAlmostEqual(height, contact["clip"]["height"] / 6)
                self.assertFalse(any("lower" in item["sourceIds"] for item in document["items"]))
                self.assertEqual(after["root"]["bumps"][0]["stage"], "reflowed")
                self.assertEqual(after["root"]["children"][0]["bumps"][0]["stage"], "joined")


if __name__ == "__main__":
    unittest.main()
