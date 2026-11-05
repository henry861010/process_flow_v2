import unittest
from dataclasses import replace

from process_flow_schematic.scene import (
    AnchorRef, LayoutRegion, SceneDerivation, SceneRelation, SceneState,
    SchematicDelta, SchematicObject, apply_delta,
)
from process_flow_schematic.scene_layout import (
    SceneLayoutPolicy, _centers, make_scene_layout_plan, merge_scene_states, subtract_intervals,
)


def scene():
    return SceneState(objects=(SchematicObject("assembly", "assembly", "package", "Assembly"),),
                      regions=(LayoutRegion("mount", "assembly"),), cursor_region_id="mount")


def member(id_, role="soc", **kwargs):
    return SchematicObject(id_, "component", role, role, parent_id="assembly", layout="member", region_id="mount", **kwargs)


def feature(id_, layout="distributed"):
    return SchematicObject(id_, "feature", id_, id_, parent_id="assembly", source_ref=f"source:{id_}", layout=layout, region_id="mount")


class SceneLayoutTests(unittest.TestCase):
    def test_distribution_is_equal_along_cumulative_available_length(self):
        self.assertEqual(_centers(((0, 100), (200, 400)), 4, 12),
                         (37.5, 212.5, 287.5, 362.5))

    def test_distribution_retains_full_count_at_boundaries_and_narrow_intervals(self):
        intervals = ((0, 100), (200, 300))
        centers = _centers(intervals, 9, 12)
        self.assertEqual(len(centers), 9)
        self.assertTrue(all(any(lower <= center - 6 and center + 6 <= upper for lower, upper in intervals)
                            for center in centers))
        self.assertTrue(all(right - left >= 18 for left, right in zip(centers, centers[1:])))
        # An interval exactly as wide as one symbol has capacity one; smaller
        # intervals have none. Fragmentation alone must not lose the budget.
        narrow = ((0, 5), *(tuple((20 + index * 20, 32 + index * 20)) for index in range(9)))
        self.assertEqual(_centers(narrow, 9, 12), tuple(26 + index * 20 for index in range(9)))
        self.assertEqual(_centers(((0, 10),), 9, 12), ())

    def test_fractional_distribution_bounds_do_not_lose_a_feasible_symbol(self):
        intervals = ((15.899035649961045, 132.5621419885588),
                     (188.59329687422795, 288.1916336435769),
                     (298.9100364571791, 446.4241815382336))
        width = 26.869979191890852
        centers = _centers(intervals, 9, width)
        self.assertEqual(len(centers), 8)
        self.assertTrue(all(right - left >= width * 1.5 - 1e-9 for left, right in zip(centers, centers[1:])))
        self.assertTrue(all(any(lower - 1e-9 <= center - width / 2 and center + width / 2 <= upper + 1e-9
                                for lower, upper in intervals) for center in centers))

    def test_full_history_reserves_slots_and_distributed_features_before_future_pnp(self):
        tiv = apply_delta(scene(), SchematicDelta(creates=(feature("tiv"),)))
        soc = apply_delta(tiv, SchematicDelta(creates=(member("soc"),)))
        hbm = apply_delta(soc, SchematicDelta(creates=(member("hbm", "hbm"),)))
        plan = make_scene_layout_plan((tiv, soc, hbm))
        self.assertEqual([slot.object_id for slot in plan.slots], ["soc", "hbm"])
        self.assertEqual(len(plan.features[0].centers), 9)
        for center in plan.features[0].centers:
            for slot in plan.slots:
                self.assertFalse(slot.x - 6 <= center <= slot.x + slot.width + 6)
        # Removing a source later never compacts earlier slots or symbols.
        removed = apply_delta(hbm, SchematicDelta(removes=("soc",)))
        later = make_scene_layout_plan((tiv, soc, hbm, removed))
        self.assertEqual(plan.slots, later.slots)
        self.assertEqual(plan.features, later.features)

    def test_kernel_policy_uses_one_lsi_and_two_edge_dummy_representatives(self):
        state = apply_delta(scene(), SchematicDelta(creates=(member("lsi", "lsi"), member("dummy", "wafer-dmy"))))
        plan = make_scene_layout_plan(state)
        dummy = [slot for slot in plan.slots if slot.object_id == "dummy"]
        lsi = next(slot for slot in plan.slots if slot.object_id == "lsi")
        self.assertEqual(len(dummy), 2)
        self.assertEqual(len(plan.slots), 3)
        self.assertLess(dummy[0].x, lsi.x)
        self.assertGreater(dummy[1].x, lsi.x)
        region = plan.regions[0]
        self.assertEqual(dummy[0].x - region.x, SceneLayoutPolicy().edge_inset)
        self.assertEqual(region.x + region.width - dummy[1].x - dummy[1].width,
                         SceneLayoutPolicy().edge_inset)

    def test_edge_dummies_leave_the_full_free_feature_budget_between_them(self):
        for count in (0, 1, 4):
            with self.subTest(center_members=count):
                initial = apply_delta(scene(), SchematicDelta(creates=(feature("tiv"),)))
                placed = apply_delta(initial, SchematicDelta(creates=(
                    member("dummy", "wafer-dmy"), *(member(f"die-{index}") for index in range(count)))))
                plan = make_scene_layout_plan((initial, placed))
                left, right = sorted((slot for slot in plan.slots if slot.object_id == "dummy"),
                                     key=lambda slot: slot.x)
                tiv = plan.features[0]
                self.assertEqual(len(tiv.centers), 9)
                self.assertFalse(plan.notes)
                self.assertTrue(all(left.x + left.width < lower < upper < right.x
                                    for lower, upper in tiv.intervals))
                self.assertTrue(all(left.x + left.width < center - tiv.width / 2
                                    and center + tiv.width / 2 < right.x for center in tiv.centers))
                for center in tiv.centers:
                    self.assertTrue(all(center + tiv.width / 2 < slot.x
                                        or center - tiv.width / 2 > slot.x + slot.width
                                        for slot in plan.slots))
                removed = apply_delta(placed, SchematicDelta(removes=("dummy",)))
                self.assertEqual(plan, make_scene_layout_plan((initial, placed, removed)))

    def test_edge_keepouts_follow_custom_inset_without_reducing_feature_budget(self):
        state = apply_delta(scene(), SchematicDelta(creates=(
            member("dummy", "wafer-dmy"), member("soc"), feature("tiv"))))
        for inset in (18, 72, 180):
            with self.subTest(edge_inset=inset):
                policy = SceneLayoutPolicy(edge_inset=inset)
                plan = make_scene_layout_plan(state, policy=policy)
                left, right = sorted((slot for slot in plan.slots if slot.object_id == "dummy"),
                                     key=lambda slot: slot.x)
                region = plan.regions[0]
                self.assertEqual(left.x - region.x, inset)
                self.assertEqual(region.x + region.width - right.x - right.width, inset)
                tiv = plan.features[0]
                self.assertEqual(len(tiv.centers), policy.feature_count)
                self.assertTrue(all(left.x + left.width < lower < upper < right.x
                                    for lower, upper in tiv.intervals))
                self.assertFalse(plan.notes)

    def test_same_class_in_two_pnp_batches_stays_separate_and_regions_do_not_mix(self):
        state = apply_delta(scene(), SchematicDelta(
            creates=(member("first", class_key="same"), member("second", class_key="same"),
                     replace(member("upper", class_key="same"), region_id="upper")),
            add_regions=(LayoutRegion("upper", "assembly", anchor="upper-surface"),)))
        plan = make_scene_layout_plan(state)
        self.assertEqual(len(plan.slots), 3)
        self.assertNotEqual(plan.slots[0].group_key, plan.slots[1].group_key)
        upper = next(slot for slot in plan.slots if slot.object_id == "upper")
        self.assertAlmostEqual(upper.x + upper.width / 2, plan.width / 2)

    def test_structural_composite_preserves_children_inside_one_representative(self):
        hbm = member("hbm", "hbm")
        dram = replace(member("dram", "dram"), parent_id="hbm", region_id="inside")
        state = apply_delta(scene(), SchematicDelta(creates=(hbm, dram), add_regions=(LayoutRegion("inside", "hbm"),)))
        plan = make_scene_layout_plan(state)
        self.assertEqual([slot.object_id for slot in plan.slots], ["hbm"])
        inside = next(region for region in plan.regions if region.region_id == "inside")
        self.assertEqual((inside.x, inside.width), (plan.slots[0].x, plan.slots[0].width))

    def test_arranged_composite_recursively_allocates_local_members(self):
        cow = member("cow", "cow", nesting="arranged")
        children = tuple(replace(member(id_), parent_id="cow", region_id="inside") for id_ in ("soc", "hbm"))
        state = apply_delta(scene(), SchematicDelta(creates=(cow, *children), add_regions=(LayoutRegion("inside", "cow"),)))
        plan = make_scene_layout_plan(state)
        outer = next(slot for slot in plan.slots if slot.object_id == "cow")
        inner = [slot for slot in plan.slots if slot.region_id == "inside"]
        self.assertEqual(len(inner), 2)
        self.assertTrue(all(outer.x <= slot.x < slot.x + slot.width <= outer.x + outer.width for slot in inner))

    def test_later_region_expands_the_whole_assembly_and_stays_inside_canvas(self):
        state = apply_delta(scene(), SchematicDelta(
            creates=tuple(replace(member(f"die-{index}"), region_id="later") for index in range(8)),
            add_regions=(LayoutRegion("later", "assembly", parent_region_id="mount"),)))
        plan = make_scene_layout_plan(state)
        self.assertGreater(plan.width, 8 * 320)
        self.assertTrue(all(0 <= slot.x < slot.x + slot.width <= plan.width for slot in plan.slots))

    def test_structural_features_use_the_member_slot_even_with_shared_source_region(self):
        state = apply_delta(scene(), SchematicDelta(
            creates=(member("hbm", "hbm"), member("soc"), replace(feature("tsv"), parent_id="hbm"))))
        plan = make_scene_layout_plan(state)
        hbm = next(slot for slot in plan.slots if slot.object_id == "hbm")
        tsv = plan.features[0]
        self.assertEqual(len(tsv.centers), 9)
        self.assertTrue(all(hbm.x <= center <= hbm.x + hbm.width for center in tsv.centers))

    def test_repeated_structural_distribution_keeps_only_canonical_slot_centers(self):
        state = apply_delta(scene(), SchematicDelta(
            creates=(member("dummy", "wafer-dmy"), replace(feature("tiv"), parent_id="dummy"))))
        plan = make_scene_layout_plan(state)
        slots = [slot for slot in plan.slots if slot.object_id == "dummy"]
        self.assertEqual(len(slots), 2)
        tiv = plan.features[0]
        self.assertEqual(len(tiv.intervals), 2)
        self.assertEqual(len(tiv.centers), 9)
        canonical = slots[0]
        self.assertTrue(all(canonical.x <= center - tiv.width / 2
                            and center + tiv.width / 2 <= canonical.x + canonical.width
                            for center in tiv.centers))

    def test_arranged_region_expands_for_its_full_free_symbol_budget(self):
        cow = member("cow", "cow", nesting="arranged")
        children = tuple(replace(member(id_), parent_id="cow", region_id="inside") for id_ in ("soc", "hbm"))
        tiv = replace(feature("tiv"), parent_id="cow", region_id="inside")
        state = apply_delta(scene(), SchematicDelta(creates=(cow, *children, tiv), add_regions=(LayoutRegion("inside", "cow"),)))
        plan = make_scene_layout_plan(state)
        self.assertEqual(len(plan.features[0].centers), 9)
        self.assertFalse(plan.notes)

    def test_attached_distribution_occupies_its_target_instead_of_avoiding_it(self):
        state = apply_delta(scene(), SchematicDelta(creates=(member("soc"), feature("contact")),
            add_relations=(SceneRelation("attach", "attached_to", "contact", (AnchorRef("soc"),)),)))
        plan = make_scene_layout_plan(state)
        soc = plan.slots[0]
        self.assertEqual(len(plan.features[0].centers), 9)
        self.assertTrue(all(soc.x <= center <= soc.x + soc.width for center in plan.features[0].centers))

    def test_future_cow_ring_lid_and_underfill_use_generic_relations(self):
        state = apply_delta(scene(), SchematicDelta(creates=(member("cow", "cow"), feature("ring", "boundary"),
                                                             feature("lid", "span"), feature("uf", "span")),
            add_relations=(SceneRelation("surround", "surrounds", "ring", region_id="mount"),
                           SceneRelation("cover", "covers", "lid", region_id="mount"),
                           SceneRelation("fill", "fills", "uf", (AnchorRef("cow"),), region_id="mount")),
            derivations=(SceneDerivation("wafer", "cow", "source", "split"),)))
        plan = make_scene_layout_plan(state)
        ring, lid, uf = (next(feature for feature in plan.features if feature.object_id == id_) for id_ in ("ring", "lid", "uf"))
        self.assertEqual(len(ring.intervals), 2)
        self.assertEqual(len(lid.intervals), 1)
        self.assertEqual(lid.intervals[0][0], ring.intervals[0][0])
        self.assertEqual(lid.intervals[0][1], ring.intervals[-1][1])
        cow = plan.slots[0]
        self.assertTrue(all(upper <= cow.x or lower >= cow.x + cow.width for lower, upper in uf.intervals))

    def test_unknown_phase_is_not_silently_combined_and_intervals_merge_exclusions(self):
        with self.assertRaises(ValueError):
            merge_scene_states((scene(), replace(scene(), phase_id="new-package")))
        self.assertEqual(subtract_intervals(((0, 100),), ((30, 60), (20, 40), (80, 90))),
                         ((0, 20), (60, 80), (90, 100)))

    def test_region_anchor_can_update_without_replacing_horizontal_identity(self):
        initial = apply_delta(scene(), SchematicDelta(creates=(member("soc"),)))
        changed = replace(initial, regions=(replace(initial.regions[0], anchor="opposite-face"),))
        merged = merge_scene_states((initial, changed))
        self.assertEqual(merged.region_map["mount"].anchor, "opposite-face")
        self.assertEqual(make_scene_layout_plan(initial).slots, make_scene_layout_plan((initial, changed)).slots)
        other_owner = SchematicObject("other", "assembly", "assembly", "Other")
        reowned = replace(changed, objects=(*changed.objects, other_owner),
                          regions=(replace(changed.regions[0], owner_id="other"),))
        with self.assertRaisesRegex(ValueError, "Region identity changed"):
            merge_scene_states((initial, reowned))


if __name__ == "__main__":
    unittest.main()
