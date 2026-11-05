import unittest
from dataclasses import FrozenInstanceError, replace

from process_flow_schematic.scene import (
    AnchorRef, AnchorSpec, LayoutRegion, PhysicalSample, SceneDerivation,
    SceneRelation, SceneReparent, SceneState, SchematicDelta, SchematicObject,
    apply_delta, clone_scene, namespace_id, resolve_physical_data, validate_scene,
)


def assembly():
    return SceneState(
        objects=(SchematicObject("assembly", "assembly", "package", "Assembly"),),
        regions=(LayoutRegion("mount", "assembly"),), cursor_region_id="mount",
    )


def die(id_="die", **kwargs):
    return SchematicObject(id_, "component", "soc", "SoC", parent_id="assembly",
                           source_ref="source-die", layout="member", region_id="mount", **kwargs)


class SceneContractTests(unittest.TestCase):
    def region_branches(self):
        active = die(anchors=(AnchorSpec("edge", "region-boundary", "mount", "left"),))
        body = SchematicObject("body", "body", "silicon", "Si", parent_id="die", layout="span", region_id="inside")
        peer = replace(die("peer"), region_id="spare")
        return apply_delta(assembly(), SchematicDelta(
            creates=(active, body, peer),
            add_regions=(LayoutRegion("inside", "die", parent_region_id="mount"),
                         LayoutRegion("deep", "die", parent_region_id="inside"),
                         LayoutRegion("spare", "assembly")),
            add_relations=(SceneRelation("active", "inside", "body", region_id="inside"),
                           SceneRelation("untouched", "attached_to", "peer", (AnchorRef("assembly"),))),
        ))

    def test_delta_is_atomic_immutable_and_preserves_stable_identity(self):
        before = apply_delta(assembly(), SchematicDelta(creates=(die(),)))
        after = apply_delta(before, SchematicDelta(updates=(replace(before.object_map["die"], label="Ground SoC"),),
                                                   orientation=-1,
                                                   derivations=(SceneDerivation("die", "die", kind="transform"),)))
        self.assertEqual(before.object_map["die"].label, "SoC")
        self.assertEqual(after.object_map["die"].source_ref, "source-die")
        self.assertEqual(after.orientation, -1)
        with self.assertRaises(TypeError):
            after.object_map["die"] = die()
        with self.assertRaises(FrozenInstanceError):
            after.objects[0].label = "Changed"
        with self.assertRaises(ValueError):
            apply_delta(before, SchematicDelta(updates=(replace(die(), parent_id="missing"),)))
        # A malformed custom descriptor must stop lookahead with ValueError,
        # rather than escape the planner's contract-error handling.
        with self.assertRaises(ValueError):
            apply_delta(before, SchematicDelta(creates=({"id": "bad"},)))
        self.assertEqual(before.object_map["die"].parent_id, "assembly")

    def test_removal_cascades_but_explicitly_reparented_survivor_remains(self):
        body = SchematicObject("body", "body", "silicon", "Si", parent_id="die", layout="span", region_id="inside")
        state = apply_delta(assembly(), SchematicDelta(
            creates=(die(), body), add_regions=(LayoutRegion("inside", "die"),),
            add_relations=(SceneRelation("contact", "attached_to", "body", (AnchorRef("die"),)),),
        ))
        removed = apply_delta(state, SchematicDelta(removes=("die",)))
        self.assertEqual(tuple(removed.object_map), ("assembly",))
        self.assertNotIn("inside", removed.region_map)
        self.assertFalse(removed.relations)
        survivor = apply_delta(state, SchematicDelta(removes=("die",),
            updates=(replace(body, region_id="mount"),), reparents=(SceneReparent("body", "assembly"),)))
        self.assertIn("body", survivor.object_map)
        self.assertFalse(survivor.relations)

    def test_region_and_relation_updates_keep_identity_and_untouched_branches(self):
        before = self.region_branches()
        updates = [replace(before.region_map["mount"], anchor="exposed-upper")]
        relation_updates = [replace(before.relation_map["active"], kind="covers", region_id="spare")]
        delta = SchematicDelta(update_regions=updates, update_relations=relation_updates)
        updates.clear()
        relation_updates.clear()
        self.assertIsInstance(delta.update_regions, tuple)
        self.assertIsInstance(delta.update_relations, tuple)
        after = apply_delta(before, delta)
        self.assertEqual(before.region_map["mount"].anchor, "mount")
        self.assertEqual(after.region_map["mount"].anchor, "exposed-upper")
        self.assertEqual(after.relation_map["active"].kind, "covers")
        self.assertEqual(after.relation_map["active"].region_id, "spare")
        self.assertEqual(tuple(after.region_map), tuple(before.region_map))
        self.assertEqual(tuple(after.relation_map), tuple(before.relation_map))
        self.assertIs(after.object_map["peer"], before.object_map["peer"])
        self.assertIs(after.region_map["spare"], before.region_map["spare"])
        self.assertIs(after.relation_map["untouched"], before.relation_map["untouched"])

    def test_explicit_region_removal_cascades_relations_and_requires_rehomed_objects(self):
        before = self.region_branches()
        with self.assertRaisesRegex(ValueError, "Unknown region"):
            apply_delta(before, SchematicDelta(remove_regions=("mount",)))
        moved_die = replace(before.object_map["die"], region_id="spare")
        moved_body = replace(before.object_map["body"], region_id="spare")
        with self.assertRaisesRegex(ValueError, "Unknown anchor region"):
            apply_delta(before, SchematicDelta(remove_regions=("mount",), updates=(moved_die, moved_body)))
        moved_die = replace(moved_die, anchors=(AnchorSpec("edge", "region-boundary", "spare", "left"),))
        after = apply_delta(before, SchematicDelta(remove_regions=["mount"], updates=(moved_die, moved_body)))
        self.assertEqual(tuple(after.region_map), ("spare",))
        self.assertEqual(tuple(after.relation_map), ("untouched",))
        self.assertIsNone(after.cursor_region_id)
        self.assertEqual(tuple(after.object_map), tuple(before.object_map))
        self.assertEqual(tuple(before.region_map), ("mount", "inside", "deep", "spare"))
        self.assertIn("active", before.relation_map)

    def test_region_reparent_update_rescues_subtree_before_removal_cascade(self):
        before = self.region_branches()
        moved_die = replace(before.object_map["die"], region_id="spare",
                            anchors=(AnchorSpec("edge", "region-boundary", "spare", "left"),))
        after = apply_delta(before, SchematicDelta(
            remove_regions=("mount",), updates=(moved_die,),
            update_regions=(replace(before.region_map["inside"], parent_region_id="spare"),),
            cursor_region_id="inside",
        ))
        self.assertEqual(set(after.region_map), {"inside", "deep", "spare"})
        self.assertEqual(after.cursor_region_id, "inside")
        self.assertIn("active", after.relation_map)
        self.assertIs(after.object_map["body"], before.object_map["body"])

    def test_invalid_region_and_relation_changes_are_atomic_contract_errors(self):
        before = self.region_branches()
        region = before.region_map["mount"]
        relation = before.relation_map["active"]
        invalid = (
            SchematicDelta(update_regions=({"id": "mount"},)),
            SchematicDelta(update_relations=({"id": "active"},)),
            SchematicDelta(update_regions=(replace(region, id="missing"),)),
            SchematicDelta(update_regions=(region, region)),
            SchematicDelta(update_regions=(region,), remove_regions=("mount",)),
            SchematicDelta(remove_regions=("missing",)),
            SchematicDelta(remove_regions=("spare", "spare")),
            SchematicDelta(update_regions=(replace(region, owner_id="missing"),)),
            SchematicDelta(update_regions=(replace(region, parent_region_id="inside"),)),
            SchematicDelta(update_relations=(replace(relation, id="missing"),)),
            SchematicDelta(update_relations=(relation, relation)),
            SchematicDelta(update_relations=(relation,), remove_relations=("active",)),
            SchematicDelta(update_relations=(replace(relation, region_id="missing"),)),
        )
        for delta in invalid:
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                apply_delta(before, delta)
            self.assertEqual(before.region_map["mount"], region)
            self.assertEqual(before.relation_map["active"], relation)

    def test_copy_preserves_physical_reference_and_records_port_lineage(self):
        source = apply_delta(assembly(), SchematicDelta(creates=(die(anchors=(AnchorSpec("bond", side="lower"),)),)))
        delta = clone_scene(source, "pnp-1", "die_geometry", attach_to="assembly", region_id="mount")
        output = apply_delta(assembly(), delta)
        copied = output.object_map[namespace_id("pnp-1", "die")]
        self.assertEqual(copied.source_ref, "source-die")
        self.assertEqual(copied.region_id, "mount")
        self.assertEqual(copied.anchors, source.object_map["die"].anchors)
        self.assertIn(SceneDerivation("die", copied.id, "die_geometry"), output.derivations)
        self.assertNotEqual(copied.group_key, clone_scene(source, "pnp-2", "die_geometry").creates[1].group_key)

    def test_snapshot_binding_keeps_different_measurements_and_omits_future_objects(self):
        state = apply_delta(assembly(), SchematicDelta(creates=(die(), die("future"))))
        samples = {"a": PhysicalSample("a", 0, 10, "Si", 20), "b": PhysicalSample("b", 1, 8, "Si", None)}
        result = resolve_physical_data(state, samples, {"die": ("a", "a", "b", "removed")}, snapshot_id="after-saw", unit="um")
        self.assertEqual(len(result), 1)
        self.assertEqual([sample.thickness for sample in result[0].samples], [10, 7])
        self.assertEqual([sample.density for sample in result[0].samples], [20, None])
        self.assertEqual(result[0].object_id, "die")
        with self.assertRaises(ValueError):
            PhysicalSample("bad", 10, 0, "Si")

    def test_bad_structure_and_relation_contracts_are_rejected(self):
        base = apply_delta(assembly(), SchematicDelta(creates=(die(anchors=(AnchorSpec("bond"),)),)))
        invalid = (
            replace(base, objects=(*base.objects, base.objects[-1])),
            replace(base, objects=(replace(base.objects[0], parent_id="die"), base.objects[1])),
            replace(base, relations=(SceneRelation("r", "connects", "die", (AnchorRef("assembly"),)),)),
            replace(base, relations=(SceneRelation("r", "attached_to", "assembly", (AnchorRef("die", "missing"),)),)),
            replace(base, relations=(SceneRelation("r", "covers", "die"),)),
            replace(base, objects=(base.objects[0], replace(die(), symbol_version=0))),
        )
        for scene in invalid:
            with self.subTest(scene=scene), self.assertRaises(ValueError):
                validate_scene(scene)

    def test_future_split_and_merge_preserve_immutable_lineage_and_render_current_sources(self):
        from process_flow_schematic.scene_renderer import render_scene

        whole = die("whole")
        before = apply_delta(assembly(), SchematicDelta(creates=(whole,)))
        left = replace(whole, id="left", label="Left piece", source_ref="binding:left")
        right = replace(whole, id="right", label="Right piece", source_ref="binding:right")
        split = apply_delta(before, SchematicDelta(
            creates=(left, right), removes=("whole",), phase_id="split-phase",
            derivations=(SceneDerivation("whole", "left", kind="split"),
                         SceneDerivation("whole", "right", kind="split")),
        ))
        self.assertIn("whole", before.object_map)
        self.assertNotIn("whole", split.object_map)
        self.assertEqual(before.object_map["whole"].source_ref, "source-die")
        split_samples = {"left-node": PhysicalSample("left-node", 0, 10, "Si"),
                         "right-node": PhysicalSample("right-node", 0, 10, "Si")}
        split_doc = render_scene(split, samples=split_samples,
                                 bindings={"left": ("left-node",), "right": ("right-node",)}, snapshot_id="after-split")
        self.assertEqual(split_doc["warnings"], [])
        self.assertEqual(len(split_doc["shapes"]), 2)
        self.assertEqual({tuple(item["sourceIds"]) for item in split_doc["items"]},
                         {("left-node",), ("right-node",)})
        merged_object = replace(whole, id="merged", label="Merged assembly", source_ref="binding:merged")
        merged = apply_delta(split, SchematicDelta(
            creates=(merged_object,), removes=("left", "right"), phase_id="merged-phase",
            derivations=(SceneDerivation("left", "merged", kind="merge"),
                         SceneDerivation("right", "merged", kind="merge")),
        ))
        self.assertEqual({item.kind for item in merged.derivations}, {"split", "merge"})
        self.assertEqual({item.source_object_id for item in merged.derivations if item.kind == "merge"},
                         {"left", "right"})
        self.assertEqual(tuple(split.object_map), ("assembly", "left", "right"))
        self.assertEqual(tuple(merged.object_map), ("assembly", "merged"))
        merged_doc = render_scene(merged, samples={"merged-node": PhysicalSample("merged-node", 0, 10, "Si")},
                                  bindings={"merged": ("merged-node",)}, snapshot_id="after-merge")
        self.assertEqual(merged_doc["warnings"], [])
        self.assertEqual(len(merged_doc["shapes"]), 1)
        self.assertEqual(merged_doc["items"][0]["sourceIds"], ["merged-node"])
        self.assertEqual(merged_doc["totalThickness"], 10)


if __name__ == "__main__":
    unittest.main()
