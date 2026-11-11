from __future__ import annotations

import unittest
from unittest.mock import patch

from process_flow_geometry_generators.cow_die_layout import DIE_DATATYPES, place_cow_dies, preview_cow_dies
from process_flow_geometry_generators.wafer_arrangement import ArrangementError, DieSize, WaferArrangementParameters, arrange_wafer


def die(x0=100, y0=200, x1=300, y1=400):
    return dict(zip(("bottomLeftX", "bottomLeftY", "upperRightX", "upperRightY"), (x0, y0, x1, y1)))


def section(label="soc", die_id="SOC-1", rectangle=None):
    return {label: {f"{label}Count": 999, f"{label}Info": {die_id: rectangle or die()}}}


class CowDieLayoutTests(unittest.TestCase):
    def test_searches_nested_objects_and_arrays_for_all_types_and_ignores_count(self):
        source = {"unrelated": {"meta": True}, "package": [section(), {"more": [section("hbm", "HBM-1"),
                  section("lsi", "LSI-1"), section("soic", "SOIC-1"), section("dmy", "DMY-1")]}]}
        result = preview_cow_dies(source)
        self.assertEqual(result["totalDies"], 5)
        self.assertIsNone(result["cowRectangle"])
        self.assertEqual([(layer["type"], layer["layer"], layer["datatype"], layer["count"]) for layer in result["dieLayers"]],
                         [(label, 888, datatype, 1) for label, datatype in DIE_DATATYPES.items()])
        self.assertEqual(result["dieLayers"][0]["dies"][0]["rectangle"], [100, 200, 300, 400])

    def test_merges_same_type_and_accepts_type_name_as_die_id(self):
        result = preview_cow_dies([section(die_id="soc"), section(die_id="another"), section("hbm", "soc")])
        self.assertEqual(result["totalDies"], 3)
        self.assertEqual(result["dieLayers"][0]["count"], 2)
        with self.assertRaisesRegex(ArrangementError, "duplicate soc die-ID.*SOC-1.*first found"):
            preview_cow_dies([section(), {"nested": section()}])

    def test_deep_search_is_not_limited_by_python_recursion(self):
        source = section()
        for _ in range(1100):
            source = {"nested": source}
        self.assertEqual(preview_cow_dies(source)["totalDies"], 1)

    def test_invalid_structure_and_coordinates_identify_source(self):
        for source in (None, 1, "text", {}, [], {"soc": []}, {"soc": {"socInfo": []}}, {"soc": {"socInfo": {}}}):
            with self.subTest(source=source), self.assertRaisesRegex(ArrangementError, "dieJson"):
                preview_cow_dies(source)
        for rectangle in ({}, die(True), die("0"), die(float("nan")), die(float("inf")), die(1000),
                          die(0, 0, .0001, 1)):
            with self.subTest(rectangle=rectangle), self.assertRaisesRegex(ArrangementError, "SOC-1"):
                preview_cow_dies(section(rectangle=rectangle) if rectangle else {"soc": {"socInfo": {"SOC-1": rectangle}}})

    def test_rounding_and_boundary_checks_keep_outside_dies_available(self):
        size = DieSize(x=1000, y=600)
        edge = preview_cow_dies(section(rectangle=die(0, 0, 1000, 600)), size)
        self.assertEqual(edge["outOfBounds"], [])
        self.assertEqual(edge["cowRectangle"], [0, 0, 1000, 600])
        for rectangle in (die(-.001, 0, 1000, 600), die(0, -.001, 1000, 600),
                          die(0, 0, 1000.001, 600), die(0, 0, 1000, 600.001)):
            with self.subTest(rectangle=rectangle):
                outside = preview_cow_dies(section(rectangle=rectangle), size)
                self.assertEqual(outside["totalDies"], 1)
                self.assertEqual(outside["outOfBounds"][0]["id"], "SOC-1")
        rounded = preview_cow_dies(section(rectangle=die(-1.0005, -2.0004, 1.0005, 2.0004)))
        self.assertEqual(rounded["dieLayers"][0]["dies"][0]["rectangle"], [-1.001, -2, 1.001, 2])
        self.assertTrue(rounded["warnings"])

    def test_bottom_left_origin_preserves_full_odd_nm_cow_in_all_modes(self):
        local = [0, 0, .003, .005]
        source = section(rectangle=die(*local))
        layout = preview_cow_dies(source, DieSize(x=.003, y=.005))
        self.assertEqual(layout["cowRectangle"], local)
        self.assertEqual(layout["outOfBounds"], [])
        for mode in ("center", "corner", "x_half", "y_half"):
            with self.subTest(mode=mode):
                result = arrange_wafer(WaferArrangementParameters(allowableDiameter=.03, cowSize=DieSize(x=.003, y=.005),
                    cowSpacing={"x": .002, "y": .002}, arrangeType=mode))
                placed = place_cow_dies(result, source)
                self.assertTrue(result["cowCount"])
                self.assertEqual(placed["dieLayers"][0]["rectangles"], result["cowRectangles"])
                self.assertEqual(placed["dieCounts"]["soc"], result["cowCount"])

    def test_combined_budget_and_invalid_layout_fail_without_partial_output(self):
        result = {"normalizedParameters": {"cowSize": {"x": 1000, "y": 1000}}, "cowCount": 2,
                  "cowRectangles": [[-500, -500, 500, 500], [500, -500, 1500, 500]],
                  "totalRectangles": 2, "warnings": []}
        with patch("process_flow_geometry_generators.wafer_arrangement.MAX_RECTANGLES", 3):
            with self.assertRaisesRegex(ArrangementError, "including COW dies exceeds"):
                place_cow_dies(result, section())
        with self.assertRaisesRegex(ArrangementError, "SOC-1.*outside"):
            place_cow_dies(result, section(rectangle=die(x1=1000.001)))
        self.assertEqual(result["totalRectangles"], 2)
        self.assertNotIn("dieLayers", result)


if __name__ == "__main__":
    unittest.main()
