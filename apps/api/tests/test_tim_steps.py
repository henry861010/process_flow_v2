"""TIM acceptance through real compilation, execution and semantic previews."""
from __future__ import annotations

import copy
import json
import unittest
from dataclasses import replace

from fastapi.testclient import TestClient

from process_flow_api.main import create_app
from process_flow_api.seed import load_seed_fixtures
from process_flow_kernel import ProcessGeometryState, normalize_geometry_structure
from test_schematic_planning import TEMPLATES, add_step, context, entity, execute_document, inp, out, placement


def target(ctx, step):
    return replace(ctx, target={"type": "stepOutput", "stepRefId": step, "outputPortId": "result_geometry"})


def add_input(ctx, geometry):
    identifier = geometry["id"]
    ctx.referenced_catalog_geometries[identifier] = geometry
    ctx.definition["flowInputs"].append({"flowInputId": identifier, "name": identifier,
                                         "dataType": "geometry", "required": True})
    ctx.configuration["inputBindings"][identifier] = {"kind": "catalog", "geometryId": identifier}


class TimStepAcceptanceTests(unittest.TestCase):
    def test_new_templates_have_only_required_material_and_positive_thickness(self):
        for program in ("layer/tim1", "layer/tim2"):
            template = next(item for item in TEMPLATES if item["program"] == program)
            self.assertEqual(template["category"], "layer")
            self.assertEqual(template["status"], "enabled")
            self.assertEqual([port["portId"] for port in template["inputPorts"]], ["main_geometry"])
            self.assertEqual([port["portId"] for port in template["outputPorts"]], ["result_geometry"])
            material, thickness = template["parameterDefinitions"]
            self.assertEqual((material["id"], material["valueType"]), ("material", "materialRef"))
            self.assertEqual((thickness["id"], thickness["unit"]), ("thickness", "um"))
            self.assertEqual(thickness["validation"], {"min": 0, "exclusiveMin": True})
            self.assertFalse(any("defaultValue" in parameter for parameter in (material, thickness)))

    def test_multi_target_tim_binds_to_parent_cohorts_and_never_spans_substrate(self):
        for program, role in (("layer/tim1", "cow"), ("layer/tim2", "lid")):
            with self.subTest(program=program):
                ctx = context(source=entity("die", role), placements=[placement(0), placement(20)])
                add_step(ctx, "second", "pnp/pnp", out("first"), {"placements": [placement(40)]}, inp("die"))
                add_step(ctx, "coat", program, out("second"), {"material": "TIM-A", "thickness": 3})
                original = copy.deepcopy(ctx)
                planning, document, snapshots, bindings = execute_document(target(ctx, "coat"))
                self.assertEqual(ctx, original)
                self.assertEqual(document["warnings"], [])
                self.assertFalse(planning.layout_failures)
                self.assertFalse(any("stopped" in note for note in document["notes"]))
                children = snapshots[-1].geometry_structure["root"]["children"]
                self.assertEqual(len(children), 3)
                mapping = bindings["coat"].logical
                scene = planning.outputs["coat"]
                layout = planning.scene_layouts[scene.phase_id]
                tim_ids = set()
                logical_coatings = set()
                for child in children:
                    coating = child["bodies"][-1]
                    self.assertEqual(coating["key"], "tim")
                    tim_ids.add(coating["id"])
                    tim_object = scene.object_map[mapping[coating["id"]]]
                    logical_coatings.add(tim_object.id)
                    self.assertEqual(tim_object.parent_id, mapping[child["id"]])
                    self.assertEqual(tim_object.role, program.split("/")[1])
                    item = next(item for item in document["items"] if coating["id"] in item["sourceIds"])
                    self.assertEqual((item["zMin"], item["zMax"], item["thickness"]), (20, 23, 3))
                    shapes = [shape for shape in document["shapes"] if shape["itemId"] == item["id"]]
                    slot = next(slot for slot in layout.slots if mapping[child["id"]] in slot.object_ids)
                    self.assertEqual([(shape["x"], shape["width"]) for shape in shapes], [(slot.x, slot.width)])
                self.assertEqual(len(logical_coatings), 2)
                tim_items = [item for item in document["items"] if set(item["sourceIds"]) & tim_ids]
                self.assertEqual(sorted(len(item["sourceIds"]) for item in tim_items), [1, 2])
                self.assertEqual({id_ for item in tim_items for id_ in item["sourceIds"]}, tim_ids)

    def test_saw_tim1_and_cow_placement_keep_internal_semantics_and_lineage(self):
        ctx = context()
        add_step(ctx, "cut", "saw/saw", out("first"),
                 {"bottomLeftX": 0, "bottomLeftY": 0, "topRightX": 30, "topRightY": 30})
        add_step(ctx, "coat-root", "layer/tim1", out("cut"), {"material": "TIM-A", "thickness": 2})
        planning, document, snapshots, _ = execute_document(target(ctx, "coat-root"))
        self.assertEqual(document["warnings"], [])
        root = snapshots[-1].geometry_structure["root"]
        self.assertEqual(root["key"], "cow")
        self.assertEqual(root["bodies"][-1]["geometry"]["bottom_left"], [0, 0, 20])
        self.assertEqual(root["bodies"][-1]["geometry"]["top_right"], [30, 30, 20])
        self.assertTrue(any(obj.role == "soc" and obj.layout == "member" for obj in planning.outputs["cut"].objects))
        add_input(ctx, entity("substrate", "carrier"))
        placed = placement(0)
        placed["targetRegion"].update(topRightX=30, topRightY=30)
        add_step(ctx, "place-cow", "pnp/pnp", inp("substrate"), {"placements": [placed]}, out("cut"))
        add_step(ctx, "coat-placed", "layer/tim1", out("place-cow"), {"material": "TIM-B", "thickness": 4})
        planning, document, snapshots, bindings = execute_document(target(ctx, "coat-placed"))
        self.assertEqual(document["warnings"], [])
        self.assertFalse(planning.layout_failures)
        child = snapshots[-1].geometry_structure["root"]["children"][0]
        self.assertEqual(child["key"], "cow")
        self.assertEqual(child["bodies"][-1]["geometry"]["bottom_left"][2], 30)
        logical = bindings["coat-placed"].logical
        scene = planning.outputs["coat-placed"]
        self.assertEqual(scene.object_map[logical[child["bodies"][-1]["id"]]].parent_id, logical[child["id"]])

    def test_imported_cow_preserves_local_soc_and_hbm_arrangement(self):
        source = entity("die", "cow", children=[entity("soc", "soc")["structure"]["root"],
                                                   entity("hbm", "hbm")["structure"]["root"]])
        # The imported package has its own local arrangement after placement.
        source["structure"] = normalize_geometry_structure(source["structure"])
        ctx = context(source=source)
        add_step(ctx, "coat", "layer/tim1", out("first"), {"material": "TIM-A", "thickness": 3})
        planning, document, _, _ = execute_document(target(ctx, "coat"))
        self.assertEqual(document["warnings"], [])
        self.assertFalse(planning.layout_failures)
        scene = planning.outputs["coat"]
        roles = {obj.role: obj for obj in scene.objects if obj.kind == "component"}
        self.assertEqual(roles["cow"].nesting, "arranged")
        self.assertIsNone(roles["cow"].diagram_label)
        self.assertEqual(roles["soc"].layout, "member")
        self.assertEqual(roles["hbm"].layout, "member")
        layout = planning.scene_layouts[scene.phase_id]
        local = [slot for slot in layout.slots if slot.object_id in (roles["soc"].id, roles["hbm"].id)]
        self.assertEqual(len(local), 2)
        self.assertLessEqual(local[0].x + local[0].width, local[1].x)


