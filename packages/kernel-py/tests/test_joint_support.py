from __future__ import annotations

import copy
import unittest

from process_flow_kernel import BoxGeometry, ConeGeometry, CylinderGeometry, PolygonGeometry, ProcessGeometryState


def box(z, thickness, *, x=0, y=0, width=10, height=10):
    return BoxGeometry([x, y, z], [x + width, y + height, z], thickness)


def body(id, geometry, material="generic solid", key=None):
    result = {"id": id, "geometry": geometry.json(), "material": material}
    if key is not None:
        result["key"] = key
    return result


def bump(id, geometry, stage="reflowed"):
    return {"id": id, "geometry": geometry.json(), "material": "SnAg", "density": 40,
            "stage": stage, "direction": "-z", "koz": 0}


def child(id="die", *, x=0, support=None, upper=None):
    return {"id": id, "bodies": [body(id + "-si", box(436, 200, x=x), "Si"), *(support or [])],
            "bumps": [bump(id + "-bump", upper or box(408, 28, x=x))]}


def state(children=None, supports=None, *, unit="um"):
    return ProcessGeometryState.from_structure({"schemaVersion": "1.0.0", "unitSystem": unit, "root": {
        "id": "assembly",
        "bodies": [body("carrier", box(-350, 700, width=100, height=100), "Glass", "carrier"),
                   body("rdl-1", box(350, 10, width=100, height=100), "PI", "rdl"),
                   body("rdl-2", box(360, 10, width=100, height=100), "PI", "rdl"),
                   body("rdl-3", box(370, 10, width=100, height=100), "PI", "rdl"),
                   *(supports or [])],
        "bumps": [bump("lower", box(380, 28, width=100, height=100))],
        "children": children if children is not None else [child()],
    }})


def interval(node):
    geometry = node["geometry"]
    bottom = geometry["bottom_left"][2] if geometry["type"] == "BoxGeometry" else geometry["center"][2]
    return bottom, bottom + geometry["thk"]


