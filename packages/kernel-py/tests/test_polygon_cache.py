import copy
import math
import unittest
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from unittest.mock import patch

from process_flow_kernel.utils import polygon


def rectangle(x=0, y=0, z=0, size=10):
    return [[x, y, z], [x + size, y, z],
            [x + size, y + size, z], [x, y + size, z]]


class PolygonCacheTests(unittest.TestCase):
    def setUp(self):
        polygon._clear_polygon_cache()

    def tearDown(self):
        polygon._clear_polygon_cache()

    def test_validation_and_classification_reuse_successful_content(self):
        loops = [rectangle(), rectangle(2, 2, size=6), rectangle(3, 3, size=1)]
        with patch.object(polygon, "_validate_single_loop", wraps=polygon._validate_single_loop) as validate:
            with patch.object(polygon, "_loop_strictly_inside", wraps=polygon._loop_strictly_inside) as inside:
                first = polygon.classify_polygon_loops(loops)
                validation_calls, classification_calls = validate.call_count, inside.call_count
                second = polygon.classify_polygon_loops(copy.deepcopy(loops))
                polygon.validate_polygon_loops(copy.deepcopy(loops))
                self.assertEqual(validate.call_count, validation_calls)
                self.assertEqual(inside.call_count, classification_calls)
        self.assertEqual(first, second)
        self.assertEqual([len(region.holes) for region in second], [1, 0])
        self.assertEqual(polygon._polygon_cache_info(), {"entries": 1, "vertices": 12})

    def test_cached_returns_and_input_have_no_mutable_aliases(self):
        loops = [rectangle(), rectangle(2, 2, size=6)]
        original = copy.deepcopy(loops)
        validated = polygon.validate_polygon_loops(loops)
        validated[0][0][0] = -100
        validated[1].append([99, 99, 0])
        first = polygon.classify_polygon_loops(loops)
        first[0].outer[0][0] = -200
        first[0].holes[0][0][0] = -300
        first[0].holes.append(rectangle(100, 100))
        second = polygon.classify_polygon_loops(loops)
        second[0].holes[0][1][1] = -400
        third = polygon.classify_polygon_loops(loops)
        self.assertEqual(loops, original)
        self.assertEqual(third[0].outer, original[0])
        self.assertEqual(third[0].holes, [original[1]])
        self.assertEqual(polygon.validate_polygon_loops(loops), original)

    def test_key_contains_full_xy_and_z_coordinates(self):
        loops = [rectangle()]
        polygon.validate_polygon_loops(loops)
        # Change the shape while retaining its vertex count and XY bounds.
        loops[0][1][0] = 9
        polygon.validate_polygon_loops(loops)
        translated_z = [[[x, y, 5] for x, y, _ in loops[0]]]
        self.assertEqual(polygon.classify_polygon_loops(translated_z)[0].z, 5)
        self.assertEqual(polygon._polygon_cache_info()["entries"], 3)
        loops[0][2][2] = 1
        with self.assertRaisesRegex(ValueError, "same xy plane \\(loop 0\\)"):
            polygon.validate_polygon_loops(loops)
        self.assertEqual(polygon._polygon_cache_info()["entries"], 3)

    def test_normalized_closing_point_and_coordinate_types_are_preserved(self):
        loop = rectangle(size=1)
        with patch.object(polygon, "_validate_single_loop", wraps=polygon._validate_single_loop) as validate:
            polygon.validate_polygon_loops([loop])
            closed = loop + [[0.000001, 0, 0]]
            self.assertEqual(polygon.validate_polygon_loops([closed]), [loop])
            self.assertEqual(validate.call_count, 1)
        boolean_loop = [[False, False, False], [True, False, False],
                        [True, True, False], [False, True, False]]
        float_loop = [[float(value) for value in point] for point in loop]
        for value, expected_type in [(boolean_loop, bool), (float_loop, float), (loop, int)]:
            result = polygon.classify_polygon_loops([value])
            self.assertIs(type(result[0].outer[0][0]), expected_type)
        self.assertEqual(polygon._polygon_cache_info()["entries"], 3)

    def test_errors_are_not_cached_and_touching_semantics_are_unchanged(self):
        cases = [
            ([], "requires at least one polygon loop"),
            ([[[0, 0, 0], [1, 0, 0]]], "requires at least 3 points"),
            ([[[0, 0, 0], [2, 2, 0], [0, 2, 0], [2, 0, 0]]], "self-intersects"),
            ([rectangle(), rectangle(5, 0)], "loops intersect or touch"),
        ]
        for loops, message in cases:
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, message):
                    polygon.classify_polygon_loops(loops)
        self.assertEqual(polygon._polygon_cache_info(), {"entries": 0, "vertices": 0})
        # A shared endpoint is allowed, while a shared edge remains invalid.
        touching = [rectangle(), rectangle(10, 10)]
        self.assertEqual(len(polygon.classify_polygon_loops(touching)), 2)
        self.assertEqual(len(polygon.classify_polygon_loops(touching)), 2)
        with self.assertRaisesRegex(ValueError, "loops intersect or touch"):
            polygon.classify_polygon_loops([rectangle(), rectangle(10, 0)])

    def test_nonfinite_values_bypass_cache_without_new_validation_rules(self):
        # The existing XY-plane checks accept a common nonfinite Z. Retain that
        # behavior, but do not retain nonfinite values as cache keys/results.
        for z in [float("inf"), float("-inf"), float("nan")]:
            loops = [rectangle(z=z)]
            with patch.object(polygon, "_validate_single_loop", wraps=polygon._validate_single_loop) as validate:
                first = polygon.classify_polygon_loops(loops)
                polygon.classify_polygon_loops(loops)
                self.assertEqual(validate.call_count, 2)
            self.assertTrue(math.isnan(first[0].z) if math.isnan(z) else first[0].z == z)
        self.assertEqual(polygon._polygon_cache_info(), {"entries": 0, "vertices": 0})

    def test_custom_numeric_coordinates_keep_existing_behavior_without_caching(self):
        loops = [[[Decimal(value) for value in point] for point in rectangle()]]
        with patch.object(polygon, "_validate_single_loop", wraps=polygon._validate_single_loop) as validate:
            polygon.classify_polygon_loops(loops)
            result = polygon.classify_polygon_loops(loops)
            self.assertEqual(validate.call_count, 2)
        self.assertIs(type(result[0].outer[0][0]), Decimal)
        self.assertEqual(polygon._polygon_cache_info(), {"entries": 0, "vertices": 0})

    def test_classification_failure_does_not_cache_a_classification(self):
        loops = [rectangle(), rectangle(20, 20)]
        with patch.object(polygon, "_loop_strictly_inside", return_value=True) as inside:
            for _ in range(2):
                with self.assertRaisesRegex(ValueError, "does not contain any hull loop"):
                    polygon.classify_polygon_loops(loops)
            self.assertEqual(inside.call_count, 4)
        self.assertEqual(len(polygon.classify_polygon_loops(loops)), 2)

    def test_entry_bound_evicts_least_recently_used_content(self):
        self.assertEqual(polygon._POLYGON_CACHE_MAX_ENTRIES, 128)
        self.assertEqual(polygon._POLYGON_CACHE_MAX_VERTICES, 100_000)
        for x in range(128):
            polygon.validate_polygon_loops([rectangle(x=x)])
        polygon.validate_polygon_loops([rectangle(x=0)])
        polygon.validate_polygon_loops([rectangle(x=128)])
        with patch.object(polygon, "_validate_single_loop", wraps=polygon._validate_single_loop) as validate:
            polygon.validate_polygon_loops([rectangle(x=0)])
            self.assertEqual(validate.call_count, 0)
            polygon.validate_polygon_loops([rectangle(x=1)])
            self.assertEqual(validate.call_count, 1)
        self.assertEqual(polygon._polygon_cache_info(), {"entries": 128, "vertices": 512})

    def test_vertex_budget_and_oversized_bypass(self):
        with patch.object(polygon, "_POLYGON_CACHE_MAX_VERTICES", 12):
            for x in range(4):
                polygon.classify_polygon_loops([rectangle(x=x)])
            self.assertEqual(polygon._polygon_cache_info(), {"entries": 3, "vertices": 12})
        polygon._clear_polygon_cache()
        with patch.object(polygon, "_POLYGON_CACHE_MAX_VERTICES", 3):
            with patch.object(polygon, "_validate_single_loop", wraps=polygon._validate_single_loop) as validate:
                polygon.classify_polygon_loops([rectangle()])
                polygon.classify_polygon_loops([rectangle()])
                self.assertEqual(validate.call_count, 2)
            self.assertEqual(polygon._polygon_cache_info(), {"entries": 0, "vertices": 0})

    def test_concurrent_validation_and_classification_return_independent_results(self):
        def classify(index):
            x = index % 4
            loops = [rectangle(x=x), rectangle(x=x + 2, y=2, size=6)]
            polygon.validate_polygon_loops(loops)
            regions = polygon.classify_polygon_loops(loops)
            self.assertEqual(regions[0].outer[0][0], x)
            self.assertEqual(len(regions[0].holes), 1)
            regions[0].outer[0][0] = -1
            regions[0].holes[0][0][0] = -2
            return len(regions)

        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(list(pool.map(classify, range(128))), [1] * 128)
        self.assertEqual(polygon._polygon_cache_info(), {"entries": 4, "vertices": 32})
        polygon._clear_polygon_cache()
        self.assertEqual(polygon._polygon_cache_info(), {"entries": 0, "vertices": 0})


if __name__ == "__main__":
    unittest.main()
