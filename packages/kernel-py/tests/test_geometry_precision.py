import copy
import unittest

from process_flow_kernel.precision import place_on_coordinate_grid, quantize_coordinate


class GeometryPrecisionTests(unittest.TestCase):
    def test_symmetric_ties_and_idempotence(self):
        for value, expected in ((.00005, .0001), (-.00005, -.0001), (100000.00099999999, 100000.001), (-1e-12, 0.0)):
            self.assertEqual(quantize_coordinate(value), expected)
            self.assertEqual(quantize_coordinate(quantize_coordinate(value)), expected)

    def test_absolute_subtree_endpoints_share_a_grid_without_mutating_source(self):
        geometry = {"type": "BoxGeometry", "bottom_left": [0, 0, .1], "top_right": [1, 1, .1], "thk": .2}
        source = {"unitSystem": "um", "root": {"bodies": [{"material": "Si", "geometry": geometry}],
                  "children": [{"bodies": [{"material": "Cu", "geometry": {**geometry, "bottom_left": [1, 0, .1], "top_right": [2, 1, .1]}}]}]}}
        original = copy.deepcopy(source)
        result, base = place_on_coordinate_grid(source, x=.99999999997, y=0, bottom_z=.3)
        self.assertEqual(source, original)
        first = result["root"]["bodies"][0]["geometry"]
        second = result["root"]["children"][0]["bodies"][0]["geometry"]
        self.assertEqual(first["top_right"][0], second["bottom_left"][0])
        self.assertEqual(first["bottom_left"], [1, 0, .3])
        self.assertEqual(first["thk"], .2)
        self.assertEqual(base, .3)

    def test_subgrid_thickness_is_not_silently_removed(self):
        source = {"unitSystem": "um", "root": {"bodies": [{"geometry": {
            "type": "BoxGeometry", "bottom_left": [0, 0, 0], "top_right": [1, 1, 0], "thk": .00001}}]}}
        with self.assertRaisesRegex(ValueError, "collapse.*thickness"):
            place_on_coordinate_grid(source, x=0, y=0, bottom_z=0)

    def test_unit_conversion_uses_the_same_physical_grid(self):
        source = {"unitSystem": "mm", "root": {"bodies": [{"geometry": {
            "type": "BoxGeometry", "bottom_left": [0, 0, 0], "top_right": [1, 1, 0], "thk": 1}}]}}
        result, _ = place_on_coordinate_grid(source, x=.00000006, y=0, bottom_z=0)
        self.assertEqual(result["root"]["bodies"][0]["geometry"]["bottom_left"][0], .0000001)
