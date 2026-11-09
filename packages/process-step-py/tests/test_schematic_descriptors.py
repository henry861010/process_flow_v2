from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import unittest

from process_flow_schematic.scene import (
    AnchorSpec, SceneObject, SceneRegion, SceneState, apply_delta, namespace_id,
)
from process_flow_schematic.source import normalize_scene_members
from process_flow_steps.schematic_layout import (
    SchematicDescriptorContext, SchematicDescriptorRegistry, describe_schematic,
    register_descriptors,
)


def assembly(name="main"):
    root = SceneObject(name, "assembly", "assembly", name, source_ref=name)
    region = SceneRegion(f"{name}:mount", name)
    return SceneState((root,), (region,), cursor_region_id=region.id, phase_id=name)


def die(name="die", role="soc"):
    root = SceneObject(name, "component", role, role, source_ref=name,
                       class_key=f"{role}:class", group_key=f"{role}:class",
                       layout="member", region_id=f"{name}:mount",
                       anchors=(AnchorSpec("upper", source_ref=name, side="upper"),))
    body = SceneObject(f"{name}:body", "body", "silicon", "Silicon", parent_id=name,
                       source_ref=f"{name}:body", layout="span", region_id=f"{name}:mount")
    return SceneState((root, body), (SceneRegion(f"{name}:mount", name),), cursor_region_id=f"{name}:mount")


def describe(main, program, params=None, *, ref="step", **inputs):
    return describe_schematic(SchematicDescriptorContext(ref, program, params or {},
                                                         {"main_geometry": main, **inputs}))


