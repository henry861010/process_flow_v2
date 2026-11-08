"""Cloning keeps snapshot identity and ownership without hydrating valid geometry."""
from __future__ import annotations

import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from process_flow_kernel import (
    Body, BoxGeometry, Container, ExecutionPlan, GeometryArtifact, GeometryKernel,
    PlannedGeometryInput, PlannedStep, ProcessGeometryState,
    qualify_provenance,
)
from process_flow_kernel.application import geometry_kernel as kernel_module
from process_flow_kernel.domain import geometry as geometry_module
from process_flow_kernel.domain.provenance import structure_nodes


def legacy_clone(state):
    """The previous serialize/hydrate implementation, used as a behavior oracle."""
    cloned = ProcessGeometryState.from_structure(
        state.to_geometry_structure(),
        {"cursor_z": state._cursor_z, "footprint": state._process_footprint,
         "provenance": state.provenance()},
    )
    cloned._provenance_step = state._provenance_step
    cloned._provenance_ordinal = state._provenance_ordinal
    return cloned


def box_state(key="soc", *, thickness=4):
    state = ProcessGeometryState.create({"key": key})
    state.initialize_box_layer(material="Si", bottom_left=[0, 0, 0],
                               top_right=[6, 6, 0], thickness=thickness,
                               key="envelope")
    return state


def nested_state():
    state = ProcessGeometryState.create({"key": "carrier.wafer"})
    state.initialize_polygon_layer(
        material="Glass", thickness=10, key="carrier",
        polygons=[[[0, 0, 0], [30, 0, 0], [30, 30, 0], [0, 30, 0]],
                  [[12, 12, 0], [18, 12, 0], [18, 18, 0], [12, 18, 0]]],
    )
    state._root._structure_id = "explicit-root"
    state._root.bodies()[0]._structure_id = "explicit-carrier"
    state.set_provenance(qualify_provenance(state.to_geometry_structure(),
                         kind="flowInput", owner_id="wafer"))
    state.begin_provenance_step("build", "test/build")
    state.deposit_box_layer(material="PI", bottom_left=[0, 0, 10],
                            top_right=[30, 30, 10], thickness=2, key="rdl")
    child = box_state()
    child.add_via(material="Cu", density=40, direction="+z", koz=0.5,
                  geometry={"type": "cylinder", "center": [3, 3, 0],
                            "radius": 1, "thickness": 4})
    child.add_circuit(material="Cu", density=20,
                      geometry={"type": "polygon", "thickness": 1,
                                "polygons": [[[0, 0, 4], [6, 0, 4], [6, 6, 4], [0, 6, 4]]]})
    child.add_bump(material="SnAg", density=30, direction="-z", stage="joined",
                   geometry={"type": "cone", "center": [3, 3, -2],
                             "bottomRadius": 1, "topRadius": 0.5, "thickness": 2})
    grandchild = ProcessGeometryState.create({"key": "hbm"})
    grandchild.initialize_cylinder_layer(material="Si", center=[3, 3, 0],
                                         radius=2, thickness=3, key="envelope")
    child.place_geometry_state(grandchild, x=3, y=3, bottom_z=5, anchor="center")
    state.place_geometry_state(child, x=2, y=2, bottom_z=12)
    # Operations such as UF can append nodes without recording creation until
    # provenance is requested. Exercise that lazy path and its ordinal changes.
    unrecorded = Container(key="lsi")
    unrecorded.add_body(Body(BoxGeometry([22, 22, 12], [28, 28, 12], 3), "Si", "lsi.si"))
    state._root.attach_child(unrecorded)
    state.set_cursor_z(12.5)
    return state


def planned_step(name, source):
    return PlannedStep(step_ref_id=name, step_label=name, step_template={"program": "test/edit"},
                       raw_parameter_values={}, parameter_values={},
                       geometry_inputs={"main_geometry": source}, output_port_id="result_geometry")


