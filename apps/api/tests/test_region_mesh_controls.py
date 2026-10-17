from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from process_flow_api.main import create_app


def structure():
    return {"schemaVersion": "1.0.0", "unitSystem": "um", "root": {
        "id": "root", "bodies": [{"id": "silicon", "key": "soc.si", "material": "Si", "geometry": {
            "type": "BoxGeometry", "bottom_left": [10, 20, 30], "top_right": [110, 220, 30], "thk": 50}}],
        "vias": [], "circuits": [], "bumps": [], "children": []}}


def configuration():
    return {"schemaVersion": "1.0.0", "unitSystem": "um", "mesher": "process_flow_2_5d",
            "globalElementSize": 500, "symmetry": "full", "controls": [{
                "method": "3D_REGION", "coordinateMode": "reference", "label": "Focus", "elementSize": 5, "reference": {"kind": "root"},
                "region": {"type": "box", **{bound: {
                    a: {"anchor": f"{a}_{bound}", "offset": 0} for a in "xyz"}
                    for bound in ("min", "max")}}}]}


class RegionApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(db_path=Path(self.tmp.name) / "api.sqlite3")
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.app.state.store.close()
        self.tmp.cleanup()

    def export(self, endpoint, mesh_control, suffix="test"):
        return self.client.post(endpoint, json={"clientId": "regions", "kind": "cdb", "geometryStructure": structure(),
                                "meshControl": mesh_control, "outputPath": str(Path(self.tmp.name) / f"{suffix}.cdb")})

    def test_test_set_lists_applies_and_returns_bounds(self):
        definitions = self.client.get("/api/mesh-control-sets").json()
        self.assertIn("meshControl3dTest", [d["id"] for d in definitions])
        response = self.client.post("/api/mesh-control-sets/meshControl3dTest/apply", json={"geometryStructure": structure()})
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["setVersion"], "1.0.0")
        self.assertEqual([c["region"]["type"] for c in payload["meshControl"]["controls"]], ["box", "polygon"])
        self.assertEqual(payload["details"][0]["resolvedRegions"][0]["bounds"]["zMax"], 80)
        self.assertEqual(payload["details"][0]["resolvedRegions"][0]["sourceId"], "root")
        self.assertEqual(payload["meshControl"]["controls"][0]["region"]["min"]["x"], {"anchor": "x_min", "offset": 0})
        empty = self.client.post("/api/mesh-control-sets/meshControl3dTest/apply", json={"geometryStructure": {}})
        self.assertEqual(empty.status_code, 422)
        self.assertIn("valid volume", empty.json()["detail"])

    def test_both_export_endpoints_accept_z_and_region_controls(self):
        self.app.state.file_export_jobs.max_concurrent_jobs = 0
        config = configuration()
        config["controls"].append({"method": "Z_POINT", "coordinateMode": "reference", "label": "Surface", "reference": {"kind": "root"},
                                   "z": {"anchor": "z_max", "offset": 0}})
        for i, endpoint in enumerate(("/api/geometry-preview/cdb-jobs", "/api/geometry-preview/export-jobs")):
            response = self.export(endpoint, config, str(i))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["job"]["meshControl"], config)

    def test_both_export_endpoints_reject_invalid_regions_and_unknown_methods(self):
        self.app.state.file_export_jobs.max_concurrent_jobs = 0
        for endpoint in ("/api/geometry-preview/cdb-jobs", "/api/geometry-preview/export-jobs"):
            for mutate, message in (
                (lambda c: c["region"]["max"]["z"].update(offset=-100), "Control 1.region"),
                (lambda c: c.update(reference={"kind": "body", "id": "missing"}), "no matching geometry"),
                (lambda c: c["region"]["min"]["x"].update(anchor="z_min"), "min.x.anchor"),
                (lambda c: c.update(method="UNSUPPORTED"), "method"),
                (lambda c: c.update(elementSize=-1), "elementSize"),
            ):
                config = configuration()
                mutate(config["controls"][0])
                with self.subTest(endpoint=endpoint, message=message):
                    response = self.export(endpoint, config)
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertIn(message, response.json()["detail"])

    def test_absolute_region_can_omit_reference(self):
        self.app.state.file_export_jobs.max_concurrent_jobs = 0
        config = configuration()
        control = config["controls"][0]
        control.pop("reference")
        control["coordinateMode"] = "absolute"
        for bound, number in (("min", -50), ("max", 500)):
            control["region"][bound] = {a: number for a in "xyz"}
        response = self.export("/api/geometry-preview/export-jobs", config)
        self.assertEqual(response.status_code, 200, response.text)

    def test_full_json_written_before_worker_and_retained_after_failure(self):
        config = configuration()
        output = Path(self.tmp.name) / "failed.cdb"
        observed = []

        async def failing_worker(*, geometry_input_path, mesh_control_input_path, **_):
            observed.append(json.loads(mesh_control_input_path.read_text()))
            self.assertEqual(json.loads(output.with_suffix(".mesh-control.json").read_text()), config)
            self.assertEqual(json.loads(output.with_suffix(".geometry.json").read_text()), structure())
            self.assertEqual(json.loads(geometry_input_path.read_text()), structure())
            return await asyncio.create_subprocess_exec(sys.executable, "-c",
                "import sys; print('3D_REGION is unsupported', file=sys.stderr); sys.exit(2)",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)

        with patch("process_flow_api.file_export_jobs.start_cdb_worker", new=failing_worker):
            response = self.export("/api/geometry-preview/export-jobs", config, "failed")
            self.assertEqual(response.status_code, 200, response.text)
            job = response.json()["job"]
            deadline = time.monotonic() + 10
            while job["status"] not in {"success", "failed", "canceled"} and time.monotonic() < deadline:
                time.sleep(0.01)
                job = self.client.get(f"/api/export-jobs/{job['jobId']}", params={"clientId": "regions"}).json()["job"]
        self.assertEqual(observed, [config])
        self.assertEqual(job["status"], "failed", job)
        self.assertIn("3D_REGION is unsupported", job["message"])
        self.assertEqual(json.loads(Path(job["meshControlOutputPath"]).read_text()), config)
        self.assertTrue(Path(job["geometryOutputPath"]).exists())
        self.assertFalse(output.exists())
