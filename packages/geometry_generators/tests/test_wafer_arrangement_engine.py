from __future__ import annotations

import math
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from process_flow_geometry_generators.wafer_arrangement import (
    ArrangementError, WaferArrangementParameters, arrange_wafer, pack_axis,
)


def parameters(**changes):
    return WaferArrangementParameters.model_validate({
        "allowableDiameter": 290000, "cowSize": {"x": 40000, "y": 50000},
        "cowSpacing": {"x": 1000, "y": 1000}, "arrangeType": "center",
        "dummyLayers": [{"size": {"x": 8000, "y": 10000}, "minSpacing": {"x": 100, "y": 100}}],
        **changes,
    })


def inside(rect, radius):
    x0, y0, x1, y1 = rect
    return max(abs(x0), abs(x1)) ** 2 + max(abs(y0), abs(y1)) ** 2 <= radius ** 2 + 1e-5


def overlaps(a, b):
    return max(a[0], b[0]) < min(a[2], b[2]) and max(a[1], b[1]) < min(a[3], b[3])


class WaferArrangementTests(unittest.TestCase):
    def test_arrangement_phases_and_all_contained_grid_sites(self):
        for mode, phase, count in [("center", (0, 0), 21), ("corner", (.5, .5), 20),
                                   ("x_half", (.5, 0), 22), ("y_half", (0, .5), 20)]:
            with self.subTest(mode=mode):
                p = parameters(arrangeType=mode, dummyLayers=[])
                result = arrange_wafer(p)
                expected = []
                for j in range(-10, 11):
                    for i in range(-10, 11):
                        x, y = (i + phase[0]) * 41000, (j + phase[1]) * 51000
                        rect = [x - 20000, y - 25000, x + 20000, y + 25000]
                        if inside(rect, 145000):
                            expected.append(rect)
                self.assertEqual(result["cowRectangles"], expected)
                self.assertEqual(result["cowCount"], count)
                self.assertAlmostEqual(result["cowAreaUtilization"], count * 40000 * 50000 / (math.pi * 145000 ** 2))

    def test_tangent_cow_is_included_and_zero_cow_is_reported(self):
        tangent = arrange_wafer(parameters(allowableDiameter=10000, cowSize={"x": 6000, "y": 8000}, dummyLayers=[]))
        self.assertEqual(tangent["cowRectangles"], [[-3000, -4000, 3000, 4000]])
        empty = arrange_wafer(parameters(allowableDiameter=10000, dummyLayers=[]))
        self.assertEqual(empty["cowCount"], 0)
        self.assertTrue(empty["warnings"])

    def test_dummy_only_in_boundary_cells_whole_and_non_overlapping(self):
        result = arrange_wafer(parameters())
        self.assertTrue(result["dummyLayers"][0]["count"])
        for cell in result["boundaryCells"]:
            self.assertFalse(inside(cell, 145000))
        for rect in result["dummyLayers"][0]["rectangles"]:
            self.assertTrue(inside(rect, 145000))
            self.assertAlmostEqual(rect[2] - rect[0], 8000)
            self.assertAlmostEqual(rect[3] - rect[1], 10000)
            self.assertTrue(any(cell[0] <= rect[0] and cell[1] <= rect[1] and cell[2] >= rect[2] and cell[3] >= rect[3] for cell in result["boundaryCells"]))
            self.assertFalse(any(overlaps(rect, cow) for cow in result["cowRectangles"]))

    def test_axis_maximum_count_and_quantized_minimum_gaps(self):
        example = pack_axis(10000000, 3000000, 1000000)
        self.assertEqual(example.payload(), {"count": 2, "a": 800, "b": 2400, "bMax": 2400})
        # Exercise nm remainders that cannot be shared evenly among gaps.
        for length in range(1, 100):
            for die in (1, 3, 7, 23, 100):
                for gap in (1, 2, 9):
                    axis = pack_axis(length, die, gap)
                    self.assertLess(length, 2 + (axis.count + 1) * die + axis.count * max(gap, 3))
                    if axis.count:
                        self.assertGreaterEqual(axis.margin, 1)
                        self.assertGreaterEqual(length - axis.offset(axis.count - 1) - die, 1)
                    if axis.count > 1:
                        actual = [axis.offset(i + 1) - axis.offset(i) - die for i in range(axis.count - 1)]
                        self.assertGreaterEqual(min(actual), gap)
                        self.assertGreaterEqual(min(actual), 3 * axis.margin)
                        self.assertLessEqual(max(actual) - min(actual), 1)
                        self.assertEqual(axis.offset(0), length - axis.offset(axis.count - 1) - die)
        self.assertIsNone(pack_axis(100, 100, 5).payload()["b"])
        self.assertEqual(pack_axis(100, 101, 5).count, 0)

    def test_tight_packing_reserves_a_before_maximizing_count(self):
        # Three dies plus two minimum gaps would consume the entire cell.
        # Use two dies so both ends retain A rather than drawing at its edges.
        for length, die, gap, expected in [(10000000, 3000000, 500000, 2), (26000000, 8000000, 1000000, 2)]:
            axis = pack_axis(length, die, gap)
            self.assertEqual(axis.count, expected)
            self.assertGreater(axis.margin, 0)
            self.assertEqual(axis.offset(0), axis.margin)
            self.assertEqual(length - axis.offset(axis.count - 1) - die, axis.margin)
        self.assertEqual(pack_axis(10000000, 10000000, 100000).count, 0)
        self.assertEqual(pack_axis(10000000, 9999998, 100000).margin, 1)

    def test_actual_dummy_rectangles_keep_a_in_every_boundary_cell(self):
        for mode in ("center", "corner", "x_half", "y_half"):
            result = arrange_wafer(parameters(allowableDiameter=50000, cowSize={"x": 10000, "y": 10000}, arrangeType=mode,
                dummyLayers=[{"size": {"x": 3000, "y": 3000}, "minSpacing": {"x": 500, "y": 500}}]))
            layer = result["dummyLayers"][0]
            self.assertEqual(layer["x"]["count"], 2)
            self.assertEqual(layer["x"]["a"], 800)
            self.assertTrue(layer["rectangles"])
            for rect in layer["rectangles"]:
                self.assertTrue(any(cell[0] + layer["x"]["a"] <= rect[0] and cell[1] + layer["y"]["a"] <= rect[1]
                                    and rect[2] <= cell[2] - layer["x"]["a"] and rect[3] <= cell[3] - layer["y"]["a"]
                                    for cell in result["boundaryCells"]), (mode, rect))

    def test_multiple_layers_are_independent_and_deterministic(self):
        p = parameters(dummyLayers=[
            {"size": {"x": 8000, "y": 10000}, "minSpacing": {"x": 100, "y": 100}},
            {"size": {"x": 5000, "y": 6000}, "minSpacing": {"x": 200, "y": 300}},
            {"size": {"x": 50000, "y": 60000}, "minSpacing": {"x": 200, "y": 300}},
        ])
        result = arrange_wafer(p)
        self.assertEqual(result, arrange_wafer(p))
        self.assertEqual([layer["datatype"] for layer in result["dummyLayers"]], [10, 11, 12])
        self.assertNotEqual(result["dummyLayers"][0]["count"], result["dummyLayers"][1]["count"])
        self.assertEqual(result["dummyLayers"][2]["count"], 0)
        self.assertIn("does not fit", result["warnings"][0])

    def test_input_validation_and_precision(self):
        for value in (0, -1, 300000, float("inf"), float("nan"), True, "290000"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                parameters(allowableDiameter=value)
        with self.assertRaises(ValidationError):
            parameters(cowSpacing={"x": -1, "y": 0})
        with self.assertRaises(ValidationError):
            parameters(dummyLayers=[{"size": {"x": 100, "y": 100}, "minSpacing": {"x": 0, "y": 1}}])
        rounded = arrange_wafer(parameters(cowSize={"x": 40000.0014, "y": 50000.0014}, cowSpacing={"x": .0001, "y": .0001}))
        self.assertEqual(rounded["normalizedParameters"]["cowSpacing"], {"x": .001, "y": .001})
        self.assertTrue(rounded["warnings"])
        for rect in rounded["cowRectangles"] + rounded["dummyLayers"][0]["rectangles"]:
            self.assertTrue(inside(rect, 145000))
            for value in rect:
                self.assertAlmostEqual(value * 1000, round(value * 1000), places=5)
        with self.assertRaises(ArrangementError):
            arrange_wafer(parameters(allowableDiameter=299999.9999))

    def test_candidate_and_output_limits_fail_without_partial_patterns(self):
        with self.assertRaisesRegex(ArrangementError, "candidate limit"):
            arrange_wafer(parameters(cowSize={"x": .001, "y": .001}, cowSpacing={"x": 0, "y": 0}))
        with self.assertRaisesRegex(ArrangementError, "candidate limit"):
            arrange_wafer(parameters(dummyLayers=[{"size": {"x": .001, "y": .001}, "minSpacing": {"x": .001, "y": .001}}]))
        with patch("process_flow_geometry_generators.wafer_arrangement.MAX_RECTANGLES", 25):
            with self.assertRaisesRegex(ArrangementError, "output rectangle limit"):
                arrange_wafer(parameters())


if __name__ == "__main__":
    unittest.main()
