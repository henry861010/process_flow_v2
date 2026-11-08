"""Acceptance of semantic planning through independently executed API targets."""
from __future__ import annotations

import copy
from dataclasses import replace
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from process_flow_kernel import normalize_geometry_structure
from process_flow_schematic.geometry import geometry_bounds
from process_flow_schematic.scene_layout import SceneLayoutPolicy
from process_flow_api.main import create_app
from process_flow_api.schematic_planning import plan_flow_schematic, schematic_layout_fingerprint
from test_schematic_planning import add_step, context, entity, execute_document, inp, out, placement


def _box(z, thickness, size=100):
    return {"type": "BoxGeometry", "bottom_left": [0, 0, z],
            "top_right": [size, size, z], "thk": thickness}


def _target(ctx, step):
    return replace(ctx, target={"type": "stepOutput", "stepRefId": step, "outputPortId": "result_geometry"})


def _tiv_lsi_flow(density=40):
    source = {"id": "die", "structure": normalize_geometry_structure({
        "key": "lsi", "bodies": [{"id": "lsi-body", "material": "Si", "geometry": _box(2, 10)}],
        "bumps": [{"id": "lsi-bump", "material": "SnAg", "density": 40, "direction": "-z", "koz": 0,
                   "stage": "reflowed", "geometry": _box(0, 2)}],
    })}
    ctx = context(source=source, placements=[placement(30)])
    add_step(ctx, "formation", "bump/uBump_formation", inp("base"),
             {"material": "SnAg", "thk": 2, "density": 40, "koz": 0})
    add_step(ctx, "tiv", "tmv/tmv", out("formation"), {"material": "Cu", "thk": 14, "density": density})
    next(item for item in ctx.definition["flowEdges"] if item["edgeId"] == "main")["source"] = out("tiv")
    add_step(ctx, "joint", "joint/mr_joint", out("first"), {"bump_joined_height": 3})
    return ctx


def _tiv_rectangles(document):
    item_ids = {item["id"] for item in document["items"] if item["label"].startswith("Via · ")}
    return sorted((shape["x"], shape["width"]) for shape in document["shapes"]
                  if shape["kind"] == "rect" and shape["itemId"] in item_ids)


def _add_catalog_input(ctx, geometry):
    identifier = geometry["id"]
    ctx.referenced_catalog_geometries[identifier] = geometry
    ctx.definition["flowInputs"].append({"flowInputId": identifier, "name": identifier,
                                         "dataType": "geometry", "required": True})
    ctx.configuration["inputBindings"][identifier] = {"kind": "catalog", "geometryId": identifier}


def _physical_nodes(root):
    result = {node["id"]: node for collection in ("bodies", "vias", "circuits", "bumps")
              for node in root.get(collection, ())}
    for child in root.get("children", ()):
        result.update(_physical_nodes(child))
    return result


def _support_span(document, structure):
    source_id = structure["root"]["bodies"][0]["id"]
    item_ids = {item["id"] for item in document["items"] if source_id in item["sourceIds"]}
    return [(shape["x"], shape["width"]) for shape in document["shapes"]
            if shape["kind"] == "rect" and shape["itemId"] in item_ids]


