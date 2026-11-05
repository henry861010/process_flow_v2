"""Failures in one semantic layout must not hide an executable snapshot."""
import unittest

from process_flow_schematic import ComponentHint, SchematicPart, SchematicRegistry, compose_schematic
from process_flow_schematic.flow import FlowNode, FlowSource, SnapshotBindings, plan_flow
from process_flow_schematic.scene import LayoutRegion, SchematicDelta, SchematicObject


def body(id_, z, thickness):
    return {"id": id_, "material": "Si", "geometry": {
        "type": "BoxGeometry", "bottom_left": [0, 0, z], "top_right": [100, 100, z], "thk": thickness}}


def structure():
    return {"unitSystem": "um", "root": {
        "id": "root", "key": "carrier", "bodies": [body("base", 0, 5)],
        "children": [{"id": "die", "key": "soc", "bodies": [body("silicon", 5, 10)]}],
    }}


def registry():
    result = SchematicRegistry()
    result.register("container", lambda context: [], key="carrier")
    result.register("container", lambda context: [SchematicPart("SoC", component=ComponentHint("SoC", role="soc"))], key="soc")
    return result


class SceneFlowTests(unittest.TestCase):
    def test_ready_nodes_are_described_in_stable_topological_order(self):
        # DFS sorted by output ID would pull z before b just to visit a first.
        nodes = (
            FlowNode("a", "preserve", (("main_geometry", FlowSource("stepOutput", "z", "result_geometry")),)),
            FlowNode("z", "preserve", (("main_geometry", FlowSource("flowInput", "main")),)),
            FlowNode("b", "preserve", (("main_geometry", FlowSource("flowInput", "other")),)),
        )
        seen = []

        def describe(node, parameters, inputs):
            seen.append(node.id)
            return SchematicDelta()

        plan_flow(nodes, fingerprint="revision", registry=registry(),
                  resolve_input=lambda _: structure(), resolve_parameters=lambda _: {}, describe=describe)
        self.assertEqual(seen, ["b", "z", "a"])

    def test_unbound_visible_physical_source_uses_warned_local_layout(self):
        plan = plan_flow((FlowNode("step", "preserve", (("main_geometry", FlowSource("flowInput", "main")),)),),
                         fingerprint="revision", registry=registry(), resolve_input=lambda _: structure(),
                         resolve_parameters=lambda _: {}, describe=lambda *_: SchematicDelta())
        scene = plan.outputs["step"]
        layout = plan.layout_for({"type": "stepOutput", "stepRefId": "step"})
        mapping = dict(plan.input_bindings["main"])
        mapping["die"] = layout.slots[0].group_key
        logical = dict(plan.input_bindings["main"])
        del logical["silicon"]
        bindings = SnapshotBindings(mapping, scene=scene, logical=logical, physical_data=())
        document = compose_schematic(structure(), registry(), layout_plan=layout, component_bindings=bindings)
        self.assertEqual(len(document["components"]), 1)
        self.assertTrue(any(item["sourceIds"] == ["silicon"] for item in document["items"]))
        self.assertTrue(any("cannot be bound" in warning for warning in document["warnings"]))

    def test_contradictory_future_phase_uses_local_layout_without_affecting_other_phases(self):
        nodes = (
            FlowNode("prefix", "preserve", (("main_geometry", FlowSource("flowInput", "main")),)),
            FlowNode("bad", "contradictory", (("main_geometry", FlowSource("stepOutput", "prefix", "result_geometry")),)),
            FlowNode("independent", "preserve", (("main_geometry", FlowSource("flowInput", "other")),)),
        )

        def describe(node, parameters, inputs):
            if node.program != "contradictory":
                return SchematicDelta()
            root = next(obj.id for obj in inputs["main_geometry"].objects if obj.parent_id is None)
            # Object and region parent hierarchies are acyclic. The additional
            # member/region ownership requirements cannot be laid out together.
            return SchematicDelta(
                creates=(SchematicObject("a", "component", "soc", "A", parent_id=root,
                                         layout="member", nesting="arranged", region_id="region-b"),
                         SchematicObject("b", "component", "hbm", "B", parent_id=root,
                                         layout="member", nesting="arranged", region_id="region-a")),
                add_regions=(LayoutRegion("region-a", "a"), LayoutRegion("region-b", "b")))

        plan = plan_flow(nodes, fingerprint="revision", registry=registry(),
                         resolve_input=lambda input_id: structure(), resolve_parameters=lambda step_id: {},
                         describe=describe)
        prefix_target = {"type": "stepOutput", "stepRefId": "prefix"}
        other_target = {"type": "stepOutput", "stepRefId": "independent"}
        phase_id = plan.outputs["prefix"].phase_id
        self.assertIn("Cyclic region ownership layout", plan.layout_failures[phase_id])
        self.assertNotIn(phase_id, plan.scene_layouts)
        fallback = plan.layout_for(prefix_target)
        self.assertEqual(fallback.slots, ())
        self.assertTrue(any("local layout" in note and phase_id in note for note in fallback.notes))
        self.assertEqual(len(plan.layout_for(other_target).slots), 1)
        self.assertNotIn(plan.outputs["independent"].phase_id, plan.layout_failures)

        document = compose_schematic(structure(), registry(), layout_plan=fallback)
        self.assertEqual(len(document["components"]), 1)
        self.assertEqual(document["components"][0]["sourceIds"], ["die"])
        self.assertTrue(any(item["sourceIds"] == ["silicon"] for item in document["items"]))
        self.assertTrue(any("local layout" in warning for warning in document["warnings"]))
        self.assertTrue(any(phase_id in note and "Cyclic" in note for note in document["notes"]))


if __name__ == "__main__":
    unittest.main()