class CloneOptimizationTests(unittest.TestCase):
    def assert_same_state(self, actual, expected):
        self.assertEqual(actual.to_geometry_structure(), expected.to_geometry_structure())
        self.assertEqual(actual.provenance(), expected.provenance())
        self.assertEqual(actual.inspect(), expected.inspect())
        self.assertEqual(actual.find_scopes(), expected.find_scopes())
        self.assertEqual(actual._provenance_step, expected._provenance_step)
        self.assertEqual(actual._provenance_ordinal, expected._provenance_ordinal)
        self.assertEqual(actual._next_scope_id, expected._next_scope_id)
        self.assertEqual(actual._next_handle_id, expected._next_handle_id)

    def test_empty_state_keeps_nondefault_metadata_cursor_and_footprint(self):
        source = ProcessGeometryState.create({"schema_version": "custom-schema", "unit_system": "nm"})
        source.set_cursor_z(123.25)
        source.set_box_footprint(bottom_left=[-4, -3], top_right=[10, 20])
        actual, expected = source.clone(), legacy_clone(source)
        self.assert_same_state(actual, expected)
        self.assertEqual(actual.to_geometry_structure()["schemaVersion"], "custom-schema")
        self.assertEqual(actual.to_geometry_structure()["unitSystem"], "nm")
        self.assertEqual(actual.cursor_z(), 123.25)
        self.assertEqual(actual.process_footprint(), source.process_footprint())

    def test_clone_matches_hydration_for_nested_metadata_and_lazy_provenance(self):
        actual_source, expected_source = nested_state(), nested_state()
        self.assertTrue(any(node._structure_id is None for node in actual_source._provenance_nodes()))
        actual, expected = actual_source.clone(), legacy_clone(expected_source)
        self.assert_same_state(actual, expected)
        self.assert_same_state(actual_source, expected_source)
        self.assertTrue(all(node._structure_id is not None for node in actual._provenance_nodes()))
        # Assigning IDs in the clone must not assign them in the mutable source.
        self.assertTrue(any(node._structure_id is None for node in actual_source._provenance_nodes()))
        self.assertEqual(actual._schema_version, actual_source._schema_version)
        self.assertEqual(actual._unit_system, actual_source._unit_system)

    def test_generated_ids_stay_fixed_through_transforms_and_new_creations(self):
        source, reference = nested_state(), nested_state()
        actual, expected = source.clone(), legacy_clone(reference)
        initial_ids = [node["id"] for node in structure_nodes(actual.to_geometry_structure())]
        original = source.to_geometry_structure()
        for state in (actual, expected):
            state.move(x=3.25, y=-2, z=1, move_cursor=True)
            state.flip_around_z()
        self.assertEqual([node["id"] for node in structure_nodes(actual.to_geometry_structure())], initial_ids)
        self.assert_same_state(actual, expected)
        for state in (actual, expected):
            state.grind_to(z=15)
            state.begin_provenance_step("deposit", "test/deposit")
            state.deposit_layer(material="PI", thickness=1, key="rdl")
        self.assert_same_state(actual, expected)
        self.assertEqual(source.to_geometry_structure(), original)

    def test_clone_separates_geometry_footprint_provenance_and_child_collections(self):
        source = nested_state()
        cloned = source.clone()
        original, trace, footprint = source.to_geometry_structure(), source.provenance(), source.process_footprint()
        cloned._process_footprint["polygons"][0][0][0] += 100
        cloned._root._provenance["sources"].clear()
        cloned.move(x=100, y=200, z=3)
        cloned._root.detach_child(cloned._root.children()[0])
        self.assertEqual(source.to_geometry_structure(), original)
        self.assertEqual(source.provenance(), trace)
        self.assertEqual(source.process_footprint(), footprint)
        clone_before = cloned.to_geometry_structure()
        source.move(x=-20)
        source._root._provenance["sources"].append({"kind": "test-only"})
        self.assertEqual(cloned.to_geometry_structure(), clone_before)
        self.assertEqual(cloned._root._provenance["sources"], [])

    def test_clone_copies_only_subtree_when_source_has_an_external_parent(self):
        class OutsideSubtree:
            def __deepcopy__(self, memo):
                raise AssertionError("clone traversed the external parent")

        parent, source = box_state("carrier"), nested_state()
        parent.place_geometry_state(source, x=0, y=0, clone=False)
        parent._root._outside_subtree = OutsideSubtree()
        before = parent.to_geometry_structure()
        cloned = source.clone()
        self.assertIsNone(cloned._root.parent())
        self.assertIs(source._root.parent(), parent._root)
        for container in (cloned._root, *cloned._root.children()):
            for child in container.children():
                self.assertIs(child.parent(), container)
        self.assertEqual(cloned.to_geometry_structure(), legacy_clone(source).to_geometry_structure())
        cloned.move(x=100)
        self.assertEqual(parent.to_geometry_structure(), before)

    def test_clone_rebuilds_live_dfs_scopes_and_resets_handles_like_hydration(self):
        source = box_state("carrier", thickness=10)
        source.place_geometry_state(box_state("soc"), x=0, y=0, bottom_z=100)
        source.place_geometry_state(box_state("hbm"), x=20, y=0, bottom_z=10)
        source.deposit_layer(material="PI", thickness=2)
        source.grind_to(z=50)
        self.assertEqual(source.find_scopes(), [{"id": "root"}, {"id": "scope:2"}])
        actual, expected = source.clone(), legacy_clone(source)
        self.assert_same_state(actual, expected)
        self.assertEqual(actual.find_scopes(), [{"id": "root"}, {"id": "scope:1"}])
        self.assertNotIn("scope:2", actual._scopes_by_id)
        self.assertEqual(set(actual._scope_ids), {id(node) for node in actual._scopes_by_id.values()})
        for state in (actual, expected):
            handle = state.deposit_layer(material="PI", thickness=1, scope={"id": "scope:1"})
            self.assertEqual(handle, {"id": "body:1", "type": "body", "scope": {"id": "scope:1"}})
            state.place_geometry_state(box_state("lsi"), x=30, y=0)
        self.assert_same_state(actual, expected)

    def test_clone_does_not_revalidate_existing_polygon_topology(self):
        source = nested_state()
        with patch.object(geometry_module, "validate_polygon_loops", side_effect=AssertionError("rehydrated polygon")):
            cloned = source.clone()
            self.assertEqual(cloned.to_geometry_structure(), source.to_geometry_structure())

    def test_manually_shared_features_and_geometry_become_independent_occurrences(self):
        for share_feature in (False, True):
            with self.subTest(share_feature=share_feature):
                geometry = BoxGeometry([0, 0, 0], [6, 6, 0], 2)
                first = Body(geometry, "Si", "envelope")
                second = first if share_feature else Body(geometry, "PI", "rdl")
                root = Container()
                root.add_body(first)
                root.add_body(second)
                source = ProcessGeometryState(root=root)
                actual, expected = source.clone(), legacy_clone(source)
                self.assert_same_state(actual, expected)
                self.assertIsNot(*actual._root.bodies())
                self.assertIsNot(*(body._geometry for body in actual._root.bodies()))
                for state in (actual, expected):
                    state._root.bodies()[0].move(x=10)
                self.assert_same_state(actual, expected)
                ids = [body["id"] for body in actual.to_geometry_structure()["root"]["bodies"]]
                self.assertEqual(len(set(ids)), 2)

    def test_shared_polygon_coordinates_do_not_transform_more_than_once(self):
        for shared_closing_point in (True, False):
            with self.subTest(shared_closing_point=shared_closing_point):
                point = [0, 0, 0]
                if shared_closing_point:
                    polygons = [[point, [10, 0, 0], [10, 10, 0], [0, 10, 0], point]]
                else:
                    polygons = [[point, [10, 0, 0], [10, 10, 0], [0, 10, 0]],
                                [point, [-10, 0, 0], [-10, -10, 0], [0, -10, 0]]]
                root = Container()
                root.add_body_polygon("Si", polygons, 1)
                source = ProcessGeometryState(root=root)
                original = source.to_geometry_structure()
                actual, expected = source.clone(), legacy_clone(source)
                actual.move(x=1, y=2, z=3)
                expected.move(x=1, y=2, z=3)
                self.assert_same_state(actual, expected)
                self.assertEqual(actual.to_geometry_structure()["root"]["bodies"][0]["geometry"]["polys"][0][0],
                                 [1, 2, 3])
                self.assertEqual(source.to_geometry_structure(), original)

    def test_mutable_coordinates_shared_between_geometry_objects_are_separated(self):
        root = Container()
        root.add_body_box("Si", [0, 0, 0], [10, 10, 0], 1)
        root.add_body_cylinder("Cu", [0, 0, 0], 1, 2)
        root.bodies()[1]._geometry._center = root.bodies()[0]._geometry._bottom_left
        source = ProcessGeometryState(root=root)
        actual, expected = source.clone(), legacy_clone(source)
        actual.move(x=1, y=2, z=3)
        expected.move(x=1, y=2, z=3)
        self.assert_same_state(actual, expected)

    def test_clone_keeps_duplicate_id_rejection_and_external_polygon_validation(self):
        source = box_state()
        source.deposit_layer(material="PI", thickness=2)
        for body in source._root.bodies():
            body._structure_id = "duplicate"
        with self.assertRaisesRegex(ValueError, "Duplicate geometry structure ID"):
            source.clone()
        invalid = box_state().to_geometry_structure()
        invalid["root"]["bodies"][0]["geometry"] = {
            "type": "PolygonGeometry", "thk": 1,
            "polys": [[[0, 0, 0], [4, 4, 0], [0, 4, 0], [4, 0, 0]]],
        }
        with self.assertRaises(ValueError):
            ProcessGeometryState.from_structure(invalid)
        with self.assertRaises(ValueError):
            kernel_module._normalize_step_output_state(invalid, box_state())


