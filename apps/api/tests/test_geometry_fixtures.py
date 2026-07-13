from __future__ import annotations

import json
import unittest
from collections import Counter
from pathlib import Path


FIXTURE_PATH = (
    Path(__file__).resolve().parents[1]
    / "src/process_flow_api/fixtures/geometries.json"
)

CATALOG_COUNT_RANGES = {
    "die.hbm": (5, 10),
    "die.dram": (5, 10),
    "die.soc": (5, 10),
    "die.soic": (5, 10),
    "package.soic": (5, 10),
    "die.lsi": (5, 10),
    "die.cpo": (5, 10),
    "carrier.wafer": (1, 4),
    "carrier.panel": (1, 4),
}

# Broad industry-scale guardrails in micrometres. They intentionally permit
# multiple product classes while catching unit mistakes and placeholder sizes.
CATEGORY_DIMENSION_RANGES_UM = {
    "die.hbm": ((7_000, 12_000), (7_000, 12_000), (600, 1_000)),
    "die.dram": ((7_000, 16_000), (7_000, 16_000), (800, 1_300)),
    "die.soc": ((5_000, 32_000), (5_000, 32_000), (100, 350)),
    "die.soic": ((8_000, 20_000), (8_000, 20_000), (250, 900)),
    "package.soic": ((4_000, 19_000), (3_500, 8_000), (1_500, 3_000)),
    "die.lsi": ((3_000, 32_000), (3_000, 32_000), (100, 350)),
    "die.cpo": ((4_000, 16_000), (4_000, 16_000), (150, 600)),
    "carrier.wafer": ((150_000, 300_000), (150_000, 300_000), (600, 850)),
    "carrier.panel": ((300_000, 600_000), (300_000, 600_000), (500, 1_100)),
}


class GeometryFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.geometries = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_catalog_has_requested_category_counts_and_preserves_test_category(self):
        counts = Counter(item["category"] for item in self.geometries)

        for category, (minimum, maximum) in CATALOG_COUNT_RANGES.items():
            with self.subTest(category=category):
                self.assertGreaterEqual(counts[category], minimum)
                self.assertLessEqual(counts[category], maximum)

        self.assertTrue(
            any(item["category"].startswith("test.") for item in self.geometries)
        )

    def test_geometry_ids_are_unique(self):
        ids = [item["id"] for item in self.geometries]
        self.assertEqual(len(ids), len(set(ids)))

        fixture_ids = set(ids)
        self.assertTrue(
            {"panel_v1_0_0", "hbm_v1_3_1", "soc_v1_0_0", "test1"}
            <= fixture_ids
        )

    def test_descriptions_start_with_actual_xyz_dimensions(self):
        for item in self.geometries:
            with self.subTest(geometry_id=item["id"]):
                geometry = item["structure"]["root"]["bodies"][0]["geometry"]
                actual_dimensions = self._dimensions(geometry)
                dimension_text, separator, _ = item["description"].partition(" um — ")

                self.assertEqual(separator, " um — ")
                described_dimensions = tuple(
                    float(value) for value in dimension_text.split(" x ")
                )
                self.assertEqual(described_dimensions, actual_dimensions)

    def test_catalog_dimensions_are_centered_and_industry_scale(self):
        for item in self.geometries:
            ranges = CATEGORY_DIMENSION_RANGES_UM.get(item["category"])
            if ranges is None:
                continue

            with self.subTest(geometry_id=item["id"]):
                body = item["structure"]["root"]["bodies"][0]
                geometry = body["geometry"]
                x, y, z = self._dimensions(geometry)

                for value, (minimum, maximum) in zip((x, y, z), ranges):
                    self.assertGreaterEqual(value, minimum)
                    self.assertLessEqual(value, maximum)

                self._assert_centered(geometry)

    @staticmethod
    def _dimensions(geometry):
        if geometry["type"] == "CylinderGeometry":
            diameter = geometry["bottom_radius"] * 2
            return diameter, diameter, geometry["thk"]

        bottom_left = geometry["bottom_left"]
        top_right = geometry["top_right"]
        return (
            top_right[0] - bottom_left[0],
            top_right[1] - bottom_left[1],
            geometry["thk"],
        )

    def _assert_centered(self, geometry):
        if geometry["type"] == "CylinderGeometry":
            self.assertEqual(geometry["center"][0:2], [0, 0])
            self.assertEqual(geometry["center"][2] + geometry["thk"] / 2, 0)
            return

        bottom_left = geometry["bottom_left"]
        top_right = geometry["top_right"]
        self.assertEqual(bottom_left[0] + top_right[0], 0)
        self.assertEqual(bottom_left[1] + top_right[1], 0)
        self.assertEqual(bottom_left[2] + geometry["thk"] / 2, 0)
        self.assertEqual(bottom_left[2], top_right[2])


if __name__ == "__main__":
    unittest.main()
