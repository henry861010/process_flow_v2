"""Planner and lineage regressions using real process execution for the target."""
import asyncio
import copy
import json
import unittest
from dataclasses import asdict
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from process_flow_kernel import normalize_geometry_structure
from process_flow_api.schematic_builder import build_schematic
from process_flow_api.schematic_planning import (
    bind_schematic_snapshots, plan_flow_schematic, schematic_layout_fingerprint,
)
from process_flow_api.services import PreviewRequestContext, materialize_preview_snapshots, prepare_preview_execution


TEMPLATES = json.loads((Path(__file__).parents[1] / "src/process_flow_api/fixtures/process-step-templates.json").read_text())


def entity(id_, key=None, *, children=()):
    root = {"bodies": [{"material": "Si" if key != "carrier" else "glass",
                        "geometry": {"type": "BoxGeometry", "bottom_left": [0, 0, 0],
                                     "top_right": [100, 100, 0], "thk": 10}}], "children": list(children)}
    if key is not None:
        root["key"] = key
    return {"id": id_, "structure": normalize_geometry_structure(root)}


def placement(x=0):
    return {"targetRegion": {"type": "rectangle", "bottomLeftX": x, "bottomLeftY": 0,
                             "topRightX": x + 10, "topRightY": 10},
            "pose": {"x": 0, "y": 0, "rotationZ": 0}, "anchor": "center"}


def edge(id_, source, ref, port="main_geometry"):
    return {"edgeId": id_, "source": source, "target": {"stepRefId": ref, "inputPortId": port}}


def inp(id_):
    return {"kind": "flowInput", "flowInputId": id_}


def out(id_):
    return {"kind": "stepOutput", "stepRefId": id_, "outputPortId": "result_geometry"}


def recipe(values):
    return {"selectedRecipeId": "r", "recipeCandidates": [{"recipeId": "r", "name": "Recipe", "parameterValues": values}]}


def context(*, source=None, placements=None):
    geometries = {"base": entity("base", "carrier"), "die": source or entity("die", "soc")}
    return PreviewRequestContext(
        definition={"flowInputs": [{"flowInputId": id_, "name": id_, "dataType": "geometry", "required": True}
                                  for id_ in geometries],
                    "stepRefs": [{"stepRefId": "first", "processStepTemplateId": "step_tpl_pnp"}],
                    "flowEdges": [edge("main", inp("base"), "first"), edge("die", inp("die"), "first", "die_geometry")]},
        step_templates=tuple(TEMPLATES),
        configuration={"inputBindings": {id_: {"kind": "catalog", "geometryId": id_} for id_ in geometries},
                       "stepConfigurations": {"first": recipe({"placements": placements if placements is not None else [placement()]})}},
        target={"type": "stepOutput", "stepRefId": "first", "outputPortId": "result_geometry"},
        source_label=None, referenced_catalog_geometries=geometries,
    )


def add_step(ctx, id_, program, main, values, die=None):
    template = next(template for template in TEMPLATES if template["program"] == program)
    ctx.definition["stepRefs"].append({"stepRefId": id_, "processStepTemplateId": template["id"]})
    ctx.definition["flowEdges"].append(edge(f"main-{id_}", main, id_))
    if die is not None:
        ctx.definition["flowEdges"].append(edge(f"die-{id_}", die, id_, "die_geometry"))
    ctx.configuration["stepConfigurations"][id_] = recipe(values)


def execute_document(ctx):
    planning = plan_flow_schematic(ctx, None)
    prepared = prepare_preview_execution(ctx, None)
    snapshots = asyncio.run(materialize_preview_snapshots(prepared))
    bindings = bind_schematic_snapshots(planning, prepared, snapshots)
    target = snapshots[-1]
    document = build_schematic(target.geometry_structure, layout_plan=planning.layout_for(ctx.target),
                               component_bindings=bindings[target.step_ref_id])
    return planning, document, snapshots, bindings


