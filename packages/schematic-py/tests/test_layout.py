import copy
import math
import unittest
from dataclasses import FrozenInstanceError

from process_flow_schematic import (
    ComponentHint, SchematicLayoutGroup, SchematicLayoutPlan, SchematicPart,
    SchematicRegistry, SchematicSlot, compose_schematic, describe_schematic_components,
    make_layout_plan,
)


def body(node_id, z=0, thickness=100, *, material="Si", key=None):
    result = {"id": node_id, "material": material, "geometry": {
        "type": "BoxGeometry", "bottom_left": [0, 0, z], "top_right": [100, 100, z], "thk": thickness}}
    if key:
        result["key"] = key
    return result


def die(node_id, *, thickness=20, z=100, material="Si"):
    return {"id": node_id, "key": "die", "bodies": [body(f"{node_id}-body", z, thickness, material=material)]}


def structure(*children, bridge=False):
    bodies = [body("carrier", thickness=100, material="glass")]
    if bridge:
        bodies.append(body("uf", z=100, thickness=10, material="UF", key="bridge"))
    return {"unitSystem": "um", "root": {"id": "root", "bodies": bodies, "children": list(children)}}


def registry(*, eligible=()):
    result = SchematicRegistry()
    result.register("container", lambda context: [SchematicPart("Die", component=ComponentHint("Die"))], key="die")
    result.register("body", lambda context: [SchematicPart("UF", fill="#112233", layout="bridges",
                                                          eligible_container_ids=eligible)], key="bridge")
    return result


def plan(*keys):
    return make_layout_plan([SchematicLayoutGroup(key, ComponentHint("Die")) for key in keys])


