from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import klayout.db as kdb
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


def gds_units(path: Path) -> tuple[float, float]:
    """Read GDS UNITS independently: DB units per user unit, then meters per DB unit."""
    with path.open("rb") as stream:
        while header := stream.read(4):
            payload = stream.read(int.from_bytes(header[:2], "big") - 4)
            if header[2:] == b"\x03\x05":
                def real8(value: bytes) -> float:
                    sign = -1 if value[0] & 0x80 else 1
                    return sign * int.from_bytes(value[1:], "big") / 2**56 * 16.0**((value[0] & 0x7f) - 64)
                return real8(payload[:8]), real8(payload[8:])
    raise AssertionError("GDS UNITS record is missing")


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

    def read_layout(self):
        layout = kdb.Layout()
        layout.read(str(self.path))
        return layout

    def assert_rectangles(self, layout, pair, rectangles):
        shapes = list(layout.top_cell().shapes(layout.find_layer(*pair)).each())
        self.assertTrue(all(shape.is_box() for shape in shapes))
        actual = sorted((shape.box.left, shape.box.bottom, shape.box.right, shape.box.top) for shape in shapes)
        expected = sorted(tuple(round(value * 1000) for value in rectangle) for rectangle in rectangles)
        self.assertEqual(actual, expected)

    def test_preview_and_gds_round_trip_match_all_rectangles_and_units(self):
        before = self.client.get("/api/bootstrap").json()
        response = self.client.post("/api/wafer-arrangement/preview", json=PARAMETERS)
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        response = self.export()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["cowCount"], preview["cowCount"])
        self.assertEqual(response.json()["dummyCounts"], [layer["count"] for layer in preview["dummyLayers"]])
        layout = self.read_layout()
        self.assertEqual(layout.dbu, .001)
        db_per_user, meters_per_db = gds_units(self.path)
        self.assertAlmostEqual(db_per_user, .001, delta=1e-15)
        self.assertAlmostEqual(meters_per_db, 1e-9, delta=1e-21)
        self.assertEqual([cell.name for cell in layout.each_cell()], ["WAFER_ARRANGEMENT"])
        self.assertEqual({(info.layer, info.datatype) for info in layout.layer_infos()}, {(100, 100), (413, 10), (413, 11)})
        expected = {(100, 100): preview["cowRectangles"], **{(413, layer["datatype"]): layer["rectangles"] for layer in preview["dummyLayers"]}}
        for pair, rectangles in expected.items():
            self.assert_rectangles(layout, pair, rectangles)
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
        layout = self.read_layout()
        shapes = list(layout.top_cell().shapes(layout.find_layer(413, 10)).each())
        self.assertTrue(shapes)
        for shape in shapes:
            box = shape.bbox().to_dtype(layout.dbu)
            x0, y0, x1, y1 = box.left, box.bottom, box.right, box.top
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
        for error_type in (OSError, RuntimeError):
            with self.subTest(error_type=error_type):
                writer = Mock(wraps=kdb.Layout())

                def fail(path, options):
                    Path(path).write_bytes(b"partial GDS")
                    raise error_type("simulated partial write")

                writer.write.side_effect = fail
                with patch("klayout.db.Layout", return_value=writer):
                    response = self.export()
                self.assertEqual(response.status_code, 500, response.text)
                self.assertIn("Unable to write GDS", response.json()["detail"])
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

    def test_die_preview_accepts_die_spanning_cow_from_bottom_left(self):
        source = {"soc": {"socInfo": {"SOC-1": {
            "bottomLeftX": 0, "bottomLeftY": 0, "upperRightX": 1000.001, "upperRightY": 600.003}}}}
        response = self.client.post("/api/wafer-arrangement/preview-dies", json={
            "dieJson": source, "cowSize": {"x": 1000.001, "y": 600.003}})
        self.assertEqual(response.status_code, 200, response.text)
        layout = response.json()
        self.assertEqual(layout["cowRectangle"], [0, 0, 1000.001, 600.003])
        self.assertEqual(layout["dieLayers"][0]["dies"][0]["rectangle"], layout["cowRectangle"])
        self.assertEqual(layout["outOfBounds"], [])

    def test_die_gds_round_trip_all_types_and_arrangement_modes(self):
        source = {"package": [{label: {f"{label}Count": 999, f"{label}Info": {f"{label}-1": {
            "bottomLeftX": 100.001, "bottomLeftY": 200.002, "upperRightX": 300.003, "upperRightY": 400.004}}}}
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
                layout = self.read_layout()
                self.assertEqual(layout.cells(), 1)
                self.assertEqual(list(layout.top_cell().each_inst()), [])
                self.assertEqual(sum(layout.top_cell().shapes(i).size() for i in layout.layer_indexes()), data["totalRectangles"])
                self.assertEqual({(info.layer, info.datatype) for info in layout.layer_infos()}, {(100, 100), (413, 10), (413, 11), *((888, i) for i in range(1, 6))})
                for datatype in range(1, 6):
                    rectangles = []
                    for cow in preview["cowRectangles"]:
                        x0, y0 = round(cow[0] * 1000), round(cow[1] * 1000)
                        rectangles.append([(x0 + 100001) / 1000, (y0 + 200002) / 1000, (x0 + 300003) / 1000, (y0 + 400004) / 1000])
                    self.assert_rectangles(layout, (888, datatype), rectangles)

    def test_invalid_dies_and_combined_budget_preserve_existing_gds(self):
        self.path.write_bytes(b"previous file")
        for source in ({}, {"soc": {"socInfo": {"outside": {"bottomLeftX": 0, "bottomLeftY": 0,
                         "upperRightX": 40000.001, "upperRightY": 1}}}}):
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
