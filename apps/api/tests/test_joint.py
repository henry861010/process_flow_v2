from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from mesher.process_flow.exporters import write_cdb_text
from mesher.process_flow.pipeline import build_mesh_from_structure
from process_flow_cad import convert_cad_bodies, export_cad_bytes
from process_flow_kernel import ProcessGeometryState

from process_flow_api.main import create_app


def joined_structure(height, density=100):
    main = ProcessGeometryState.create()
    main.initialize_box_layer(material="Si", bottom_left=[0,0,0], top_right=[20,20,0], thickness=100)
    main.add_bump_above_cursor(material="LowerSolder", density=100, thickness=20, stage="reflowed")
    die = ProcessGeometryState.create()
    die.initialize_box_layer(material="DieSi", bottom_left=[0,0,15], top_right=[10,10,15], thickness=50)
    die.add_bump(material="UpperSolder", density=density, direction="-z", stage="reflowed", geometry={"type":"box", "bottomLeft":[0,0,0], "topRight":[10,10,0], "thickness":15})
    main.place_geometry_state(die, x=0, y=0, bottom_z=120)
    main.join_bumps(joined_height=height)
    return main.to_geometry_structure()


class JointConsumerTests(unittest.TestCase):
    def test_step_ownership_preserves_lower_data_without_duplicate_solid_volume(self):
        for height in (5, 25, 60):
            with self.subTest(height=height):
                structure = joined_structure(height)
                before = copy.deepcopy(structure)
                bodies = convert_cad_bodies(structure, include_feature_bodies=True)
                lower = [body for body in bodies if body.feature_type == "bump" and "LowerSolder" in body.material]
                upper = [body for body in bodies if body.feature_type == "bump" and "UpperSolder" in body.material]
                self.assertAlmostEqual(sum(body.shape.Volume() for body in lower), 300 * 20)
                self.assertAlmostEqual(sum(body.shape.Volume() for body in upper), 100 * height)
                for index, left in enumerate(bodies):
                    for right in bodies[index+1:]:
                        self.assertLess(abs(left.shape.intersect(right.shape).Volume()), 1e-5)
                self.assertIn(b"ISO-10303-21", export_cad_bytes(structure, format="step"))
                self.assertEqual(structure, before)

    def test_cdb_child_density_owns_joint_columns_and_source_is_immutable(self):
        control = {"schemaVersion":"1.0.0", "unitSystem":"um", "mesher":"process_flow_2_5d", "globalElementSize":5, "symmetry":"full", "controls":[]}
        for height, density in ((5,100), (25,100), (25,80), (25,0)):
            with self.subTest(height=height, density=density):
                structure = joined_structure(height, density)
                before = copy.deepcopy(structure)
                mesh = build_mesh_from_structure(structure, control)
                centers = mesh.nodes[mesh.elements[:, :8]].mean(axis=1)
                inside = (centers[:,0] < 10) & (centers[:,1] < 10) & (centers[:,2] > 100) & (centers[:,2] < 100+height)
                if density:
                    self.assertGreater(np.count_nonzero(inside), 0)
                    self.assertTrue(np.all(mesh.element_comps[inside] == mesh.comps["UpperSolder"]))
                else:
                    self.assertEqual(np.count_nonzero(inside), 0)
                lower_elements = mesh.element_comps == mesh.comps["LowerSolder"]
                self.assertFalse(np.any(lower_elements & (centers[:,0] < 10) & (centers[:,1] < 10)))
                # No two solids occupy the same cell, even where root/child features overlap.
                self.assertEqual(len({tuple(sorted(row)) for row in mesh.elements.tolist()}), mesh.element_count)
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory)/"joint.cdb"
                    metadata = write_cdb_text(path, mesh=mesh)
                    self.assertEqual(metadata["elementCount"], mesh.element_count)
                    self.assertIn("*ELEMENTS", path.read_text())
                self.assertEqual(structure, before)

    def test_fresh_api_exposes_joint_template_and_executes_dual_branch_example(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(db_path=Path(directory)/"test.sqlite3")
            try:
                with TestClient(app) as client:
                    bootstrap = client.get("/api/bootstrap").json()
                    joints = client.get("/api/process-step-templates?category=joint").json()
                    self.assertEqual({step["id"] for step in joints}, {"step_tpl_mr_joint", "step_tpl_tcb_joint"})
                    self.assertEqual({step["name"] for step in joints}, {"MR joint", "TCB joint"})
                    for field in ("inputPorts", "outputPorts", "parameterDefinitions"):
                        self.assertEqual(joints[0][field], joints[1][field])
                    for joint in joints:
                        self.assertEqual(joint["category"], "joint")
                        self.assertEqual([parameter["id"] for parameter in joint["parameterDefinitions"]], ["bump_joined_height"])
                        self.assertNotIn("defaultValue", joint["parameterDefinitions"][0])
                    self.assertNotIn("step_tpl_bump_joint", {step["id"] for step in bootstrap["processStepTemplates"]})
                    bumps = client.get("/api/process-step-templates?category=bump").json()
                    self.assertTrue(bumps)
                    self.assertTrue(all("joint" not in step["program"] for step in bumps))
                    self.assertEqual(client.get("/api/process-step-templates/step_tpl_bump_joint").status_code, 404)
                    response = client.post("/api/process-flow-instances/flow_inst_dual_bump_demo/execute")
                    self.assertEqual(response.status_code, 200, response.text)
                    root = response.json()["geometryStructure"]["root"]
                    self.assertEqual(root["bumps"][0]["stage"], "reflowed")
                    self.assertEqual([child["bumps"][0]["stage"] for child in root["children"]], ["joined","joined"])
            finally:
                app.state.store.close()

    def test_existing_database_does_not_get_missing_seed_template(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"test.sqlite3"
            first = create_app(db_path=path)
            with TestClient(first):
                with first.state.store._connection:
                    first.state.store._connection.execute("DELETE FROM process_step_templates WHERE id=?", ("step_tpl_mr_joint",))
            first.state.store.close()
            second = create_app(db_path=path)
            try:
                with TestClient(second) as client:
                    ids = [step["id"] for step in client.get("/api/bootstrap").json()["processStepTemplates"]]
                    self.assertNotIn("step_tpl_mr_joint", ids)
            finally:
                second.state.store.close()


if __name__ == "__main__":
    unittest.main()
