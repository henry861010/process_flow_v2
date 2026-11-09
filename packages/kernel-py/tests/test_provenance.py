"""Lineage follows physical nodes without changing serialized geometry."""
from __future__ import annotations

import copy
import unittest
from types import SimpleNamespace

from process_flow_kernel import (
    ExecutionPlan, GeometryArtifact, GeometryKernel, PlannedGeometryInput,
    PlannedStep, ProcessGeometryState, qualify_provenance,
)
from process_flow_kernel.application.material_instances import prepare_step_material_instances
from process_flow_kernel.domain.provenance import structure_nodes


def layer(*, key=None, material="Si", width=10, thickness=10, z=0):
    state = ProcessGeometryState.create({"key": key})
    state.initialize_box_layer(material=material, bottom_left=[0, 0, z],
                               top_right=[width, width, z], thickness=thickness,
                               key="envelope" if key in ("soc", "dram") else key)
    return state


def sourced(state, owner, port="main_geometry"):
    state.set_provenance(qualify_provenance(state.to_geometry_structure(),
                         kind="flowInput", owner_id=owner, input_port_id=port))
    return state


def external(name):
    return PlannedGeometryInput(kind="external", flow_input_id=name)


def upstream(name):
    return PlannedGeometryInput(kind="stepOutput", step_ref_id=name,
                                output_port_id="result_geometry")


def step(name, program, inputs, params=None):
    return PlannedStep(step_ref_id=name, step_label=name,
                       step_template={"id": name, "program": program},
                       raw_parameter_values=params or {}, parameter_values=params or {},
                       geometry_inputs=inputs, output_port_id="result_geometry")


def placement(x, width=10):
    return {"targetRegion": {"type": "rectangle", "bottomLeftX": x,
            "bottomLeftY": 0, "topRightX": x + width, "topRightY": width},
            "pose": {"x": 0, "y": 0, "rotationZ": 0}, "anchor": "center"}