class SchematicDescriptorTests(unittest.TestCase):
    def test_context_copies_and_freezes_nested_recipe_parameters(self):
        parameters = {"placements": [{"position": [1, 2]}], "layers": [{"material": "Cu"}]}
        context = SchematicDescriptorContext("pnp", "pnp/pnp", parameters, {"main_geometry": assembly()})
        parameters["placements"][0]["position"][0] = 99
        parameters["layers"].append({"material": "Si"})
        self.assertEqual(context.parameter_values["placements"][0]["position"], (1, 2))
        self.assertEqual(len(context.parameter_values["layers"]), 1)
        with self.assertRaises(TypeError):
            context.parameter_values["placements"][0]["position"] = (3, 4)
        with self.assertRaises(TypeError):
            context.parameter_values["placements"][0]["position"][0] = 3

    def test_active_ports_omit_an_unused_empty_placement_source(self):
        registry = SchematicDescriptorRegistry()
        register_descriptors(registry)
        connected = ("main_geometry", "die_geometry", "main_geometry")
        self.assertEqual(registry.input_ports("pnp/pnp", {"placements": []}, connected), ("main_geometry",))
        self.assertEqual(registry.input_ports("pnp/pnp", {"placements": ()}, connected), ("main_geometry",))
        self.assertEqual(registry.input_ports("pnp/pnp", {"placements": [{}]}, connected),
                         ("die_geometry", "main_geometry"))
        self.assertEqual(registry.input_ports("carrier/bond", {}, ("main_geometry", "carrier_geometry")),
                         ("carrier_geometry", "main_geometry"))
        with self.assertRaisesRegex(ValueError, "No schematic descriptor"):
            registry.input_ports("unknown/program", {}, ())

    def test_every_executable_builtin_has_a_companion(self):
        registry = SchematicDescriptorRegistry()
        register_descriptors(registry)
        source = Path(__file__).parents[1] / "src" / "process_flow_steps"
        programs = set()
        for path in source.glob("*/*.py"):
            if "def execute(context:" in path.read_text():
                programs.add(f"{path.parent.name}/{path.stem}")
        self.assertEqual(set(registry.programs), programs)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            register_descriptors(registry)
        with self.assertRaisesRegex(ValueError, "No schematic descriptor"):
            registry.describe(SchematicDescriptorContext("missing", "future/process", {}, {"main_geometry": assembly()}))

    def test_pnp_count_is_irrelevant_and_each_operation_has_own_identity(self):
        main, source = assembly(), die()
        one = describe(main, "pnp/pnp", {"placements": [{}]}, die_geometry=source)
        many = describe(main, "pnp/pnp", {"placements": [{}, {}, {}]}, die_geometry=source)
        self.assertEqual(one, many)
        self.assertEqual(describe(main, "pnp/pnp", {"placements": []}).creates, ())
        first = apply_delta(main, one)
        second = apply_delta(first, describe(first, "pnp/pnp", {"placements": [{}]}, ref="next", die_geometry=source))
        members = [obj for obj in second.objects if obj.layout == "member"]
        self.assertEqual(len(members), 2)
        self.assertNotEqual(members[0].group_key, members[1].group_key)
        self.assertEqual({obj.region_id for obj in members}, {main.cursor_region_id})
        self.assertEqual(second.cursor_region_id, main.cursor_region_id)
        self.assertEqual(source, die())

    def test_pnp_preserves_atomic_compound_hierarchy(self):
        source = die(role="hbm")
        internal = SceneObject("dram-stack", "component", "dram", "DRAM", parent_id="die", layout="group")
        source = replace(source, objects=(*source.objects, internal))
        delta = describe(assembly(), "pnp/pnp", {"placements": [{}]}, die_geometry=source)
        copied_internal = next(obj for obj in delta.creates if obj.role == "dram")
        self.assertEqual(copied_internal.parent_id, namespace_id("step", "die"))
        self.assertEqual(copied_internal.layout, "group")
        self.assertEqual(len([obj for obj in delta.creates if obj.layout == "member"]), 1)

    def test_imported_wrapper_promoted_on_attachment_keeps_pnp_namespace(self):
        source = die(role="component")
        source = replace(source, objects=tuple(replace(obj, layout="group", group_key=None)
                                              if obj.id == "die" else obj for obj in source.objects))
        main = assembly()
        first = normalize_scene_members(apply_delta(main, describe(
            main, "pnp/pnp", {"placements": [{}]}, ref="first", die_geometry=source)))
        second = normalize_scene_members(apply_delta(first, describe(
            first, "pnp/pnp", {"placements": [{}]}, ref="second", die_geometry=source)))
        members = [obj for obj in second.objects if obj.layout == "member"]
        self.assertEqual(len(members), 2)
        self.assertEqual({obj.region_id for obj in members}, {main.cursor_region_id})
        self.assertEqual(len({obj.group_key for obj in members}), 2)

    def test_unclassified_wrapper_cohort_is_qualified_by_destination_region(self):
        source = die(role="component")
        source = replace(source, objects=tuple(replace(obj, layout="group", group_key=None)
                                              if obj.id == "die" else obj for obj in source.objects))
        first = assembly()
        other_region = SceneRegion("second-surface", "main")
        second = replace(first, regions=(*first.regions, other_region), cursor_region_id=other_region.id)
        keys = []
        for main in (first, second):
            delta = describe(main, "pnp/pnp", {"placements": [{}]}, die_geometry=source)
            keys.append(next(obj.group_key for obj in delta.creates if obj.kind == "component"))
        self.assertNotEqual(keys[0], keys[1])
        # Already classified sources retain their established cohort identity.
        explicit = die()
        expected = namespace_id("step", explicit.object_map["die"].group_key)
        for main in (first, second):
            delta = describe(main, "pnp/pnp", {"placements": [{}]}, die_geometry=explicit)
            self.assertEqual(next(obj.group_key for obj in delta.creates if obj.kind == "component"), expected)

    def test_tiv_and_future_pnp_declare_exclusion_without_moving_cursor(self):
        main = assembly()
        tmv_delta = describe(main, "tmv/tmv", {"density": 40}, ref="tmv")
        with_tmv = apply_delta(main, tmv_delta)
        self.assertEqual(with_tmv.cursor_region_id, main.cursor_region_id)
        self.assertEqual(tmv_delta.creates[0].layout, "distributed")
        pnp_delta = describe(with_tmv, "pnp/pnp", {"placements": [{}]}, die_geometry=die(role="lsi"))
        result = apply_delta(with_tmv, pnp_delta)
        exclusions = [rel for rel in result.relations if rel.kind == "excludes" and rel.targets]
        self.assertEqual(len(exclusions), 1)
        self.assertEqual(exclusions[0].subject_id, tmv_delta.creates[0].id)
        self.assertEqual(len(exclusions[0].targets), 1)

    def test_layers_update_symbolic_surface_rdl_registers_local_features(self):
        main = assembly()
        deposited = apply_delta(main, describe(main, "layer/molding", {"material": "EMC"}))
        self.assertNotEqual(deposited.cursor_region_id, main.cursor_region_id)
        layers = [{"Dielectric": "PI", "Conductivity": "Cu", "thk": 5, "density": 30}] * 3
        delta = describe(deposited, "layer/rdl", {"layers": layers}, ref="rdl")
        result = apply_delta(deposited, delta)
        self.assertEqual(len(delta.creates), 6)
        self.assertEqual([obj.symbol for obj in delta.creates if obj.kind == "feature"],
                         ["rdl.via", "rdl.circuit", "rdl.via"])
        self.assertEqual(len([rel for rel in delta.add_relations if rel.kind == "connects"]), 2)
        self.assertNotEqual(result.cursor_region_id, deposited.cursor_region_id)
        self.assertFalse(any(hasattr(obj, "thickness") for obj in result.objects))

    def test_flip_changes_anchor_orientation_without_changing_identity(self):
        scene = die()
        delta = describe(scene, "flip/flip")
        flipped = apply_delta(scene, delta)
        self.assertEqual(flipped.orientation, -1)
        self.assertEqual(flipped.object_map["die"].anchors[0].name, "upper")
        self.assertEqual(flipped.object_map["die"].anchors[0].side, "lower")
        self.assertEqual(set(flipped.object_map), set(scene.object_map))

    def test_saw_and_grind_keep_conservative_inventory(self):
        scene = die()
        for program, kind in (("saw/saw", "crop"), ("grinding/grinding", "transform")):
            with self.subTest(program=program):
                delta = describe(scene, program, {"thk": 1})
                result = apply_delta(scene, delta)
                self.assertEqual(set(result.object_map), set(scene.object_map))
                self.assertTrue(all(item.kind == kind for item in delta.derivations))
                self.assertTrue(all(item.source_object_id == item.target_object_id for item in delta.derivations))

    def test_support_copy_and_removal_are_logical_and_branch_local(self):
        source = assembly("carrier-source")
        body = SceneObject("carrier-body", "body", "carrier", "Carrier", parent_id="carrier-source",
                           source_ref="physical-carrier", layout="span", region_id=source.cursor_region_id)
        source = replace(source, objects=(*source.objects, body))
        main = assembly()
        delta = describe(main, "carrier/bond", carrier_geometry=source)
        bonded = apply_delta(main, delta)
        self.assertEqual(len(delta.creates), 1)
        self.assertEqual(delta.creates[0].parent_id, "main")
        self.assertEqual(delta.derivations[0].input_port_id, "carrier_geometry")
        self.assertEqual(delta.creates[0].source_ref, "physical-carrier")
        debonded = apply_delta(bonded, describe(bonded, "carrier/debond", ref="debond"))
        self.assertEqual(len(bonded.objects), 2)
        self.assertEqual(len(debonded.objects), 1)
        self.assertEqual(len(main.objects), 1)

    def test_joint_updates_bump_symbol_without_reidentifying_component(self):
        main = die()
        bumped = apply_delta(main, describe(main, "bump/uBump_formation", ref="bump"))
        joint = describe(bumped, "joint/tcb_joint", ref="joint")
        result = apply_delta(bumped, joint)
        self.assertEqual(result.object_map["die"], bumped.object_map["die"])
        self.assertEqual([obj.symbol for obj in joint.updates], ["bump.joined"])


if __name__ == "__main__":
    unittest.main()