class SchematicSemanticFlowTests(unittest.TestCase):
    def test_wafer_dummy_bounds_free_tiv_symbols_before_and_after_placement(self):
        ctx = context()
        _add_catalog_input(ctx, entity("dummy", "wafer-dmy"))
        add_step(ctx, "tiv", "tmv/tmv", inp("base"), {"material": "Cu", "thk": 14, "density": 40})
        next(item for item in ctx.definition["flowEdges"] if item["edgeId"] == "main")["source"] = out("tiv")
        add_step(ctx, "dummy-place", "pnp/pnp", out("first"), {"placements": [placement(60)]}, inp("dummy"))
        documents = []
        for step in ("tiv", "first", "dummy-place"):
            planning, document, snapshots, _ = execute_document(_target(ctx, step))
            self.assertEqual(document["warnings"], [])
            scene_plan = planning.scene_layouts[planning.outputs[step].phase_id]
            slots = sorted((slot for slot in scene_plan.slots
                            if planning.outputs["dummy-place"].object_map[slot.object_id].role == "wafer-dmy"),
                           key=lambda slot: slot.x)
            self.assertEqual(len(slots), 2)
            left, right = slots
            support_x, support_width = _support_span(document, snapshots[-1].geometry_structure)[0]
            self.assertEqual(left.x - support_x, SceneLayoutPolicy().edge_inset)
            self.assertEqual(support_x + support_width - right.x - right.width,
                             SceneLayoutPolicy().edge_inset)
            pillars = _tiv_rectangles(document)
            self.assertEqual(len(pillars), 9)
            self.assertTrue(all(left.x + left.width < x and x + width < right.x for x, width in pillars))
            documents.append(document)
        self.assertEqual(_tiv_rectangles(documents[0]), _tiv_rectangles(documents[1]))
        self.assertEqual(_tiv_rectangles(documents[1]), _tiv_rectangles(documents[2]))
        dummies = sorted((item for item in documents[-1]["components"] if item["label"] == "Wafer DMY"),
                         key=lambda item: item["x"])
        self.assertEqual(len(dummies), 2)
        self.assertEqual(dummies[0]["x"], left.x)
        self.assertEqual(dummies[1]["x"], right.x)

    def test_repeated_dummy_members_keep_the_same_local_pillars_inside_each_slot(self):
        source = entity("die", "wafer-dmy")
        root = source["structure"]["root"]
        root["vias"] = [{"material": "Cu", "density": 40, "direction": "+z", "koz": 0,
                         "geometry": _box(0, 10)}]
        source["structure"] = normalize_geometry_structure(root)
        ctx = context(source=source)
        _, document, snapshots, _ = execute_document(ctx)
        self.assertEqual(document["warnings"], [])
        members = sorted(document["components"], key=lambda value: value["x"])
        self.assertEqual(len(members), 2)
        via_id = snapshots[-1].geometry_structure["root"]["children"][0]["vias"][0]["id"]
        item_id = next(item["id"] for item in document["items"] if item["sourceIds"] == [via_id])
        pillars = [shape for shape in document["shapes"] if shape["itemId"] == item_id]
        self.assertEqual(len(pillars), 18)
        offsets = []
        for member in members:
            local = [shape["x"] - member["x"] for shape in pillars
                     if member["x"] <= shape["x"] and
                     shape["x"] + shape["width"] <= member["x"] + member["width"]]
            self.assertEqual(len(local), 9)
            offsets.append(local)
        for left, right in zip(*offsets):
            self.assertAlmostEqual(left, right)

    def test_wire_rdl_group_normalizes_before_lookahead_and_binds_through_flip(self):
        ctx = context()
        layers = {"items": [{"itemId": f"layer-{index}", "index": index,
                              "values": {"Dielectric": "PI", "Conductivity": "Cu",
                                         "thk": thickness, "density": density}}
                             for index, (thickness, density) in enumerate(((2, 40), (3, 40), (4, 0), (5, 40)))]}
        add_step(ctx, "rdl", "layer/rdl", inp("base"), {"layers": layers})
        next(item for item in ctx.definition["flowEdges"] if item["edgeId"] == "main")["source"] = out("rdl")
        add_step(ctx, "flip", "flip/flip", out("first"), {})
        positions, widths, rdl_ids = [], [], None
        for step in ("rdl", "first", "flip"):
            planning, document, snapshots, bindings = execute_document(_target(ctx, step))
            self.assertEqual(set(planning.outputs), {"rdl", "first", "flip"})
            self.assertEqual(document["warnings"], [])
            self.assertFalse(any("stopped" in note for note in document["notes"]))
            self.assertEqual(len(planning.layout_for(_target(ctx, step).target).slots), 1)
            root = snapshots[-1].geometry_structure["root"]
            rdl_bodies = [body for body in root["bodies"] if body.get("key") == "rdl"]
            self.assertEqual(sorted(geometry_bounds(body["geometry"]).thickness for body in rdl_bodies), [2, 3, 4, 5])
            if rdl_ids is None:
                rdl_ids = {body["id"] for body in rdl_bodies}
            self.assertEqual({body["id"] for body in rdl_bodies}, rdl_ids)
            samples = {sample.source_id: sample for data in bindings[step].physical_data for sample in data.samples}
            actual = _physical_nodes(root)
            self.assertEqual(set(samples), set(actual))
            for node_id, node in actual.items():
                bounds = geometry_bounds(node["geometry"])
                self.assertEqual((samples[node_id].z_min, samples[node_id].z_max, samples[node_id].material),
                                 (bounds.z_min, bounds.z_max, node["material"]))
            self.assertEqual(sorted(samples[node_id].thickness for node_id in rdl_ids), [2, 3, 4, 5])
            widths.append(document["viewBox"][2])
            if step == "rdl":
                self.assertEqual(document["components"], [])
                self.assertEqual(root["children"], [])
            else:
                self.assertEqual(len(document["components"]), 1)
                member = document["components"][0]
                positions.append((member["id"], member["x"], member["width"]))
        self.assertEqual(len(set(widths)), 1)
        self.assertEqual(positions[0], positions[1])

    def test_soc_hbm_lsi_share_fixed_members_support_and_atomic_stack(self):
        ctx = context()
        stacked = {"id": "hbm", "structure": normalize_geometry_structure({
            "key": "hbm", "bodies": [{"key": "envelope", "material": "EMC", "geometry": _box(0, 15)}],
            "children": [{"key": "dram", "bodies": [{"material": "Si", "geometry": _box(index * 5, 3)}]}
                         for index in range(3)],
        })}
        _add_catalog_input(ctx, stacked)
        _add_catalog_input(ctx, entity("lsi", "lsi"))
        add_step(ctx, "hbm-place", "pnp/pnp", out("first"), {"placements": [placement(30)]}, inp("hbm"))
        add_step(ctx, "lsi-place", "pnp/pnp", out("hbm-place"), {"placements": [placement(60)]}, inp("lsi"))
        previous = {}
        widths, supports = [], []
        final_document = None
        for step, expected in (("first", {"SoC"}), ("hbm-place", {"SoC", "HBM"}),
                               ("lsi-place", {"SoC", "HBM", "LSI"})):
            planning, document, snapshots, _ = execute_document(_target(ctx, step))
            self.assertEqual(document["warnings"], [])
            self.assertEqual({item["label"] for item in document["components"]}, expected)
            self.assertEqual(len(planning.layout_for(_target(ctx, step).target).slots), 3)
            positions = {item["label"]: (item["id"], item["x"], item["width"])
                         for item in document["components"]}
            for name, position in previous.items():
                self.assertEqual(position, positions[name])
            previous = positions
            widths.append(document["viewBox"][2])
            supports.append(_support_span(document, snapshots[-1].geometry_structure))
            final_document = document
        self.assertEqual(len(set(widths)), 1)
        self.assertTrue(supports[0])
        self.assertTrue(all(support == supports[0] for support in supports))
        hbm = next(child for child in snapshots[-1].geometry_structure["root"]["children"] if child["key"] == "hbm")
        self.assertEqual(len(hbm["children"]), 3)
        self.assertEqual(len([item for item in final_document["components"] if item["label"] == "HBM"]), 1)
        internal_ids = {body["id"] for child in hbm["children"] for body in child["bodies"]}
        shown_internal_ids = {source for item in final_document["items"] if item["groupLabel"] == "HBM"
                              for source in item["sourceIds"]}
        self.assertTrue(internal_ids <= shown_internal_ids)
        repeated = copy.deepcopy(ctx)
        for step, x in (("first", 15), ("hbm-place", 45), ("lsi-place", 75)):
            repeated.configuration["stepConfigurations"][step]["recipeCandidates"][0]["parameterValues"]["placements"].append(placement(x))
        _, repeated_document, _, _ = execute_document(_target(repeated, "lsi-place"))
        self.assertEqual({item["label"]: (item["id"], item["x"], item["width"])
                          for item in repeated_document["components"]}, previous)
        self.assertTrue(all(len(item["sourceIds"]) == 2 for item in repeated_document["components"]))
        self.assertEqual(repeated_document["viewBox"][2], widths[0])

    def test_grind_then_saw_retains_heterogeneous_measurements_and_first_survivor(self):
        source = {"id": "die", "structure": normalize_geometry_structure({
            "key": "soc", "bodies": [{"id": "soc-body", "material": "Si", "geometry": _box(2, 10)}],
            "bumps": [{"id": "upper", "material": "SnAg", "density": 40, "direction": "-z", "koz": 0,
                       "stage": "reflowed", "geometry": _box(0, 2)}],
        })}
        ctx = context(source=source, placements=[placement(), placement(30)])
        root = ctx.referenced_catalog_geometries["base"]["structure"]["root"]
        root["bumps"] = [{"material": "SnAg", "density": 40, "direction": "+z", "koz": 0,
                          "stage": "reflowed", "geometry": {
                              "type": "BoxGeometry", "bottom_left": [x, 0, 10],
                              "top_right": [x + 10, 10, 10], "thk": thickness}}
                         for x, thickness in ((0, 2), (30, 6))]
        ctx.referenced_catalog_geometries["base"]["structure"] = normalize_geometry_structure(root)
        add_step(ctx, "grind", "grinding/grinding", out("first"), {"thk": 6})
        add_step(ctx, "cut", "saw/saw", out("grind"),
                 {"bottomLeftX": 30, "bottomLeftY": 0, "topRightX": 40, "topRightY": 10})
        _, ground, snapshots, bindings = execute_document(_target(ctx, "grind"))
        self.assertEqual(ground["warnings"], [])
        self.assertEqual(len(ground["components"]), 1)
        children = snapshots[-1].geometry_structure["root"]["children"]
        bodies = [child["bodies"][0] for child in children]
        self.assertEqual({geometry_bounds(body["geometry"]).thickness for body in bodies}, {4, 8})
        measured = [item for item in ground["items"] if item["groupLabel"] == "SoC" and item["material"] == "Si"]
        self.assertEqual({item["thickness"] for item in measured}, {4, 8})
        self.assertTrue(any("first remaining instance" in note for note in ground["notes"]))
        displayed_items = {shape["itemId"] for shape in ground["shapes"]}
        self.assertTrue(any(bodies[0]["id"] in item["sourceIds"] and item["id"] in displayed_items for item in measured))
        self.assertTrue(all(item["id"] not in displayed_items for item in measured if bodies[1]["id"] in item["sourceIds"]))
        bound_samples = {sample.source_id: sample for data in bindings["grind"].physical_data for sample in data.samples}
        self.assertEqual({bound_samples[body["id"]].thickness for body in bodies}, {4, 8})
        planning, cut, cut_snapshots, _ = execute_document(_target(ctx, "cut"))
        self.assertEqual(cut["warnings"], [])
        root = cut_snapshots[-1].geometry_structure["root"]
        self.assertEqual(root["key"], "cow")
        self.assertEqual(root["children"][0]["id"], children[1]["id"])
        self.assertEqual(cut["components"][0]["label"], "CoW")
        self.assertNotEqual(planning.outputs["grind"].phase_id, planning.outputs["cut"].phase_id)
        self.assertEqual([item["thickness"] for item in cut["items"]
                          if bodies[1]["id"] in item["sourceIds"]], [4])
        self.assertFalse(any("different instance structures" in note for note in cut["notes"]))

    def test_http_targets_rebuild_the_same_layout_after_cache_eviction(self):
        ctx = _tiv_lsi_flow()
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(db_path=Path(directory) / "semantic.sqlite3")
            try:
                for template in ctx.step_templates:
                    if app.state.store.get_process_step_template(template["id"]) is None:
                        app.state.store.insert_process_step_template(template)
                for geometry_id, geometry in ctx.referenced_catalog_geometries.items():
                    app.state.store.insert_geometry({
                        **geometry, "name": geometry_id, "entityType": "panel" if geometry_id == "base" else "die",
                        "category": "carrier" if geometry_id == "base" else "lsi", "dim": "", "structureFormat": "standard",
                    })
                documents = []
                with TestClient(app) as client:
                    for step in ("tiv", "first", "joint"):
                        app.state.preview_sessions._layout_plans.clear()
                        response = client.post("/api/preview-sessions", json={
                            "flow": {"definition": ctx.definition, "configuration": ctx.configuration},
                            "target": {"type": "stepOutput", "stepRefId": step},
                        })
                        self.assertEqual(response.status_code, 200, response.text)
                        session = response.json()
                        snapshot = next(item for item in session["snapshots"]
                                        if item["snapshotId"] == session["initialSnapshotId"])
                        self.assertIsNotNone(snapshot["schematic"], snapshot["schematicWarnings"])
                        self.assertEqual(snapshot["schematicWarnings"], [])
                        self.assertEqual(snapshot["schematic"]["warnings"], [])
                        documents.append(snapshot["schematic"])
                        self.assertEqual(session["snapshots"][-1]["stepRefId"], step)
                self.assertEqual(len(_tiv_rectangles(documents[0])), 9)
                self.assertEqual(_tiv_rectangles(documents[0]), _tiv_rectangles(documents[1]))
                self.assertEqual(_tiv_rectangles(documents[1]), _tiv_rectangles(documents[2]))
                self.assertEqual(len({item["viewBox"][2] for item in documents}), 1)
            finally:
                app.state.store.close()

    def test_tiv_then_lsi_and_actual_joint_reuse_clear_pillar_positions(self):
        ctx = _tiv_lsi_flow()
        documents, geometry, physical_samples = {}, {}, {}
        for step in ("tiv", "first", "joint"):
            planning, document, snapshots, bindings = execute_document(_target(ctx, step))
            self.assertEqual(document["warnings"], [])
            self.assertFalse(any("stopped" in note for note in document["notes"]))
            self.assertEqual(len(_tiv_rectangles(document)), 9)
            documents[step] = document
            geometry[step] = snapshots[-1].geometry_structure
            self.assertEqual(len(planning.layout_for(ctx.target).slots), 1)
            actual = _physical_nodes(geometry[step]["root"])
            physical_samples[step] = {}
            for data in bindings[step].physical_data:
                self.assertEqual(data.snapshot_id, step)
                self.assertEqual(data.unit, geometry[step]["unitSystem"])
                self.assertIn(data.object_id, bindings[step].scene.object_map)
                for sample in data.samples:
                    self.assertIn(sample.source_id, actual)
                    node = actual[sample.source_id]
                    bounds = geometry_bounds(node["geometry"])
                    self.assertEqual(sample.material, node["material"])
                    self.assertEqual((sample.z_min, sample.z_max, sample.thickness),
                                     (bounds.z_min, bounds.z_max, bounds.thickness))
                    self.assertEqual(sample.density, node.get("density"))
                    physical_samples[step][sample.source_id] = sample
            self.assertEqual(set(physical_samples[step]), set(actual))
        self.assertEqual(documents["tiv"]["components"], [])
        self.assertEqual([item["label"] for item in documents["first"]["components"]], ["LSI"])
        self.assertEqual([item["label"] for item in documents["joint"]["components"]], ["LSI"])
        self.assertEqual(_tiv_rectangles(documents["tiv"]), _tiv_rectangles(documents["first"]))
        self.assertEqual(_tiv_rectangles(documents["first"]), _tiv_rectangles(documents["joint"]))
        self.assertEqual(len({doc["viewBox"][2] for doc in documents.values()}), 1)
        before, after = documents["first"]["components"][0], documents["joint"]["components"][0]
        self.assertEqual((before["id"], before["x"], before["width"]),
                         (after["id"], after["x"], after["width"]))
        for x, width in _tiv_rectangles(documents["joint"]):
            self.assertTrue(x + width <= after["x"] or x >= after["x"] + after["width"])
        placed_bump = geometry["first"]["root"]["children"][0]["bumps"][0]
        joined_bump = geometry["joint"]["root"]["children"][0]["bumps"][0]
        self.assertEqual(placed_bump["stage"], "reflowed")
        self.assertEqual(joined_bump["stage"], "joined")
        self.assertEqual(joined_bump["geometry"]["thk"], 3)
        self.assertEqual(physical_samples["first"][placed_bump["id"]].thickness, 2)
        self.assertEqual(physical_samples["joint"][joined_bump["id"]].thickness, 3)
        via_id = geometry["tiv"]["root"]["vias"][0]["id"]
        self.assertTrue(all(samples[via_id].thickness == 14 for samples in physical_samples.values()))
        self.assertNotIn(placed_bump["id"], physical_samples["tiv"])
        self.assertEqual(geometry["tiv"]["root"]["children"], [])

    def test_zero_density_tiv_keeps_physical_feature_without_symbols(self):
        ctx = _tiv_lsi_flow(density=0)
        for step in ("tiv", "joint"):
            with self.subTest(step=step):
                _, document, snapshots, _ = execute_document(_target(ctx, step))
                self.assertEqual(document["warnings"], [])
                self.assertEqual(_tiv_rectangles(document), [])
                self.assertEqual(snapshots[-1].geometry_structure["root"]["vias"][0]["density"], 0)

    def test_shuffled_definitions_titles_and_target_share_fingerprint_and_slots(self):
        original = _tiv_lsi_flow()
        shuffled = copy.deepcopy(original)
        for collection in ("flowInputs", "flowEdges", "stepRefs"):
            shuffled.definition[collection].reverse()
        for reference in shuffled.definition["stepRefs"]:
            reference["stepLabel"] = "Renamed " + reference["stepRefId"]
        for flow_input in shuffled.definition["flowInputs"]:
            flow_input["name"] = "Renamed input " + flow_input["flowInputId"]
        shuffled = replace(shuffled, source_label="A different preview title",
                           step_templates=tuple(reversed(shuffled.step_templates)))
        self.assertEqual(schematic_layout_fingerprint(original), schematic_layout_fingerprint(shuffled))
        self.assertEqual(schematic_layout_fingerprint(original), schematic_layout_fingerprint(_target(shuffled, "tiv")))
        first_plan, first, _, _ = execute_document(original)
        other_plan, other, _, _ = execute_document(shuffled)
        self.assertEqual(first_plan.layout_for(original.target), other_plan.layout_for(shuffled.target))
        self.assertEqual(first["components"], other["components"])
        self.assertEqual(_tiv_rectangles(first), _tiv_rectangles(other))
        # Fresh planning is the uncached path and must reproduce the cache key.
        fresh = plan_flow_schematic(shuffled, None)
        self.assertEqual(fresh.fingerprint, first_plan.fingerprint)
        self.assertEqual(fresh.layout_for(shuffled.target), first_plan.layout_for(original.target))

    def test_empty_placement_does_not_resolve_unused_connected_die_resource(self):
        ctx = context(placements=[])
        ctx.configuration["inputBindings"].pop("die")
        ctx.referenced_catalog_geometries.pop("die")
        from process_flow_api import schematic_planning
        resolver = schematic_planning.resolve_preview_flow_input

        def guarded(context_, generators, input_id, **kwargs):
            self.assertNotEqual(input_id, "die", "An empty placement must not resolve its auxiliary source")
            return resolver(context_, generators, input_id, **kwargs)

        with patch.object(schematic_planning, "resolve_preview_flow_input", side_effect=guarded):
            planning, document, snapshots, _ = execute_document(ctx)
        self.assertEqual(document["warnings"], [])
        self.assertEqual(document["components"], [])
        self.assertEqual(planning.layout_for(ctx.target).slots, ())
        self.assertNotIn("die", planning.inputs)
        self.assertEqual(snapshots[-1].geometry_structure["root"]["children"], [])

    def test_distinct_inputs_with_equal_normalized_node_ids_keep_qualified_lineage(self):
        ctx = context()
        other = copy.deepcopy(ctx.referenced_catalog_geometries["die"])
        other["id"] = "other"
        # Deliberately identical physical IDs, role and shape across catalog inputs.
        self.assertEqual(other["structure"], ctx.referenced_catalog_geometries["die"]["structure"])
        ctx.referenced_catalog_geometries["other"] = other
        ctx.definition["flowInputs"].append({"flowInputId": "other", "name": "other", "dataType": "geometry", "required": True})
        ctx.configuration["inputBindings"]["other"] = {"kind": "catalog", "geometryId": "other"}
        add_step(ctx, "second", "pnp/pnp", out("first"), {"placements": [placement(30)]}, inp("other"))
        planning, first, _, _ = execute_document(ctx)
        later_plan, later, snapshots, bindings = execute_document(_target(ctx, "second"))
        self.assertEqual(first["warnings"], [])
        self.assertEqual(later["warnings"], [])
        self.assertEqual(len(later["components"]), 2)
        self.assertNotEqual(later["components"][0]["id"], later["components"][1]["id"])
        original_id = ctx.referenced_catalog_geometries["die"]["structure"]["root"]["id"]
        self.assertNotEqual(planning.input_bindings["die"][original_id], planning.input_bindings["other"][original_id])
        slot = next(item for item in later["components"] if item["id"] == first["components"][0]["id"])
        self.assertEqual((slot["x"], slot["width"]), (first["components"][0]["x"], first["components"][0]["width"]))
        child_ids = [child["id"] for child in snapshots[-1].geometry_structure["root"]["children"]]
        self.assertEqual(len({bindings["second"][child_id] for child_id in child_ids}), 2)
        self.assertEqual(len(later_plan.layout_for(_target(ctx, "second").target).slots), 2)


if __name__ == "__main__":
    unittest.main()