class ProvenanceTests(unittest.TestCase):
    def test_nested_pnp_adaptation_maps_every_node_without_relying_on_output_order(self):
        main = layer(key="carrier", material="Glass", width=100)
        die = layer(key="soc")
        die.place_geometry_state(layer(key="dram", thickness=2), x=0, y=0, bottom_z=10)
        original = die.to_geometry_structure()
        plan = ExecutionPlan(steps=[step("place", "pnp/pnp", {
            "main_geometry": external("wafer"), "die_geometry": external("die"),
        }, {"placements": [placement(0, 20), placement(40, 20)]})],
            external_geometries={"wafer": GeometryArtifact.from_structure(main.to_geometry_structure()),
                                 "die": GeometryArtifact.from_structure(original)},
            terminal_step_ref_ids=["place"])
        result = GeometryKernel().execute(plan)
        output, trace = result.geometry(), result.step_provenance("place")
        source_ids = {node["id"] for node in structure_nodes(original)}
        self.assertEqual(set(trace), {node["id"] for node in structure_nodes(output)})
        ordinals = []
        for child in output["root"]["children"]:
            copied_nodes = list(structure_nodes({"root": child}))
            self.assertEqual({ref["nodeId"] for node in copied_nodes
                              for ref in trace[node["id"]]["sources"] if ref["ownerId"] == "die"}, source_ids)
            for node in copied_nodes:
                entry = trace[node["id"]]
                self.assertEqual(entry["createdBy"]["stepRefId"], "place")
                self.assertEqual(entry["createdBy"]["operation"], "place")
                self.assertEqual(entry["sources"][0]["inputPortId"], "die_geometry")
                self.assertNotIn("provenance", node)
            ordinals.append(trace[child["id"]]["createdBy"]["ordinal"])
        self.assertNotEqual(*ordinals)
        self.assertEqual(die.to_geometry_structure(), original)
        self.assertEqual(plan.external_geometries["die"].provenance, {})

    def test_saw_and_grind_keep_surviving_origins_and_remove_deleted_nodes(self):
        main, die = layer(key="carrier", material="Glass", width=100), layer(key="soc")
        plan = ExecutionPlan(steps=[
            step("place", "pnp/pnp", {"main_geometry": external("wafer"), "die_geometry": external("die")},
                 {"placements": [placement(0), placement(20)]}),
            step("cut", "saw/saw", {"main_geometry": upstream("place")},
                 {"bottomLeftX": 20, "bottomLeftY": 0, "topRightX": 30, "topRightY": 10}),
            step("grind", "grinding/grinding", {"main_geometry": upstream("cut")}, {"thk": 2}),
        ], external_geometries={"wafer": GeometryArtifact.from_structure(main.to_geometry_structure()),
                                "die": GeometryArtifact.from_structure(die.to_geometry_structure())},
            terminal_step_ref_ids=["grind"])
        result = GeometryKernel().execute(plan)
        placed = result.step_output("place")["root"]["children"]
        final = result.geometry()["root"]["children"]
        self.assertEqual(len(final), 1)
        self.assertEqual(final[0]["id"], placed[1]["id"])
        trace = result.step_provenance("grind")
        self.assertNotIn(placed[0]["id"], trace)
        entry = trace[final[0]["id"]]
        self.assertEqual(entry["createdBy"]["stepRefId"], "place")
        self.assertTrue(any(ref["ownerId"] == "cut" and ref["nodeId"] == final[0]["id"]
                            for ref in entry["sources"]))
        self.assertEqual(final[0]["bodies"][0]["geometry"]["thk"], 8)

    def test_clone_hydration_material_rewrite_preserve_sidecar_and_copy_isolation(self):
        state = sourced(layer(key="soc"), "source", "die_geometry")
        original, trace = state.to_geometry_structure(), state.provenance()
        prepared = prepare_step_material_instances(
            geometry_inputs={"main_geometry": original, "die_geometry": original},
            geometry_input_sources={"main_geometry": "external", "die_geometry": "external"},
            step_template={}, values={},
        )
        rewritten = prepared.geometry_inputs["die_geometry"]
        artifact = GeometryArtifact.from_structure(original).with_provenance(trace)
        runtime_artifact = GeometryArtifact.from_state(ProcessGeometryState.from_structure(original), source=artifact)
        self.assertEqual(runtime_artifact.fork_state().provenance(), trace)
        rewritten_artifact = artifact.with_structure(rewritten,
            node_id_remap=prepared.geometry_node_remaps["die_geometry"])
        restored = ProcessGeometryState.from_structure(rewritten, {"provenance": rewritten_artifact.provenance})
        cloned = restored.clone()
        expected = {prepared.geometry_node_remaps["die_geometry"][node_id]: entry
                    for node_id, entry in trace.items()}
        self.assertEqual(cloned.provenance(), expected)
        cloned.provenance()[original["root"]["id"]]["sources"].clear()
        self.assertEqual(cloned.provenance(), expected)
        self.assertEqual(state.to_geometry_structure(), original)
        self.assertEqual(cloned.to_geometry_structure(), rewritten)
        self.assertNotIn("provenance", artifact.descriptor())

    def test_joint_preserves_bump_identity_and_origins(self):
        main = sourced(layer(key="carrier", material="Glass", width=100, thickness=100), "wafer")
        main.add_bump_above_cursor(material="SnAg", density=40, thickness=5, stage="reflowed")
        main = sourced(main, "wafer")
        die = layer(key="soc", z=5)
        die.add_bump(material="SnAg", density=40, direction="-z", stage="reflowed",
                     geometry={"type": "box", "bottomLeft": [0, 0, 0],
                               "topRight": [10, 10, 0], "thickness": 5})
        sourced(die, "die", "die_geometry")
        main.begin_provenance_step("place", "pnp/pnp")
        main.place_geometry_state(die, x=0, y=0, bottom_z=105)
        before, trace = main.to_geometry_structure(), main.provenance()
        main.begin_provenance_step("join", "joint/mr_joint")
        main.join_bumps(joined_height=4)
        after = main.to_geometry_structure()
        bump = after["root"]["children"][0]["bumps"][0]
        self.assertEqual(bump["stage"], "joined")
        self.assertEqual(bump["id"], before["root"]["children"][0]["bumps"][0]["id"])
        self.assertEqual(main.provenance()[bump["id"]], trace[bump["id"]])
        self.assertEqual(main.clone().provenance(), main.provenance())

    def test_carrier_and_frame_copy_origins_and_detachment(self):
        main = sourced(layer(key="soc"), "main")
        carrier = sourced(layer(key="carrier", material="Glass"), "carrier", "carrier_geometry")
        frame = sourced(layer(key="frame", material="Steel"), "frame", "frame_geometry")
        main.begin_provenance_step("bond", "bonding/bonding")
        main.bond_carrier_geometry(carrier)
        bonded = main.provenance()
        carrier_entries = [entry for entry in bonded.values()
                           if entry["createdBy"] and entry["createdBy"]["operation"] == "bond_carrier"]
        self.assertEqual(len(carrier_entries), 1)
        self.assertEqual(carrier_entries[0]["sources"][0]["ownerId"], "carrier")
        main.begin_provenance_step("mount", "frame/mount")
        main.mount_frame_geometry(frame)
        mounted = main.provenance()
        frame_ids = [node_id for node_id, entry in mounted.items()
                     if entry["createdBy"] and entry["createdBy"]["operation"] == "mount_frame"]
        self.assertEqual(len(frame_ids), 1)
        main.remove_mounted_frame()
        self.assertNotIn(frame_ids[0], main.provenance())
        main.remove_bonded_carrier_stack()
        self.assertFalse(any(entry["createdBy"] and entry["createdBy"]["operation"] == "bond_carrier"
                             for entry in main.provenance().values()))

    def test_identical_sources_and_branches_have_qualified_independent_origins(self):
        geometry = layer(key="soc").to_geometry_structure()
        def execute(context):
            if context.step_ref["stepRefId"] == "merge":
                context.state.place_geometry_state(context.require_geometry("aux"), x=20, y=0)
            return context.state
        resolver = SimpleNamespace(resolve=lambda _: SimpleNamespace(execute=execute))
        plan = ExecutionPlan(steps=[
            step("left", "test/preserve", {"main_geometry": external("left-source")}),
            step("right", "test/preserve", {"main_geometry": external("right-source")}),
            step("merge", "test/copy", {"main_geometry": upstream("left"), "aux": upstream("right")}),
        ], external_geometries={name: GeometryArtifact.from_structure(geometry)
                                for name in ("left-source", "right-source")}, terminal_step_ref_ids=["merge"])
        result = GeometryKernel(module_resolver=resolver).execute(plan)
        output, trace = result.geometry(), result.step_provenance("merge")
        left = trace[output["root"]["id"]]["sources"]
        right = trace[output["root"]["children"][0]["id"]]["sources"]
        self.assertEqual({ref["ownerId"] for ref in left}, {"left-source", "left"})
        self.assertEqual({ref["ownerId"] for ref in right}, {"right-source", "right"})
        self.assertTrue(any(ref["inputPortId"] == "aux" for ref in right))
        result.step_provenance("merge")[output["root"]["id"]]["sources"].clear()
        self.assertEqual(result.step_provenance("merge")[output["root"]["id"]]["sources"], left)

    def test_new_raw_structure_nodes_are_attributed_without_changing_geometry(self):
        geometry = layer(key="carrier", material="Glass").to_geometry_structure()
        def execute(context):
            output = copy.deepcopy(context.input_geometry)
            output["root"]["bodies"].append({"material": "Cu", "geometry": {
                "type": "BoxGeometry", "bottom_left": [0, 0, 10],
                "top_right": [10, 10, 10], "thk": 2}})
            return output
        resolver = SimpleNamespace(resolve=lambda _: SimpleNamespace(execute=execute))
        plan = ExecutionPlan(steps=[step("deposit", "test/deposit", {"main_geometry": external("main")})],
            external_geometries={"main": GeometryArtifact.from_structure(geometry)}, terminal_step_ref_ids=["deposit"])
        result = GeometryKernel(module_resolver=resolver).execute(plan)
        output = result.geometry()
        entry = result.step_provenance("deposit")[output["root"]["bodies"][-1]["id"]]
        self.assertEqual(entry["sources"], [])
        self.assertEqual(entry["createdBy"]["stepRefId"], "deposit")
        self.assertEqual(entry["createdBy"]["operation"], "create")
        self.assertEqual(output["root"]["bodies"][0], geometry["root"]["bodies"][0])


if __name__ == "__main__":
    unittest.main()
