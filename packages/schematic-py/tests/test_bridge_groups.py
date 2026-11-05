"""Physical fill connectivity projected onto fixed representative slots."""
import copy
import json
import unittest

from process_flow_schematic import (
    ComponentHint, SchematicLayoutGroup, SchematicLayoutPlan, SchematicPart, SchematicRegistry, SchematicSlot,
    compose_schematic, make_layout_plan,
)


FILL = "#123456"


def body(identifier, *, key=None):
    result = {"id": identifier, "material": "Fill" if key else "Si", "geometry": {
        "type": "BoxGeometry", "bottom_left": [0, 0, 100],
        "top_right": [10, 10, 100], "thk": 10 if key else 20,
    }}
    if key:
        result["key"] = key
    return result


def source(*names):
    return {"unitSystem": "um", "root": {
        "id": "root", "bodies": [body("fill", key="fill")], "children": [
            {"id": name, "key": "die", "bodies": [body(f"{name}-body")]} for name in names
        ],
    }}


def registry(groups):
    result = SchematicRegistry()
    result.register("container", lambda context: [SchematicPart("Die", component=ComponentHint("Die"))], key="die")
    result.register("body", lambda context: [SchematicPart(
        "Fill", fill=FILL, layout="bridges", bridge_groups=groups)], key="fill")
    return result


def compose(structure, groups, slots, bindings):
    return compose_schematic(
        structure, registry(groups),
        layout_plan=make_layout_plan([SchematicLayoutGroup(key, ComponentHint("Die")) for key in slots]),
        component_bindings=bindings,
    )


def bridges(document):
    return [shape for shape in document["shapes"] if shape["fill"] == FILL]


class BridgeGroupTests(unittest.TestCase):
    def test_disconnected_fill_regions_do_not_connect_adjacent_unrelated_groups(self):
        structure = source("a", "b", "c", "d")
        before = copy.deepcopy(structure)
        document = compose(structure, (("a", "b"), ("c", "d")),
                           ("a", "b", "c", "d"), {key: key for key in "abcd"})
        components = document["components"]
        self.assertEqual([(shape["x"], shape["width"]) for shape in bridges(document)], [
            (components[index]["x"] + components[index]["width"],
             components[index + 1]["x"] - components[index]["x"] - components[index]["width"])
            for index in (0, 2)
        ])
        self.assertEqual(document["warnings"], [])
        self.assertFalse(any("retained fill connects" in note for note in document["notes"]))
        self.assertEqual(structure, before)
        json.dumps(document, allow_nan=False)

    def test_nonfirst_cohort_member_still_participates_in_physical_fill(self):
        document = compose(source("first", "second", "other"), (("second", "other"),),
                           ("batch", "other"), {"first": "batch", "second": "batch", "other": "other"})
        self.assertEqual(len(bridges(document)), 1)
        self.assertEqual(document["components"][0]["sourceIds"], ["first", "second"])
        self.assertTrue(any(item["sourceIds"] == ["first-body", "second-body"] for item in document["items"]))
        self.assertEqual(document["warnings"], [])

    def test_lower_region_overlapping_slot_does_not_block_upper_region_bridge(self):
        structure = source("a", "lower", "b")
        lower_body = structure["root"]["children"][1]["bodies"][0]
        lower_body["geometry"]["bottom_left"][2] = 0
        lower_body["geometry"]["top_right"][2] = 0
        layout = SchematicLayoutPlan((
            SchematicSlot("upper-a", "a", 180, 320, "upper"),
            SchematicSlot("lower", "lower", 358, 320, "lower"),
            SchematicSlot("upper-b", "b", 536, 320, "upper"),
        ), width=1072)
        document = compose_schematic(structure, registry((("a", "b"),)), layout_plan=layout,
                                     component_bindings={key: key for key in ("a", "lower", "b")})
        bridge, = bridges(document)
        self.assertEqual((bridge["x"], bridge["width"]), (500, 36))
        self.assertEqual([(component["x"], component["width"]) for component in document["components"]],
                         [(slot.x, slot.width) for slot in layout.slots])
        self.assertFalse(any("retained fill connects" in note for note in document["notes"]))
        self.assertEqual(document["warnings"], [])

    def test_relation_emitted_by_nonfirst_instance_is_not_discarded(self):
        structure = source("first", "second", "other")
        fill = structure["root"].pop("bodies")[0]
        structure["root"]["children"][1]["bodies"].append(fill)
        document = compose(structure, (("second", "other"),), ("batch", "other"),
                           {"first": "batch", "second": "batch", "other": "other"})
        self.assertEqual(len(bridges(document)), 1)
        self.assertTrue(any(item["sourceIds"] == ["fill"] for item in document["items"]))

    def test_imported_wrapper_resolves_only_an_unambiguous_component(self):
        structure = source("a", "b")
        first = structure["root"]["children"][0]
        structure["root"]["children"][0] = {"id": "wrapper", "children": [first]}
        document = compose(structure, (("wrapper", "b"),), ("a", "b"), {"a": "a", "b": "b"})
        self.assertEqual(len(bridges(document)), 1)
        # A wrapper touching fill does not imply that every one of its selected
        # descendants touches it. Ambiguous endpoints remain explicitly noted.
        structure["root"]["children"][0]["children"].append(
            {"id": "c", "key": "die", "bodies": [body("c-body")]})
        document = compose(structure, (("wrapper", "b"),),
                           ("a", "b", "c"), {key: key for key in "abc"})
        self.assertEqual(bridges(document), [])
        self.assertTrue(any("retained fill connects" in note for note in document["notes"]))

    def test_reserved_and_occupied_slots_block_bridges_but_keep_connection_notes(self):
        for current in (("a", "c"), ("a", "b", "c")):
            with self.subTest(current=current):
                document = compose(source(*current), (("a", "c"),),
                                   ("a", "b", "c"), {key: key for key in current})
                self.assertEqual(bridges(document), [])
                self.assertTrue(any(item["sourceIds"] == ["fill"] for item in document["items"]))
                self.assertTrue(any("retained fill connects Die · 1, Die · " in note
                                    and "nonadjacent slots" in note for note in document["notes"]))
                self.assertEqual(document["warnings"], [])

    def test_merged_endpoints_do_not_invent_a_bridge_between_illustrative_copies(self):
        document = compose(source("first", "second"), (("first", "second"),),
                           ("batch",), {"first": "batch", "second": "batch"})
        self.assertEqual(len(document["components"]), 1)
        self.assertEqual(bridges(document), [])
        self.assertTrue(any("Die (2 instances)" in note and "merged representatives" in note
                            for note in document["notes"]))
        self.assertTrue(any(item["sourceIds"] == ["fill"] for item in document["items"]))

    def test_retained_fill_without_two_surviving_endpoints_keeps_measurements(self):
        for groups in (((),), (("a",),)):
            with self.subTest(groups=groups):
                document = compose(source("a"), groups, ("a",), {"a": "a"})
                self.assertEqual(bridges(document), [])
                self.assertTrue(any(item["sourceIds"] == ["fill"] for item in document["items"]))
                self.assertTrue(any("without two current endpoints" in note for note in document["notes"]))

    def test_invalid_connectivity_falls_back_without_losing_source(self):
        for groups in ((("missing", "a"),), (("", "a"),), ((1, "a"),), ("a",), [["a"]]):
            with self.subTest(groups=groups):
                document = compose_schematic(source("a"), registry(groups))
                self.assertEqual(len(document["warnings"]), 1)
                self.assertTrue(any(item["sourceIds"] == ["fill"] for item in document["items"]))


if __name__ == "__main__":
    unittest.main()