class SupportedJointTests(unittest.TestCase):
    def test_preexisting_uf_preserves_56_um_soh_and_does_not_overlap_rdl(self):
        main = state([child(support=[body("uf", box(408, 28), "UF-A", "uf")])])
        before = main.to_geometry_structure()
        events = []
        self.assertIs(main.join_bumps(joined_height=10, on_height_preserved=events.append), main)
        after = main.to_geometry_structure()
        die = after["root"]["children"][0]
        self.assertEqual(die["bodies"], before["root"]["children"][0]["bodies"])
        self.assertEqual(after["root"]["bodies"], before["root"]["bodies"])
        self.assertEqual(after["root"]["bumps"], before["root"]["bumps"])
        self.assertEqual(interval(die["bumps"][0]), (380, 436))
        self.assertEqual(die["bumps"][0]["stage"], "joined")
        self.assertEqual(die["bumps"][0]["id"], "die-bump")
        self.assertEqual(events, [{"childId": "die", "requestedSoh": 10, "actualSoh": 56,
                                   "unit": "um", "supportMaterials": ["UF-A"]}])
        self.assertEqual(interval(die["bodies"][1]), (408, 436))
        main.join_bumps(joined_height=10, on_height_preserved=events.append)
        self.assertEqual(main.to_geometry_structure(), after)
        self.assertEqual(len(events), 1)

    def test_generic_child_fill_below_upper_bump_is_still_joined(self):
        main = state([child(support=[body("fill", box(380, 56), "custom adhesive")])])
        before = main.to_geometry_structure()
        events = []
        main.join_bumps(joined_height=10, on_height_preserved=events.append)
        die = main.to_geometry_structure()["root"]["children"][0]
        self.assertEqual(die["bodies"], before["root"]["children"][0]["bodies"])
        self.assertEqual(interval(die["bumps"][0]), (380, 436))
        self.assertEqual(events[0]["supportMaterials"], ["custom adhesive"])

    def test_root_sibling_and_nested_support_bodies_are_found(self):
        for location in ("root", "sibling", "nested"):
            with self.subTest(location=location):
                support = body("support", box(390, 5), "unknown material")
                dies = [child()]
                root_supports = []
                if location == "root":
                    root_supports.append(support)
                elif location == "sibling":
                    dies.append({"id": "gap", "children": [{"id": "gap-child", "bodies": [support]}]})
                else:
                    dies[0]["children"] = [{"id": "nested-fill", "bodies": [support]}]
                main = state(dies, root_supports)
                before = main.to_geometry_structure()
                events = []
                main.join_bumps(joined_height=10, on_height_preserved=events.append)
                after = main.to_geometry_structure()
                expected = copy.deepcopy(before)
                expected["root"]["children"][0]["bumps"][0]["geometry"] = box(380, 56).json()
                expected["root"]["children"][0]["bumps"][0]["stage"] = "joined"
                self.assertEqual(after, expected)
                self.assertEqual(events[0]["supportMaterials"], ["unknown material"])

    def test_only_supported_child_retains_height_and_callback_runs_after_batch(self):
        main = state([child("supported", support=[body("uf", box(408, 28), "UF")]), child("free", x=20)])
        events = []

        def receive(event):
            dies = main.to_geometry_structure()["root"]["children"]
            self.assertEqual([die["bumps"][0]["stage"] for die in dies], ["joined", "joined"])
            self.assertEqual(interval(dies[1]["bumps"][0]), (380, 390))
            events.append(event)

        main.join_bumps(joined_height=10, on_height_preserved=receive)
        dies = main.to_geometry_structure()["root"]["children"]
        self.assertEqual(interval(dies[0]["bodies"][0]), (436, 636))
        self.assertEqual(interval(dies[1]["bodies"][0]), (390, 590))
        self.assertEqual([event["childId"] for event in events], ["supported"])

    def test_equal_tolerated_and_larger_requested_heights(self):
        for height, warns in ((56, False), (56 + 5e-6, False), (80, True)):
            with self.subTest(height=height):
                main = state([child(support=[body("uf", box(408, 28), "UF")])])
                events = []
                main.join_bumps(joined_height=height, on_height_preserved=events.append)
                die = main.to_geometry_structure()["root"]["children"][0]
                self.assertEqual(interval(die["bumps"][0]), (380, 436))
                self.assertEqual(len(events), int(warns))
                if warns:
                    self.assertEqual(events[0]["requestedSoh"], 80)
                    self.assertEqual(events[0]["actualSoh"], 56)

    def test_callback_materials_are_sorted_unique_and_keep_original_names_and_unit(self):
        main = state([child(support=[body("a", box(408, 28), "Z-UF_dup2"),
                                           body("b", box(390, 5), "A support"),
                                           body("c", box(410, 5), "Z-UF_dup2")])], unit="mm")
        events = []
        main.join_bumps(joined_height=10, on_height_preserved=events.append)
        self.assertEqual(events[0]["supportMaterials"], ["A support", "Z-UF_dup2"])
        self.assertEqual(events[0]["unit"], "mm")
        self.assertEqual(set(events[0]), {"childId", "requestedSoh", "actualSoh", "unit", "supportMaterials"})

    def test_boundary_contact_disjoint_and_tolerated_z_overlap_do_not_lock(self):
        supports = [
            box(370, 10),             # RDL ending exactly at the lower plane.
            box(436, 20),             # Silicon beginning exactly at the upper plane.
            box(370, 10 + 5e-6),      # Within the shared Z contact tolerance.
            box(390, 5, x=10),        # XY edge contact.
            box(390, 5, x=10, y=10),  # XY point contact.
            box(390, 5, x=20),        # A neighboring component's fill.
        ]
        for geometry in supports:
            with self.subTest(geometry=geometry.json()):
                main = state(supports=[body("other", geometry, "UF")])
                events = []
                main.join_bumps(joined_height=10, on_height_preserved=events.append)
                self.assertEqual(interval(main.to_geometry_structure()["root"]["children"][0]["bumps"][0]), (380, 390))
                self.assertEqual(events, [])

    def test_positive_z_overlap_above_tolerance_locks(self):
        main = state(supports=[body("support", box(370, 10 + 2e-5))])
        events = []
        main.join_bumps(joined_height=10, on_height_preserved=events.append)
        self.assertEqual(events[0]["actualSoh"], 56)

    def test_polygon_holes_and_round_footprints_use_real_regions(self):
        ring = PolygonGeometry([
            [[0, 0, 390], [20, 0, 390], [20, 20, 390], [0, 20, 390]],
            [[2, 2, 390], [2, 18, 390], [18, 18, 390], [18, 2, 390]],
        ], 5)
        cases = [
            (box(408, 28, x=5, y=5, width=5, height=5), ring, False),
            (box(408, 28, x=1, y=5, width=5, height=5), ring, True),
            (CylinderGeometry([0, 0, 408], 5, 28), box(390, 5, x=4, y=4, width=1, height=1), False),
            (CylinderGeometry([0, 0, 408], 5, 28), box(390, 5, x=1, y=1, width=1, height=1), True),
            (ConeGeometry([0, 0, 408], 1, 5, 28), box(390, 5, x=1, y=1, width=1, height=1), True),
            (box(408, 28, x=0, y=0, width=1, height=1), CylinderGeometry([4, 4, 390], 1, 5), False),
            (box(408, 28, x=0, y=0, width=1, height=1), CylinderGeometry([1, 1, 390], 1, 5), True),
        ]
        for upper, support, locked in cases:
            with self.subTest(upper=upper.json(), support=support.json()):
                main = state([child(upper=upper)], [body("support", support)])
                events = []
                main.join_bumps(joined_height=10, on_height_preserved=events.append)
                self.assertEqual(len(events), int(locked))
                result = main.to_geometry_structure()["root"]["children"][0]["bumps"][0]
                self.assertEqual(interval(result), (380, 436 if locked else 390))

    def test_support_uses_union_of_paired_upper_footprints_including_overhang(self):
        for multiple in (False, True):
            with self.subTest(multiple=multiple):
                die = child(x=95)
                if multiple:
                    die["bumps"].append(bump("second-upper", box(408, 28, x=105)))
                    root_lower = bump("second-lower", box(380, 28, x=105))
                    support_x = 110
                else:
                    support_x = 102  # Outside the lower projection but within the upper.
                main = state([die], [body("support", box(390, 5, x=support_x, width=2))])
                if multiple:
                    payload = main.to_geometry_structure()
                    payload["root"]["bumps"].append(root_lower)
                    main = ProcessGeometryState.from_structure(payload)
                events = []
                main.join_bumps(joined_height=10, on_height_preserved=events.append)
                result = main.to_geometry_structure()["root"]["children"][0]
                self.assertTrue(all(interval(node) == (380, 436) for node in result["bumps"]))
                self.assertEqual(len(events), 1)

    def test_later_pairing_failure_is_atomic_and_emits_no_warning(self):
        main = state([child("supported", support=[body("uf", box(408, 28), "UF")]), child("ambiguous", x=20)])
        payload = main.to_geometry_structure()
        payload["root"]["bumps"].append(bump("extra-lower", box(380, 28, x=20)))
        main = ProcessGeometryState.from_structure(payload)
        before = main.to_geometry_structure()
        cursor, footprint = main.cursor_z(), main.process_footprint()
        events = []
        with self.assertRaisesRegex(ValueError, "multiple lower"):
            main.join_bumps(joined_height=10, on_height_preserved=events.append)
        self.assertEqual(main.to_geometry_structure(), before)
        self.assertEqual(main.cursor_z(), cursor)
        self.assertEqual(main.process_footprint(), footprint)
        self.assertEqual(events, [])

    def test_repeat_joint_does_not_select_a_higher_reflowed_bump_layer(self):
        die = child(support=[body("uf", box(380, 56), "UF")])
        die["bumps"].append(bump("top-upper", box(500, 10)))
        main = state([die])
        payload = main.to_geometry_structure()
        payload["root"]["bumps"].append(bump("top-lower", box(480, 20)))
        main = ProcessGeometryState.from_structure(payload)
        events = []
        main.join_bumps(joined_height=10, on_height_preserved=events.append)
        after = main.to_geometry_structure()
        main.join_bumps(joined_height=10, on_height_preserved=events.append)
        self.assertEqual(main.to_geometry_structure(), after)
        self.assertEqual(after["root"]["children"][0]["bumps"][1]["stage"], "reflowed")
        self.assertEqual(len(events), 1)


if __name__ == "__main__":
    unittest.main()