class LayoutPlanTests(unittest.TestCase):
    def test_reserves_center_and_edge_slots_with_immutable_identity(self):
        groups = [SchematicLayoutGroup("soc", ComponentHint("SoC")),
                  SchematicLayoutGroup("hbm", ComponentHint("HBM")),
                  SchematicLayoutGroup("dummy", ComponentHint("DMY", 2, "edges"))]
        layout = make_layout_plan(groups, fingerprint="flow-revision", notes=["Shared flow layout"])
        self.assertEqual([slot.group_key for slot in layout.slots], ["dummy", "soc", "hbm", "dummy"])
        self.assertEqual([slot.width for slot in layout.slots], [224, 320, 320, 224])
        self.assertEqual(len({slot.id for slot in layout.slots}), 4)
        self.assertEqual(layout, make_layout_plan(groups, fingerprint="flow-revision", notes=["Shared flow layout"]))
        self.assertEqual(layout.notes, ("Shared flow layout",))
        with self.assertRaises(FrozenInstanceError):
            layout.width = 123
        with self.assertRaises(FrozenInstanceError):
            layout.slots[0].x = 123

    def test_odd_and_large_edge_counts_do_not_overlap_center_slots(self):
        for count in (1, 3, 11, 13, 100):
            with self.subTest(count=count):
                layout = make_layout_plan([SchematicLayoutGroup("edge", ComponentHint("Edge", count, "edges")),
                                           SchematicLayoutGroup("center", ComponentHint("Center"))])
                self.assertEqual(len(layout.slots), min(12, count) + 1)
                for left, right in zip(layout.slots, layout.slots[1:]):
                    self.assertLess(left.x + left.width, right.x)

    def test_rejects_duplicate_groups_and_invalid_manual_slots(self):
        with self.assertRaises(ValueError):
            make_layout_plan([SchematicLayoutGroup("same", ComponentHint("A")),
                              SchematicLayoutGroup("same", ComponentHint("B"))])
        invalid = [SchematicLayoutPlan((), math.nan),
                   SchematicLayoutPlan((SchematicSlot("a", "a", -1, 20),), 1000),
                   SchematicLayoutPlan((SchematicSlot("a", "a", 10, 30), SchematicSlot("b", "b", 20, 30)), 1000),
                   SchematicLayoutPlan((), 1000, support_width=2000)]
        for layout in invalid:
            with self.subTest(layout=layout), self.assertRaises(ValueError):
                compose_schematic(structure(), registry(), layout_plan=layout)

    def test_plan_keeps_existing_die_and_carrier_x_when_future_dies_appear(self):
        layout = make_layout_plan([SchematicLayoutGroup("soc", ComponentHint("SoC")),
                                   SchematicLayoutGroup("hbm", ComponentHint("HBM"))], notes=["Fixed slots"])
        before_source = structure(die("soc"))
        original = copy.deepcopy(before_source)
        before = compose_schematic(before_source, registry(), layout_plan=layout,
                                   component_bindings={"soc": "soc"})
        after = compose_schematic(structure(die("soc"), die("hbm", thickness=80)), registry(), layout_plan=layout,
                                  component_bindings={"soc": "soc", "hbm": "hbm"})
        self.assertEqual(before_source, original)
        self.assertEqual(before["viewBox"][2], after["viewBox"][2])
        first, retained = before["components"][0], next(c for c in after["components"] if c["id"] == before["components"][0]["id"])
        self.assertEqual((first["x"], first["width"]), (retained["x"], retained["width"]))
        for document in (before, after):
            carrier_item = next(item for item in document["items"] if item["sourceIds"] == ["carrier"])
            shape = next(shape for shape in document["shapes"] if shape["itemId"] == carrier_item["id"])
            self.assertEqual((shape["x"], shape["width"]), (36, layout.width - 72))
        self.assertFalse(any("hbm" in source for item in before["items"] for source in item["sourceIds"]))
        self.assertEqual(len(before["components"]), 1)
        self.assertIn("Fixed slots", before["notes"])

    def test_fixed_cohort_draws_first_remaining_instance_and_retains_all_measurements(self):
        layout = plan("pnp")
        source = structure(die("first", thickness=20), die("second", thickness=35, material="Si_dup2"))
        document = compose_schematic(source, registry(), layout_plan=layout,
                                     component_bindings={"first": "pnp", "second": "pnp"})
        self.assertEqual(document["components"][0]["sourceIds"], ["first", "second"])
        self.assertEqual(len(document["components"]), 1)
        self.assertEqual(len(document["shapes"]), 2)  # Carrier and one representative.
        measurements = [item for item in document["items"] if item["groupLabel"] == "Die"]
        self.assertEqual({item["thickness"] for item in measurements}, {20, 35})
        self.assertTrue(any("different instance structures" in note for note in document["notes"]))
        survivor = compose_schematic(structure(die("second", thickness=35)), registry(), layout_plan=layout,
                                     component_bindings={"second": "pnp"})
        self.assertEqual(document["components"][0]["id"], survivor["components"][0]["id"])
        self.assertEqual(document["components"][0]["x"], survivor["components"][0]["x"])
        self.assertFalse(any("different instance structures" in note for note in survivor["notes"]))

    def test_equivalent_cohort_instances_merge_measurements_without_a_heterogeneity_note(self):
        document = compose_schematic(structure(die("first"), die("second", material="Si_dup2")), registry(),
                                     layout_plan=plan("pnp"), component_bindings={"first": "pnp", "second": "pnp"})
        self.assertEqual(len(document["components"]), 1)
        self.assertTrue(any(item["sourceIds"] == ["first-body", "second-body"] for item in document["items"]))
        self.assertFalse(any("different instance structures" in note for note in document["notes"]))

    def test_custom_support_span_is_respected(self):
        layout = SchematicLayoutPlan((), 1200, support_x=80, support_width=1000)
        document = compose_schematic(structure(), registry(), layout_plan=layout)
        self.assertEqual((document["shapes"][0]["x"], document["shapes"][0]["width"]), (80, 1000))

    def test_blank_or_ineligible_slots_block_bridges_without_hiding_current_measurements(self):
        layout = plan("a", "b", "c")
        bindings = {key: key for key in ("a", "b", "c")}
        absent = compose_schematic(structure(die("a"), die("c"), bridge=True), registry(eligible=("a", "c")),
                                   layout_plan=layout, component_bindings=bindings)
        ineligible = compose_schematic(structure(die("a"), die("b"), die("c"), bridge=True), registry(eligible=("a", "c")),
                                       layout_plan=layout, component_bindings=bindings)
        complete = compose_schematic(structure(die("a"), die("b"), die("c"), bridge=True), registry(eligible=("a", "b", "c")),
                                     layout_plan=layout, component_bindings=bindings)
        self.assertFalse(any(shape["fill"] == "#112233" for shape in absent["shapes"]))
        self.assertFalse(any(shape["fill"] == "#112233" for shape in ineligible["shapes"]))
        self.assertEqual(sum(shape["fill"] == "#112233" for shape in complete["shapes"]), 2)
        self.assertTrue(any(item["sourceIds"] == ["uf"] for item in absent["items"]))

    def test_unbound_components_keep_measurements_without_resizing_the_plan(self):
        layout = plan("reserved")
        document = compose_schematic(structure(die("unknown")), registry(), layout_plan=layout)
        self.assertEqual(document["viewBox"][2], layout.width)
        self.assertEqual(document["components"], [])
        self.assertEqual(len(document["shapes"]), 1)
        self.assertTrue(any(item["sourceIds"] == ["unknown-body"] for item in document["items"]))
        self.assertTrue(any("no reserved schematic slot" in warning for warning in document["warnings"]))

    def test_descriptions_use_the_same_selection_and_preserve_each_physical_id(self):
        first = die("first")
        first["children"] = [die("internal")]
        source = structure(first, die("second"))
        before = copy.deepcopy(source)
        descriptions = describe_schematic_components(source, registry())
        self.assertEqual(descriptions, {"first": ComponentHint("Die"), "second": ComponentHint("Die")})
        document = compose_schematic(source, registry())
        self.assertEqual(document["components"][0]["sourceIds"], ["first"])
        self.assertEqual(set(source_id for component in document["components"] for source_id in component["sourceIds"]),
                         set(descriptions))
        self.assertEqual(source, before)


if __name__ == "__main__":
    unittest.main()