class SchematicPlanningTests(unittest.TestCase):
    def test_planning_is_target_independent_and_does_not_execute_or_compile(self):
        ctx = context()
        add_step(ctx, "later", "pnp/pnp", out("first"), {"placements": [placement(20)]}, inp("die"))
        before = copy.deepcopy(ctx)
        with patch("process_flow_kernel.FlowCompiler.compile", side_effect=AssertionError("no compile")), \
             patch("process_flow_kernel.GeometryKernel.execute", side_effect=AssertionError("no future execution")):
            first = plan_flow_schematic(ctx, None)
            later_context = replace(ctx, target={"type": "stepOutput", "stepRefId": "later"}, source_label="Other title")
            later = plan_flow_schematic(later_context, None)
        self.assertEqual(first.layout_for(ctx.target), later.layout_for(later_context.target))
        self.assertEqual(schematic_layout_fingerprint(ctx), schematic_layout_fingerprint(later_context))
        self.assertEqual(ctx, before)

    def test_each_pnp_batch_has_fixed_representative_despite_physical_count(self):
        ctx = context(placements=[placement(), placement(20)])
        add_step(ctx, "second", "pnp/pnp", out("first"), {"placements": [placement(40)]}, inp("die"))
        first_plan, first, _, _ = execute_document(ctx)
        later_ctx = replace(ctx, target={"type": "stepOutput", "stepRefId": "second", "outputPortId": "result_geometry"})
        _, later, _, _ = execute_document(later_ctx)
        self.assertEqual(len(first_plan.layout_for(ctx.target).slots), 2)
        self.assertEqual(len(first["components"]), 1)
        self.assertEqual(len(later["components"]), 2)
        self.assertEqual((first["components"][0]["id"], first["components"][0]["x"]),
                         (later["components"][0]["id"], later["components"][0]["x"]))
        self.assertEqual(len(first["components"][0]["sourceIds"]), 2)

    def test_nested_pnp_rekeys_source_container_ids_without_losing_slots(self):
        ctx = context()
        ctx.definition["flowInputs"].append({"flowInputId": "outer", "name": "outer", "dataType": "geometry", "required": True})
        ctx.configuration["inputBindings"]["outer"] = {"kind": "catalog", "geometryId": "outer"}
        ctx.referenced_catalog_geometries["outer"] = entity("outer", "carrier")
        outer_placements = [placement(), placement(200)]
        for item in outer_placements:
            item["targetRegion"]["topRightX"] = item["targetRegion"]["bottomLeftX"] + 100
            item["targetRegion"]["topRightY"] = 100
        add_step(ctx, "outer-place", "pnp/pnp", inp("outer"), {"placements": outer_placements}, out("first"))
        ctx = replace(ctx, target={"type": "stepOutput", "stepRefId": "outer-place", "outputPortId": "result_geometry"})
        planning, document, snapshots, bindings = execute_document(ctx)
        self.assertEqual(document["warnings"], [])
        self.assertEqual(len(document["components"]), 1)
        self.assertEqual(len(document["components"][0]["sourceIds"]), 2)
        source_id = snapshots[0].geometry_structure["root"]["children"][0]["id"]
        self.assertNotIn(source_id, document["components"][0]["sourceIds"])
        self.assertTrue(set(document["components"][0]["sourceIds"]) <= bindings["outer-place"].keys())
        self.assertNotEqual(planning.layout_for({"type": "stepOutput", "stepRefId": "first"}).fingerprint,
                            planning.layout_for(ctx.target).fingerprint)

    def test_unkeyed_imported_die_gets_slot_when_placed(self):
        ctx = context(source=entity("die"))
        _, document, _, _ = execute_document(ctx)
        self.assertEqual(document["warnings"], [])
        self.assertEqual(len(document["components"]), 1)
        self.assertEqual(document["components"][0]["label"], "Component")

    def test_ecl_on_imported_source_reserves_its_newly_selected_wrapper_without_marker_geometry(self):
        child = entity("inner")["structure"]["root"]
        # The imported root retains a planar footprint for layer execution;
        # only its child initially has positive-thickness visible geometry.
        for node in (child, *child["bodies"]):
            node.pop("id", None)
        source = entity("die", children=[child])
        source["structure"]["root"]["bodies"][0]["geometry"]["thk"] = 0
        ctx = context(source=source)
        add_step(ctx, "coat-source", "layer/ecl", inp("die"), {"material": "PI", "thk": 2, "koz": 0})
        next(edge for edge in ctx.definition["flowEdges"]
             if edge["target"] == {"stepRefId": "first", "inputPortId": "die_geometry"})["source"] = out("coat-source")
        before = copy.deepcopy(ctx)

        planning, document, snapshots, _ = execute_document(ctx)

        self.assertEqual(ctx, before)
        self.assertEqual(document["warnings"], [])
        self.assertEqual(len(document["components"]), 1)
        placed_root = snapshots[-1].geometry_structure["root"]["children"][0]
        self.assertEqual(document["components"][0]["sourceIds"], [placed_root["id"]])
        self.assertEqual(len(planning.layout_for(ctx.target).slots), 1)
        self.assertEqual(document["totalThickness"], 22)
        self.assertEqual(next(item for item in document["items"] if item["material"] == "PI")["thickness"], 2)
        self.assertNotIn("layout-presence", json.dumps(document))
        self.assertNotIn("layout-presence", json.dumps([snapshot.geometry_structure for snapshot in snapshots]))
        for scene in (*planning.inputs.values(), *planning.outputs.values()):
            self.assertNotIn("geometry", asdict(scene))
            self.assertTrue(all(obj.source_ref for obj in scene.objects))
            self.assertNotIn("layout-presence", json.dumps(asdict(scene)))

    def test_grind_removing_imported_wrapper_body_keeps_surviving_child_in_its_slot(self):
        child = entity("inner")["structure"]["root"]
        for node in (child, *child["bodies"]):
            node.pop("id", None)
        source = entity("die", children=[child])
        wrapper_geometry = source["structure"]["root"]["bodies"][0]["geometry"]
        wrapper_geometry["bottom_left"][2] = wrapper_geometry["top_right"][2] = 10
        wrapper_geometry["thk"] = 5
        ctx = context(source=source)
        add_step(ctx, "remove-wrapper-body", "grinding/grinding", out("first"), {"thk": 5})
        _, before, _, _ = execute_document(ctx)
        ground_context = replace(ctx, target={"type": "stepOutput", "stepRefId": "remove-wrapper-body",
                                              "outputPortId": "result_geometry"})

        _, after, snapshots, bindings = execute_document(ground_context)

        self.assertEqual(before["warnings"], [])
        self.assertEqual(after["warnings"], [])
        self.assertEqual(len(after["components"]), 1)
        self.assertEqual([(component["id"], component["x"], component["width"]) for component in before["components"]],
                         [(component["id"], component["x"], component["width"]) for component in after["components"]])
        wrapper = snapshots[-1].geometry_structure["root"]["children"][0]
        survivor = wrapper["children"][0]
        self.assertEqual(wrapper["bodies"], [])
        self.assertEqual(after["components"][0]["sourceIds"], [survivor["id"]])
        self.assertEqual(bindings["remove-wrapper-body"][wrapper["id"]],
                         bindings["remove-wrapper-body"][survivor["id"]])

    def test_equivalent_imported_siblings_freeze_one_entry_class(self):
        child = entity("child", "soc")["structure"]["root"]
        other = copy.deepcopy(child)
        # Let normalization allocate unique IDs for the second physical instance.
        for node in (other, *other["bodies"]):
            node.pop("id", None)
        source = {"id": "die", "structure": normalize_geometry_structure({"key": "carrier", "children": [child, other]})}
        ctx = context(source=source)
        _, document, _, _ = execute_document(ctx)
        self.assertEqual(document["warnings"], [])
        self.assertEqual(len(document["components"]), 1)
        self.assertEqual(len(document["components"][0]["sourceIds"]), 2)

    def test_saw_removes_first_representative_and_preserves_survivor_in_cow(self):
        ctx = context(placements=[placement(), placement(20)])
        add_step(ctx, "cut", "saw/saw", out("first"), {"bottomLeftX": 20, "bottomLeftY": 0, "topRightX": 30, "topRightY": 10})
        _, _, snapshots, _ = execute_document(ctx)
        surviving_id = snapshots[-1].geometry_structure["root"]["children"][1]["id"]
        surviving_body_id = snapshots[-1].geometry_structure["root"]["children"][1]["bodies"][0]["id"]
        ctx = replace(ctx, target={"type": "stepOutput", "stepRefId": "cut", "outputPortId": "result_geometry"})
        planning, cut, snapshots, _ = execute_document(ctx)
        self.assertEqual(cut["warnings"], [])
        root = snapshots[-1].geometry_structure["root"]
        self.assertEqual(root["key"], "cow")
        self.assertEqual(root["children"][0]["id"], surviving_id)
        self.assertEqual(cut["components"][0]["label"], "CoW")
        self.assertNotIn("diagramLabel", cut["components"][0])
        self.assertEqual(len(cut["components"][0]["sourceIds"]), 1)
        self.assertNotEqual(planning.outputs["first"].phase_id, planning.outputs["cut"].phase_id)
        self.assertTrue(any(surviving_body_id in item["sourceIds"] for item in cut["items"]))

    def test_grinding_changes_thickness_without_reallocating_slots(self):
        ctx = context()
        add_step(ctx, "grind", "grinding/grinding", out("first"), {"thk": 2})
        _, first, _, _ = execute_document(ctx)
        ctx = replace(ctx, target={"type": "stepOutput", "stepRefId": "grind", "outputPortId": "result_geometry"})
        _, ground, _, _ = execute_document(ctx)
        self.assertEqual(ground["warnings"], [])
        self.assertEqual([(c["id"], c["x"], c["width"]) for c in first["components"]],
                         [(c["id"], c["x"], c["width"]) for c in ground["components"]])
        self.assertEqual(first["totalThickness"] - ground["totalThickness"], 2)

    def test_unknown_future_process_stops_only_that_lookahead(self):
        ctx = context()
        add_step(ctx, "unknown", "flip/flip", out("first"), {})
        templates = copy.deepcopy(list(ctx.step_templates))
        next(t for t in templates if t["program"] == "flip/flip")["program"] = "custom/unknown"
        ctx = replace(ctx, step_templates=tuple(templates))
        add_step(ctx, "after", "pnp/pnp", out("unknown"), {"placements": [placement(20)]}, inp("die"))
        plan = plan_flow_schematic(ctx, None)
        self.assertEqual(len(plan.layout_for(ctx.target).slots), 1)
        self.assertTrue(any("unknown" in note for note in plan.layout_for(ctx.target).notes))
        self.assertNotIn("after", plan.outputs)


if __name__ == "__main__":
    unittest.main()
