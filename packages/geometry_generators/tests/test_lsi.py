from __future__ import annotations

import unittest

from process_flow_geometry_generators import GeometryGeneratorRegistry, register_builtin_generators
from process_flow_kernel import ProcessGeometryState, validate_geometry_semantic_keys


class LsiTests(unittest.TestCase):
    def setUp(self):
        self.registry = GeometryGeneratorRegistry()
        register_builtin_generators(self.registry)

    def preview(self, generation="gen1", **parameters):
        return self.registry.preview("lsi", {"generation": generation, **parameters}, generator_version=1)

    def test_all_generations_tag_active_layers_and_vias_including_zero_thickness(self):
        body_keys = {
            "body:lsi-si": "lsi.si", "body:lsi-usg": "lsi.usg",
            "body:lsi-fs-pm0": "lsi.fspm0", "body:lsi-daf": "lsi.daf",
            "body:lsi-bs-pm0": "lsi.bspm0", "body:lsi-pre-pm0": "lsi.prepm0",
            "body:lsi-fow": "lsi.fow", "body:lsi-si-carrier": "lsi.si_carrier",
        }
        via_keys = {"via:lsi-fs-via0": "lsi.fsvia0", "via:lsi-bs-via0": "lsi.bsvia0"}
        expected = {
            "gen1": ({"lsi.si", "lsi.usg", "lsi.fspm0"}, {"lsi.fsvia0"}),
            "gen2": (set(body_keys.values()), set(via_keys.values())),
            "gen2-bs-first": (set(body_keys.values()) - {"lsi.daf", "lsi.bspm0"}, {"lsi.fsvia0"}),
        }
        defaults = next(item for item in self.registry.definitions() if item["id"] == "lsi")["defaultParameters"]
        for generation, (bodies, vias) in expected.items():
            for zero in (False, True):
                with self.subTest(generation=generation, zero=zero):
                    parameters = {key: 0 for key in defaults if key.endswith("Thickness")} if zero else {}
                    preview = self.preview(generation, **parameters)
                    self.assertTrue(preview["valid"], preview["errors"])
                    structure = preview["geometryEntityJson"]["structure"]
                    root = structure["root"]
                    self.assertEqual(root["key"], "lsi")
                    self.assertEqual({body["key"] for body in root["bodies"]}, bodies)
                    self.assertEqual({via["key"] for via in root["vias"]}, vias)
                    for collection, keys in (("bodies", body_keys), ("vias", via_keys)):
                        for feature in root[collection]:
                            self.assertEqual(feature["key"], keys[feature["id"]])
                            if zero:
                                self.assertEqual(feature["geometry"]["thk"], 0)
                    self.assertTrue(all("key" not in bump for bump in root["bumps"]))
                    validate_geometry_semantic_keys(structure)
                    state = ProcessGeometryState.from_structure(structure)
                    self.assertEqual(state.to_geometry_structure(), structure)
                    self.assertEqual(self.registry.generate("lsi", 1, preview["normalizedParameters"]), preview["geometryEntityJson"])

    def test_bs_first_default_stack_bump_and_preview(self):
        preview = self.preview("gen2-bs-first")
        self.assertTrue(preview["valid"], preview["errors"])
        root = preview["geometryEntityJson"]["structure"]["root"]
        self.assertEqual([body["id"] for body in root["bodies"]], [
            "body:lsi-si", "body:lsi-usg", "body:lsi-pre-pm0",
            "body:lsi-fs-pm0", "body:lsi-fow", "body:lsi-si-carrier",
        ])
        self.assertEqual([body["material"] for body in root["bodies"]], [
            "Si", "usg", "Mat_PIBL301UUU0P1", "lsi_top_molding", "Fow", "Si",
        ])
        self.assertEqual([body["geometry"]["thk"] for body in root["bodies"]], [200, 15.5, 15, 26, 10, 200])
        self.assertEqual(root["bumps"], [{
            "id": "bump:lsi-micro-bump",
            "geometry": {"type": "BoxGeometry", "bottom_left": [-4000, -5000, -247.25],
                         "top_right": [4000, 5000, -247.25], "thk": 28},
            "material": "Cu/Ni/SnAg", "density": 42, "koz": 0,
            "direction": "-z", "stage": "reflowed",
        }])
        geometries = [root["bumps"][0]["geometry"], *[body["geometry"] for body in root["bodies"]]]
        for lower, upper in zip(geometries, geometries[1:]):
            self.assertEqual(lower["bottom_left"][2] + lower["thk"], upper["bottom_left"][2])
        self.assertEqual(geometries[-1]["bottom_left"][2] + geometries[-1]["thk"], 247.25)
        self.assertEqual(root["bodies"][-1]["key"], "lsi.si_carrier")
        self.assertEqual(len(root["vias"]), 1)
        front = root["vias"][0]
        self.assertEqual(front["id"], "via:lsi-fs-via0")
        self.assertEqual(front["geometry"]["bottom_left"][2], -3.75)
        self.assertEqual((front["direction"], front["density"], front["geometry"]["thk"]), ("+z", 50, 26))
        self.assertEqual(preview["computedParameters"]["totalThickness"], 494.5)
        self.assertEqual(preview["geometryEntityJson"]["dim"], "8000 x 10000 x 494.5 um")
        for view in preview["engineeringPreview"]["views"]:
            self.assertEqual(len([entity for entity in view["entities"] if entity["role"] == "bump"]), 1)
        section = preview["engineeringPreview"]["views"][1]
        self.assertEqual((section["bounds"]["vMin"], section["bounds"]["vMax"]), (-247.25, 247.25))
        self.assertEqual(section["dimensions"][0]["value"], 494.5)

    def test_bs_first_custom_bump_zero_height_and_roundtrip(self):
        for height in (0, 12, 100):
            for density in (0, 100):
                with self.subTest(height=height, density=density):
                    preview = self.preview("gen2-bs-first", microBumpMaterial="  Custom solder  ",
                                           microBumpThickness=height, microBumpDensity=density, microBumpKoz=9)
                    self.assertTrue(preview["valid"], preview["errors"])
                    root = preview["geometryEntityJson"]["structure"]["root"]
                    bump = root["bumps"][0]
                    self.assertEqual((bump["material"], bump["density"], bump["koz"]), ("Custom solder", density, 9))
                    self.assertEqual(bump["geometry"]["thk"], height)
                    self.assertEqual(bump["geometry"]["bottom_left"][2] + height, root["bodies"][0]["geometry"]["bottom_left"][2])
                    self.assertEqual(preview["computedParameters"]["totalThickness"], 466.5 + height)
                    self.assertEqual(self.registry.generate("lsi", 1, preview["normalizedParameters"]), preview["geometryEntityJson"])
                    self.assertEqual(self.registry.materialize(preview["previewToken"]), preview)

    def test_bs_first_invalid_bump_values_are_field_errors(self):
        for suffix, values in (
            ("Material", ("", " ", None, True, 1)),
            ("Thickness", (-1, True, "0", None, float("nan"), float("inf"), 10**400)),
            ("Density", (-1, 101, True, "42", None, float("nan"), float("inf"), 10**400)),
            ("Koz", (-1, True, "0", None, float("nan"), float("inf"), 10**400)),
        ):
            field = f"microBump{suffix}"
            for value in values:
                with self.subTest(field=field, value=value):
                    preview = self.preview("gen2-bs-first", **{field: value})
                    self.assertEqual(set(preview["errors"]), {field})
                    self.assertIsNone(preview["geometryEntityJson"])
                    self.assertIsNone(preview["previewToken"])
        overflow = self.preview("gen2-bs-first", microBumpThickness=1e308, siThickness=1e308)
        self.assertEqual(set(overflow["errors"]), {"siCarrierThickness"})

    def test_bs_first_ignores_removed_backside_parameters(self):
        default = self.preview("gen2-bs-first")
        preview = self.preview("gen2-bs-first", dafMaterial="", dafThickness=-1,
                               bsPm0Material=None, bsPm0Thickness=True,
                               bsVia0Material="", bsVia0Thickness=-1, bsVia0Density=101)
        self.assertTrue(preview["valid"], preview["errors"])
        self.assertEqual(preview["normalizedParameters"], default["normalizedParameters"])
        self.assertEqual(preview["geometryHash"], default["geometryHash"])
        for generation in ("gen1", "gen2"):
            preview = self.preview(generation, microBumpMaterial=None, microBumpThickness=-1,
                                   microBumpDensity=101, microBumpKoz=-1)
            self.assertTrue(preview["valid"], preview["errors"])
            self.assertFalse(any(key.startswith("microBump") for key in preview["normalizedParameters"]))
            self.assertEqual(preview["geometryEntityJson"]["structure"]["root"]["bumps"], [])

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
                    self.assertEqual(bodies[0]["key"], "lsi.daf")
                    self.assertEqual(bodies[-1]["key"], "lsi.si_carrier")
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
        for generation, via, limit in (("gen1", "fsVia0", 26), ("gen2", "fsVia0", 41), ("gen2", "bsVia0", 15), ("gen2-bs-first", "fsVia0", 41)):
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

    def test_bs_first_front_via_tracks_host_layer_changes(self):
        preview = self.preview("gen2-bs-first", prePm0Thickness=8, fsPm0Thickness=12, fsVia0Thickness=20)
        self.assertTrue(preview["valid"])
        root = preview["geometryEntityJson"]["structure"]["root"]
        self.assertEqual(root["vias"][0]["geometry"]["bottom_left"][2] + 20,
                         root["bodies"][3]["geometry"]["bottom_left"][2] + 12)
        invalid = self.preview("gen2-bs-first", prePm0Thickness=8, fsPm0Thickness=11, fsVia0Thickness=20)
        self.assertEqual(set(invalid["errors"]), {"fsVia0Thickness"})

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
