"""Differential coverage for Region's candidate-pruning optimizations."""
import math as stdlib_math
import random
import unittest
from unittest.mock import patch

from process_flow_kernel.domain import region as region_module
from process_flow_kernel.domain.region import Region, TYPE_DIE, TYPE_EMPTY, TYPE_TARGET


class LegacyRegion(Region):
    """The full-grid marking algorithm used before candidate pruning."""

    def _mark_box(self, box, set_to):
        for i in range(self.cell_num_x):
            cx = (self.table_x_dim[i] + self.table_x_dim[i + 1]) / 2
            for j in range(self.cell_num_y):
                cy = (self.table_y_dim[j] + self.table_y_dim[j + 1]) / 2
                if box[0] < cx < box[2] and box[1] < cy < box[3]:
                    self.cell_type[i][j] |= set_to


def legacy_orient_nested_loops(loops, region):
    result = []
    for loop in loops:
        depth = sum(
            1 for other in loops
            if other is not loop
            and any(region_module._point_strictly_in_loop(point, other) for point in loop)
        )
        result.append(region._ensure_orientation(loop, depth % 2 == 0))
    return result


def box(x0, y0, x1, y1):
    return {"type": "BOX", "dim": [x0, y0, x1, y1]}


def ring(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


class RegionOptimizationTests(unittest.TestCase):
    def assert_matches_legacy(self, faces, references=(), gap=0):
        actual, expected = Region(), LegacyRegion()
        actual.set(faces, list(references))
        expected.set(faces, list(references))
        self.assertEqual(actual.table_x_dim, expected.table_x_dim)
        self.assertEqual(actual.table_y_dim, expected.table_y_dim)
        self.assertEqual(actual.cell_type, expected.cell_type)
        self.assertEqual(
            actual.set_gap(gap, is_recursive=True),
            expected.set_gap(gap, is_recursive=True),
        )
        self.assertEqual(actual.cell_type, expected.cell_type)
        for mask in (TYPE_DIE, TYPE_TARGET, TYPE_DIE | TYPE_TARGET):
            for detail in (False, True):
                actual_outline = actual.get_outline(mask, is_detail=detail)
                with patch.object(region_module, "_orient_nested_loops", legacy_orient_nested_loops):
                    expected_outline = expected.get_outline(mask, is_detail=detail)
                self.assertEqual(actual_outline, expected_outline)
        return actual

    def test_aligned_staggered_overlapping_and_reversed_boxes(self):
        cases = {
            "aligned": [box(x * 11, y * 11, x * 11 + 10, y * 11 + 10)
                        for x in range(4) for y in range(3)],
            "staggered": [box(x * 11 + i * 0.01, y * 11 + i * 0.01,
                              x * 11 + i * 0.01 + 10, y * 11 + i * 0.01 + 10)
                          for i, (x, y) in enumerate((x, y) for x in range(4) for y in range(3))],
            "overlapping": [box(-12, -8, 3, 7), box(-4, -5, 11, 9), box(0, 1, 6, 4)],
            "reversed": [box(10, 8, -10, -8), box(14, -8, 24, 8)],
            "mixed_polygon": [
                {"type": "POLYGON", "dim": list(reversed(ring(0, 0, 20, 20)))},
                {"type": "POLYGON", "dim": ring(4, 4, 16, 16)},
                box(-2, 5, 6, 10),
            ],
        }
        for name, faces in cases.items():
            with self.subTest(name=name):
                self.assert_matches_legacy(faces, gap=4)

    def test_reference_edges_and_midpoint_rounding_are_preserved(self):
        next_one = stdlib_math.nextafter(1.0, 2.0)
        actual = self.assert_matches_legacy(
            [box(1, 1, 2, 2)],
            [box(0, 0, 4, 4), box(next_one, next_one, 3, 3)],
        )
        # This cell's midpoint rounds to the lower boundary. An unconditional
        # fill of the edge-index window would change the occupied region.
        first_x = actual.table_x_dim.index(1.0)
        first_y = actual.table_y_dim.index(1.0)
        self.assertEqual(actual.cell_type[first_x][first_y], TYPE_EMPTY)
        self.assert_matches_legacy([], [box(-4, -4, 4, 4)])

    def test_midpoint_selection_with_boxes_between_existing_edges(self):
        references = [box(i, i, i + 1, i + 1) for i in range(6)]
        actual, expected = Region(), LegacyRegion()
        for region in (actual, expected):
            region.set([], references)
            region._mark_box([0.25, 1.2, 4.4, 5.3], TYPE_DIE)
            region._mark_box([-2, -2, 1.1, 2.1], TYPE_TARGET)
            region._mark_box([8, 8, 10, 10], TYPE_TARGET)
        self.assertEqual(actual.cell_type, expected.cell_type)

    def test_gap_tolerance_and_pinched_tangent_outline_are_preserved(self):
        faces = [box(0, 0, 10, 10), box(14, 0, 24, 10)]
        for gap in (4 - 2e-5, 4 - 0.5e-5, 4, 4 + 0.5e-5):
            with self.subTest(gap=gap):
                self.assert_matches_legacy(faces, gap=gap)
        self.assert_matches_legacy(
            [box(*bounds) for bounds in (
                [0, 0, 6, 6], [0, 10, 6, 16], [10, 10, 16, 16],
                [10, 20, 16, 26], [20, 0, 26, 6], [20, 20, 26, 26],
            )],
            gap=14,
        )

    def test_nesting_orientation_matches_legacy_with_tangency_and_identity(self):
        outer = ring(0, 0, 30, 30)
        loops = [outer, ring(5, 5, 25, 25), ring(10, 10, 20, 20),
                 ring(0, 2, 3, 4), ring(40, 0, 50, 10),
                 ring(50 + 0.5e-5, 0, 60, 10), ring(60 + 2e-5, 0, 70, 10)]
        for candidates in (loops, list(reversed(loops)),
                           [list(reversed(loop)) for loop in loops],
                           [outer, outer, *loops[1:]]):
            with self.subTest(candidates=candidates):
                self.assertEqual(
                    region_module._orient_nested_loops(candidates, Region()),
                    legacy_orient_nested_loops(candidates, Region()),
                )

    def test_seeded_mixed_layouts_preserve_cells_and_ordered_outlines(self):
        rng = random.Random(2194)
        for sample in range(8):
            faces = []
            for index in range(10):
                x, y = rng.randrange(-10, 11), rng.randrange(-10, 11)
                offset = index * 0.001 if sample % 2 else 0
                faces.append(box(x + offset, y + offset,
                                 x + offset + rng.randrange(1, 7),
                                 y + offset + rng.randrange(1, 7)))
            with self.subTest(sample=sample):
                self.assert_matches_legacy(faces, [box(-15, -15, 20, 20)], gap=sample % 4)


if __name__ == "__main__":
    unittest.main()
