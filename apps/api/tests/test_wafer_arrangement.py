from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import gdstk
from fastapi.testclient import TestClient
from process_flow_api.main import create_app


PARAMETERS = {
    "allowableDiameter": 290000, "cowSize": {"x": 40000, "y": 50000},
    "cowSpacing": {"x": 1000, "y": 1000}, "arrangeType": "center",
    "dummyLayers": [
        {"size": {"x": 8000, "y": 10000}, "minSpacing": {"x": 100, "y": 100}},
        {"size": {"x": 5000, "y": 6000}, "minSpacing": {"x": 100, "y": 100}},
    ],
}


class WaferArrangementApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(db_path=":memory:")
        self.client = TestClient(self.app)
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "wafer.gds"

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()
        self.app.state.analytics.close()
        self.directory.cleanup()

    def export(self, **changes):
        return self.client.post("/api/wafer-arrangement/export-gds", json={**PARAMETERS, "outputPath": str(self.path), **changes})

    def test_preview_and_gds_round_trip_match_all_rectangles_and_units(self):
        before = self.client.get("/api/bootstrap").json()
        response = self.client.post("/api/wafer-arrangement/preview", json=PARAMETERS)
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        response = self.export()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["cowCount"], preview["cowCount"])
        self.assertEqual(response.json()["dummyCounts"], [layer["count"] for layer in preview["dummyLayers"]])
        library = gdstk.read_gds(self.path)
        self.assertAlmostEqual(library.unit, 1e-6)
        self.assertAlmostEqual(library.precision, 1e-9)
        self.assertEqual([cell.name for cell in library.cells], ["WAFER_ARRANGEMENT"])
        self.assertEqual(library.layers_and_datatypes(), {(100, 100), (413, 10), (413, 11)})
        polygons = library.cells[0].polygons
        expected = {(100, 100): preview["cowRectangles"], **{(413, layer["datatype"]): layer["rectangles"] for layer in preview["dummyLayers"]}}
        for pair, rectangles in expected.items():
            actual = [polygon for polygon in polygons if (polygon.layer, polygon.datatype) == pair]
            self.assertEqual(len(actual), len(rectangles))
            for polygon, rect in zip(actual, rectangles):
                self.assertEqual(len(polygon.points), 4)
                flat = [v for point in polygon.bounding_box() for v in point]
                for a, b in zip(flat, rect):
                    self.assertAlmostEqual(a, b, places=6)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o777)
        self.assertEqual(before, self.client.get("/api/bootstrap").json())

    def test_invalid_paths_and_zero_cow(self):
        for path in ("relative.gds", str(self.path.with_suffix(".json")), str(self.path.parent / "missing" / "wafer.gds")):
            with self.subTest(path=path):
                response = self.export(outputPath=path)
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.export(allowableDiameter=10000).status_code, 422)
        self.assertFalse(self.path.exists())

    def test_tight_dummy_pattern_keeps_a_in_exported_gds(self):
        changes = {"allowableDiameter": 50000, "cowSize": {"x": 10000, "y": 10000},
                   "dummyLayers": [{"size": {"x": 3000, "y": 3000}, "minSpacing": {"x": 500, "y": 500}}]}
        preview = self.client.post("/api/wafer-arrangement/preview", json={**PARAMETERS, **changes}).json()
        self.assertEqual(preview["dummyLayers"][0]["x"]["a"], 800)
        self.assertEqual(preview["dummyLayers"][0]["y"]["a"], 800)
        response = self.export(**changes)
        self.assertEqual(response.status_code, 200, response.text)
        polygons = [polygon for polygon in gdstk.read_gds(self.path).cells[0].polygons if polygon.layer == 413]
        self.assertTrue(polygons)
        for polygon in polygons:
            ((x0, y0), (x1, y1)) = polygon.bounding_box()
            self.assertTrue(any(cell[0] + 800 <= x0 and cell[1] + 800 <= y0
                                and x1 <= cell[2] - 800 and y1 <= cell[3] - 800
                                for cell in preview["boundaryCells"]))

    def test_success_replaces_old_file_and_failures_preserve_it(self):
        self.path.write_bytes(b"previous file")
        for target in ("process_flow_api.wafer_arrangement.set_export_file_permissions", "pathlib.Path.replace"):
            with self.subTest(target=target), patch(target, side_effect=OSError("simulated write failure")):
                response = self.export()
                self.assertEqual(response.status_code, 500, response.text)
                self.assertEqual(self.path.read_bytes(), b"previous file")
                self.assertEqual(list(self.path.parent.iterdir()), [self.path])
        self.assertEqual(self.export().status_code, 200)
        self.assertNotEqual(self.path.read_bytes(), b"previous file")

    def test_partial_writer_failure_cleans_temp_and_preserves_existing_file(self):
        self.path.write_bytes(b"previous file")
        writer = Mock(wraps=gdstk.Library(unit=1e-6, precision=1e-9))

        def fail(path):
            Path(path).write_bytes(b"partial GDS")
            raise OSError("simulated partial write")

        writer.write_gds.side_effect = fail
        with patch("gdstk.Library", return_value=writer):
            response = self.export()
        self.assertEqual(response.status_code, 500, response.text)
        self.assertEqual(self.path.read_bytes(), b"previous file")
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_validation_rejects_invalid_values_and_budget(self):
        for changes in ({"allowableDiameter": 300000}, {"allowableDiameter": True},
                        {"cowSize": {"x": 0, "y": 1}}, {"arrangeType": "rotate"}, {"extra": 1},
                        {"cowSize": {"x": .001, "y": .001}, "cowSpacing": {"x": 0, "y": 0}}):
            with self.subTest(changes=changes):
                response = self.client.post("/api/wafer-arrangement/preview", json={**PARAMETERS, **changes})
                self.assertEqual(response.status_code, 422, response.text)

    def test_die_preview_without_wafer_parameters_and_outside_geometry(self):
        source = {"nested": [{"soc": {"socCount": 10, "socInfo": {"SOC-1": {
            "bottomLeftX": -10, "bottomLeftY": -20, "upperRightX": 30, "upperRightY": 40}}}}]}
        response = self.client.post("/api/wafer-arrangement/preview-dies", json={"dieJson": source})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["totalDies"], 1)
        self.assertIsNone(response.json()["cowRectangle"])
        response = self.client.post("/api/wafer-arrangement/preview-dies", json={"dieJson": source, "cowSize": {"x": 20, "y": 20}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["outOfBounds"][0]["id"], "SOC-1")
        self.assertEqual(response.json()["dieLayers"][0]["dies"][0]["rectangle"], [-10, -20, 30, 40])
        for body in ({}, {"dieJson": None}, {"dieJson": {}}, {"dieJson": source, "cowSize": {"x": 0, "y": 1}}):
            self.assertEqual(self.client.post("/api/wafer-arrangement/preview-dies", json=body).status_code, 422)

    def test_die_gds_round_trip_all_types_and_arrangement_modes(self):
        source = {"package": [{label: {f"{label}Count": 999, f"{label}Info": {f"{label}-1": {
            "bottomLeftX": -100.001, "bottomLeftY": -200.002, "upperRightX": 300.003, "upperRightY": 400.004}}}}
            for label in ("soc", "hbm", "lsi", "soic", "dmy")]}
        for mode in ("center", "corner", "x_half", "y_half"):
            with self.subTest(mode=mode):
                changes = {"arrangeType": mode, "cowSize": {"x": 40000.001, "y": 50000.003}}
                preview = self.client.post("/api/wafer-arrangement/preview", json={**PARAMETERS, **changes}).json()
                response = self.export(**changes, dieJson=source)
                self.assertEqual(response.status_code, 200, response.text)
                data = response.json()
                self.assertEqual(data["dieCounts"], dict.fromkeys(("soc", "hbm", "lsi", "soic", "dmy"), preview["cowCount"]))
                self.assertEqual(data["totalRectangles"], preview["totalRectangles"] + 5 * preview["cowCount"])
                library = gdstk.read_gds(self.path)
                self.assertEqual(len(library.cells), 1)
                self.assertEqual(library.cells[0].references, [])
                self.assertEqual(len(library.cells[0].polygons), data["totalRectangles"])
                self.assertEqual(library.layers_and_datatypes(), {(100, 100), (413, 10), (413, 11), *((888, i) for i in range(1, 6))})
                for datatype in range(1, 6):
                    actual = [p for p in library.cells[0].polygons if (p.layer, p.datatype) == (888, datatype)]
                    for polygon, cow in zip(actual, preview["cowRectangles"]):
                        cx = (round(cow[0] * 1000) + round(cow[2] * 1000) + 1) // 2
                        cy = (round(cow[1] * 1000) + round(cow[3] * 1000) + 1) // 2
                        expected = [(cx - 100001) / 1000, (cy - 200002) / 1000, (cx + 300003) / 1000, (cy + 400004) / 1000]
                        for a, b in zip([v for point in polygon.bounding_box() for v in point], expected):
                            self.assertAlmostEqual(a, b, places=6)

    def test_invalid_dies_and_combined_budget_preserve_existing_gds(self):
        self.path.write_bytes(b"previous file")
        for source in ({}, {"soc": {"socInfo": {"outside": {"bottomLeftX": 0, "bottomLeftY": 0,
                         "upperRightX": 20001, "upperRightY": 1}}}}):
            response = self.export(dieJson=source)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(self.path.read_bytes(), b"previous file")
        source = {"soc": {"socInfo": {"SOC-1": {"bottomLeftX": 0, "bottomLeftY": 0, "upperRightX": 1, "upperRightY": 1}}}}
        with patch("process_flow_geometry_generators.wafer_arrangement.MAX_RECTANGLES", 30):
            response = self.export(dummyLayers=[], dieJson=source)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("including COW dies", response.json()["detail"])
        self.assertEqual(self.path.read_bytes(), b"previous file")
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])


if __name__ == "__main__":
    unittest.main()