class OutputStateOwnershipTests(unittest.TestCase):
    def test_only_none_and_same_owned_state_are_reused(self):
        owned = nested_state()
        self.assertIs(kernel_module._normalize_step_output_state(None, owned), owned)
        self.assertIs(kernel_module._normalize_step_output_state(owned, owned), owned)
        other = legacy_clone(owned)
        self.assertEqual(other.to_geometry_structure(), owned.to_geometry_structure())
        normalized = kernel_module._normalize_step_output_state(other, owned)
        self.assertIsNot(normalized, other)
        self.assertIsNot(normalized, owned)
        before = other.to_geometry_structure()
        normalized.move(x=100)
        self.assertEqual(other.to_geometry_structure(), before)

    def test_artifact_raw_and_custom_outputs_remain_detached(self):
        source = nested_state()
        raw = source.to_geometry_structure()
        artifact = GeometryArtifact.from_structure(raw).with_runtime_state(source)
        custom = SimpleNamespace(to_geometry_structure=lambda: raw)
        for output in (raw, artifact, custom):
            with self.subTest(output=type(output).__name__):
                before = copy.deepcopy(raw)
                normalized = kernel_module._normalize_step_output_state(output, box_state())
                self.assertEqual(normalized.to_geometry_structure(), before)
                normalized.move(x=100)
                self.assertEqual(raw, before)
                self.assertEqual(source.to_geometry_structure(), before)
                self.assertEqual(artifact.runtime_state.to_geometry_structure(), before)

    def test_reused_output_keeps_snapshots_and_downstream_inputs_isolated(self):
        for returns_none in (False, True):
            with self.subTest(returns_none=returns_none):
                contexts = []
                source = box_state("carrier")
                source_snapshot = source.to_geometry_structure()
                artifact = GeometryArtifact.from_structure(source_snapshot).with_runtime_state(source)
                plan = ExecutionPlan(
                    steps=[planned_step("first", PlannedGeometryInput(kind="external", flow_input_id="main")),
                           planned_step("second", PlannedGeometryInput(kind="stepOutput", step_ref_id="first"))],
                    external_geometries={"main": artifact}, terminal_step_ref_ids=["second"],
                )

                def execute(context):
                    contexts.append(context)
                    context.state.deposit_layer(material="PI", thickness=1, key="rdl", advance_cursor=True)
                    return None if returns_none else context.state

                resolver = SimpleNamespace(resolve=lambda _: SimpleNamespace(execute=execute))
                result = GeometryKernel(module_resolver=resolver).execute(plan)
                snapshots = result.step_outputs()
                traces = {name: result.step_provenance(name) for name in ("first", "second")}
                self.assertEqual(len(snapshots["first"]["root"]["bodies"]), 2)
                self.assertEqual(len(snapshots["second"]["root"]["bodies"]), 3)
                contexts[0].state.move(x=100)
                contexts[0].state._root._provenance["sources"].clear()
                contexts[1].state.move(y=200)
                self.assertEqual(result.step_outputs(), snapshots)
                self.assertEqual({name: result.step_provenance(name) for name in traces}, traces)
                self.assertEqual(artifact.structure, source_snapshot)
                self.assertEqual(artifact.runtime_state.to_geometry_structure(), source_snapshot)

                def legacy_normalize(output, fallback):
                    return kernel_module._geometry_input_to_process_geometry_state(fallback if output is None else output)

                with patch.object(kernel_module, "_normalize_step_output_state", legacy_normalize):
                    reference = GeometryKernel(module_resolver=resolver).execute(plan)
                self.assertEqual(result.step_outputs(), reference.step_outputs())
                self.assertEqual(result.geometry(), reference.geometry())
                for name in traces:
                    self.assertEqual(result.step_provenance(name), reference.step_provenance(name))


if __name__ == "__main__":
    unittest.main()