def test_existing_database_merges_tim_templates_without_reseeding(tmp_path):
    fixtures = load_seed_fixtures()
    legacy = copy.deepcopy(fixtures)
    legacy["processStepTemplates"] = [step for step in legacy["processStepTemplates"]
                                      if step["id"] not in ("step_tpl_tim1", "step_tpl_tim2")]
    next(step for step in legacy["processStepTemplates"] if step["id"] == "step_tpl_saw")["description"] = "Legacy saw"
    app = create_app(db_path=tmp_path / "legacy.sqlite3")
    app.state.store.seed(legacy)
    try:
        with TestClient(app) as client:
            before = client.get("/api/bootstrap").json()
            dataset = app.state.store.dataset_id
            payload = [step for step in fixtures["processStepTemplates"]
                       if step["id"] in ("step_tpl_saw", "step_tpl_tim1", "step_tpl_tim2")]
            imported = client.post("/api/process-step-templates/import", json=payload)
            assert imported.status_code == 200, imported.text
            assert imported.json()["createdCount"] == 2
            assert imported.json()["updatedCount"] == 1
            assert client.get("/api/process-step-templates/step_tpl_saw").json()["description"] != "Legacy saw"
            after = client.get("/api/bootstrap").json()
            assert {key: value for key, value in after.items() if key != "processStepTemplates"} == {
                key: value for key, value in before.items() if key != "processStepTemplates"}
            assert app.state.store.dataset_id == dataset
    finally:
        app.state.store.close()


def test_tim_bodies_export_as_cad_and_cdb_without_changing_source(tmp_path):
    from process_flow_cad import convert_cad_bodies, export_cad_bytes
    from test_api import wait_for_export_job

    state = ProcessGeometryState.create({"key": "cow"})
    state.initialize_box_layer(material="Si", bottom_left=[0, 0, 0], top_right=[10, 10, 0], thickness=10)
    state.coat_targets(target_key="cow", material="TIM-A", thickness=2, key="tim")
    lid = ProcessGeometryState.create({"key": "lid"})
    lid.initialize_box_layer(material="Cu", bottom_left=[0, 0, 0], top_right=[12, 12, 0], thickness=2)
    state.place_geometry_state(lid, x=0, y=0, bottom_z=12)
    state.coat_targets(target_key="lid", material="TIM-B", thickness=3, key="tim")
    structure = state.to_geometry_structure()
    before = copy.deepcopy(structure)
    bodies = convert_cad_bodies(structure)
    assert {body.material: round(body.shape.Volume(), 6) for body in bodies} == {
        "Si": 1000, "TIM-A": 200, "Cu": 288, "TIM-B": 432}
    assert export_cad_bytes(structure, format="glb")[:4] == b"glTF"
    assert structure == before

    app = create_app(db_path=tmp_path / "exports.sqlite3")
    try:
        with TestClient(app) as client:
            response = client.post("/api/geometry-preview/export-jobs", json={
                "clientId": "tim-test", "kind": "cdb", "geometryStructure": structure,
                "meshControl": {"schemaVersion": "1.0.0", "unitSystem": "um", "mesher": "process_flow_2_5d",
                                "globalElementSize": 5, "symmetry": "full", "controls": []},
                "outputPath": str(tmp_path / "tim.cdb"),
            })
            assert response.status_code == 200, response.text
            job = wait_for_export_job(client, response.json()["job"]["jobId"], "tim-test")
            assert job["status"] == "success", job
            cdb = (tmp_path / "tim.cdb").read_text()
            assert "*ELEMENTS" in cdb
            assert all(f'"{material}"' in cdb for material in ("Si", "TIM-A", "Cu", "TIM-B"))
            assert json.loads((tmp_path / "tim.geometry.json").read_text()) == before
            assert structure == before
    finally:
        app.state.store.close()
