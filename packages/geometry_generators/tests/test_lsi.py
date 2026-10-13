from __future__ import annotations

import unittest

from process_flow_geometry_generators import GeometryGeneratorRegistry, register_builtin_generators


class LsiTests(unittest.TestCase):
    def setUp(self):
        self.registry = GeometryGeneratorRegistry()
        register_builtin_generators(self.registry)

    def preview(self, generation="gen1", **parameters):
        return self.registry.preview("lsi", {"generation": generation, **parameters}, generator_version=1)

    def test_default_stacks_and_via_anchors(self):
        for generation, thickness, materials, heights, fs_start, bs_start in (
            ("gen1", 241.5, ["Si", "usg", "lsi_top_molding"],
             [200, 15.5, 26], 94.75, None),
            ("gen2", 491.5, ["DAF", "Mat_MCA7UUU0P1", "Si", "usg", "Mat_PIBL301UUU0P1", "lsi_top_molding", "Fow", "Si"],
             [10, 15, 200, 15.5, 15, 26, 10, 200], -5.25, -235.75),
        ):
            with self.subTest(generation=generation):
                preview = self.preview(generation)
                self.assertTrue(preview["valid"], preview["errors"])
                root = preview["geometryEntityJson"]["structure"]["root"]
                bodies = root["bodies"]
                self.assertEqual([b["material"] for b in bodies], materials)
                self.assertEqual([b["geometry"]["thk"] for b in bodies], heights)
                self.assertEqual(bodies[0]["geometry"]["bottom_left"][2], -thickness / 2)
                for lower, upper in zip(bodies, bodies[1:]):
                    self.assertEqual(lower["geometry"]["bottom_left"][2] + lower["geometry"]["thk"], upper["geometry"]["bottom_left"][2])
                last = bodies[-1]["geometry"]
                self.assertEqual(last["bottom_left"][2] + last["thk"], thickness / 2)
                self.assertEqual(preview["computedParameters"]["totalThickness"], thickness)
                fs = root["vias"][0]
                self.assertEqual(fs["geometry"]["bottom_left"][2], fs_start)
                self.assertEqual(fs["direction"], "+z")
                self.assertEqual(fs["geometry"]["thk"], 26)
                if generation == "gen2":
                    bs = root["vias"][1]
                    self.assertEqual(bs["geometry"]["bottom_left"][2], bs_start)
                    self.assertEqual(bs["direction"], "-z")
                    self.assertEqual(bs["geometry"]["thk"], 15)
                    self.assertEqual(bodies[0]["key"], "daf")
                    self.assertEqual(bodies[-1]["key"], "carrier")
                else:
                    self.assertEqual(len(root["vias"]), 1)
                for via in root["vias"]:
                    self.assertEqual(via["material"], "Cu")
                    self.assertEqual(via["density"], 50)
                    self.assertEqual(via["koz"], 0)
                    self.assertEqual(via["geometry"]["bottom_left"][:2], [-4000, -5000])
                    self.assertEqual(via["geometry"]["top_right"][:2], [4000, 5000])
                section = preview["engineeringPreview"]["views"][1]
                self.assertEqual(section["bounds"]["vMin"], -thickness / 2)
                self.assertEqual(section["bounds"]["vMax"], thickness / 2)
                self.assertEqual(len([e for e in section["entities"] if e["role"] == "via"]), len(root["vias"]))

    def test_via_heights_fit_independently_and_reject_overflow(self):
        for generation, via, limit in (("gen1", "fsVia0", 26), ("gen2", "fsVia0", 41), ("gen2", "bsVia0", 15)):
            for height in (0, limit / 2, limit, limit + 0.01):
                with self.subTest(generation=generation, via=via, height=height):
                    preview = self.preview(generation, **{f"{via}Thickness": height})
                    self.assertEqual(preview["valid"], height <= limit)
                    if height > limit:
                        self.assertEqual(set(preview["errors"]), {f"{via}Thickness"})
                        self.assertIsNone(preview["previewToken"])
                        self.assertIsNone(preview["geometryEntityJson"])
                    else:
                        feature = next(v for v in preview["geometryEntityJson"]["structure"]["root"]["vias"] if v["id"] == f"via:lsi-{'fs' if via == 'fsVia0' else 'bs'}-via0")
                        self.assertEqual(feature["geometry"]["thk"], height)

    def test_gen2_front_via_crosses_layer_boundary_and_tracks_layer_changes(self):
        preview = self.preview("gen2", prePm0Thickness=8, fsPm0Thickness=12, fsVia0Thickness=20)
        self.assertTrue(preview["valid"])
        root = preview["geometryEntityJson"]["structure"]["root"]
        via = root["vias"][0]["geometry"]
        fs_pm0 = root["bodies"][5]["geometry"]
        self.assertEqual(via["bottom_left"][2] + 20, fs_pm0["bottom_left"][2] + 12)
        invalid = self.preview("gen2", prePm0Thickness=8, fsPm0Thickness=11, fsVia0Thickness=20)
        self.assertEqual(set(invalid["errors"]), {"fsVia0Thickness"})
        self.assertEqual(set(self.preview("gen1", fsPm0Thickness=0)["errors"]), {"fsVia0Thickness"})
        self.assertEqual(set(self.preview("gen2", bsPm0Thickness=0)["errors"]), {"bsVia0Thickness"})

    def test_density_endpoints_material_trim_and_recipe_roundtrip(self):
        preview = self.preview("gen2", fsVia0Density=0, bsVia0Density=100, fsVia0Material="  Front Cu  ", bsVia0Material=" Back Cu ", dafMaterial=" Adhesive ")
        self.assertTrue(preview["valid"])
        root = preview["geometryEntityJson"]["structure"]["root"]
        self.assertEqual([v["density"] for v in root["vias"]], [0, 100])
        self.assertEqual([v["material"] for v in root["vias"]], ["Front Cu", "Back Cu"])
        self.assertEqual(root["bodies"][0]["material"], "Adhesive")
        self.assertEqual(self.registry.generate("lsi", 1, preview["normalizedParameters"]), preview["geometryEntityJson"])
        self.assertEqual(self.registry.materialize(preview["previewToken"]), preview)

    def test_invalid_via_values_return_only_field_errors(self):
        for via in ("fsVia0", "bsVia0"):
            for suffix, values in (
                ("Material", ("", " ", None, 1)),
                ("Thickness", (-1, True, "0", None, float("nan"), float("inf"), 10**400)),
                ("Density", (-1, 101, True, "50", None, float("nan"), float("inf"), 10**400)),
            ):
                field = f"{via}{suffix}"
                for value in values:
                    with self.subTest(field=field, value=value):
                        preview = self.preview("gen2", **{field: value})
                        self.assertFalse(preview["valid"])
                        self.assertEqual(set(preview["errors"]), {field})

    def test_all_layer_materials_are_required(self):
        for layer in ("daf", "bsPm0", "si", "usg", "prePm0", "fsPm0", "fow", "siCarrier"):
            for value in ("", " ", None, False):
                with self.subTest(layer=layer, value=value):
                    field = f"{layer}Material"
                    preview = self.preview("gen2", **{field: value})
                    self.assertEqual(set(preview["errors"]), {field})

    def test_inactive_parameters_are_ignored_and_removed(self):
        preview = self.preview("gen1", dafMaterial="", bsVia0Thickness=-1, bsVia0Density=999, siCarrierThickness=False)
        self.assertTrue(preview["valid"])
        self.assertEqual(set(preview["normalizedParameters"]), {
            "generation", "siMaterial", "siThickness", "usgMaterial", "usgThickness",
            "fsPm0Material", "fsPm0Thickness", "fsVia0Material", "fsVia0Thickness", "fsVia0Density",
        })

    def test_removed_parameters_are_rejected_without_conversion(self):
        for prefix in ("bsmc", "lsiTopMolding"):
            preview = self.preview(**{f"{prefix}Material": "Old", f"{prefix}Thickness": 20})
            self.assertFalse(preview["valid"])
            self.assertEqual(set(preview["errors"]), {f"{prefix}Material", f"{prefix}Thickness"})

    def test_total_thickness_overflow_is_a_field_error(self):
        preview = self.preview("gen2", siThickness=1e308, siCarrierThickness=1e308)
        self.assertFalse(preview["valid"])
        self.assertEqual(set(preview["errors"]), {"siCarrierThickness"})


if __name__ == "__main__":
    unittest.main()
