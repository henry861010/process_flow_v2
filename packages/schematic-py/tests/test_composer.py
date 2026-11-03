import copy
import json
import math
import unittest

from process_flow_schematic import (
    CONDUCTOR_FILL, GENERIC_FILL, MATRIX_FILL, SILICON_FILL, SUPPORT_FILL, UNDERFILL_FILL,
    Bounds, ComponentHint, Primitive, SchematicPart, SchematicRegistry, compose_schematic,
    geometry_bounds, material_color, slab,
)


def body(id, z, thickness, *, material="Si", key=None, x=0, width=100):
    result = {"id": id, "material": material, "geometry": {
        "type": "BoxGeometry", "bottom_left": [x, 0, z], "top_right": [x + width, 100, z], "thk": thickness}}
    if key:
        result["key"] = key
    return result


def container(id, *, key=None, bodies=(), children=(), bumps=()):
    result = {"id": id, "bodies": list(bodies), "children": list(children), "bumps": list(bumps)}
    if key:
        result["key"] = key
    return result


def structure(root):
    return {"schemaVersion": "1.0.0", "unitSystem": "um", "root": root}


def component(context):
    return [SchematicPart("Die", component=ComponentHint("Die", representative_count=3))]


class ComposerTests(unittest.TestCase):
    def test_material_palette_is_consistent_for_aliases_and_runtime_instances(self):
        families = (
            (SILICON_FILL, ("Si", "silicon", "Si-Photonics", "HBM-package", "DRAM-package", "SoIC-stack")),
            (MATRIX_FILL, ("Epoxy-Mold-Compound", "lsi_top_molding", "EMC", "PI", "polyimide", "SiO2", "usg", "pass2")),
            (SUPPORT_FILL, ("glass", "carrier", "substrate", "FR4")),
            (UNDERFILL_FILL, ("UF", "underfill")),
            (CONDUCTOR_FILL, ("Cu", "copper", "SnAg", "solder")),
        )
        for expected, materials in families:
            for material in materials:
                with self.subTest(material=material):
                    self.assertEqual(material_color(material), expected)
                    self.assertEqual(material_color(material + "_dup12"), expected)
        self.assertEqual(material_color("custom material"), GENERIC_FILL)
        self.assertEqual(material_color("silicone"), GENERIC_FILL)

    def test_final_state_measurements_and_thin_layers_share_height_boundaries(self):
        source = structure(container("root", bodies=[body("base", 0, 1000), body("thin", 1000, 0.1)]))
        before = copy.deepcopy(source)
        doc = compose_schematic(source, SchematicRegistry())
        self.assertEqual(source, before)
        self.assertEqual(doc["totalThickness"], 1000.1)
        self.assertAlmostEqual(doc["items"][1]["thickness"], 0.1)
        bottom, thin = doc["shapes"]
        self.assertEqual(bottom["y"], thin["y"] + thin["height"])
        self.assertGreaterEqual(thin["height"], 10)
        self.assertEqual(json.loads(json.dumps(doc)), doc)

    def test_equivalent_instances_merge_ids_and_ignore_density_and_material_suffix(self):
        registry = SchematicRegistry()
        registry.register("container", component, key="test-die")
        first = container("first", key="test-die", bodies=[body("si1", 10, 30, material="Si")])
        second = container("second", key="test-die", bodies=[body("si2", 10, 30, material="Si_dup2", x=300)])
        source = structure(container("root", children=[first, second]))
        doc = compose_schematic(source, registry)
        self.assertEqual(len(doc["components"]), 3)
        self.assertEqual(len(doc["shapes"]), 3)
        self.assertEqual(len(doc["items"]), 1)
        self.assertEqual(doc["items"][0]["sourceIds"], ["si1", "si2"])

    def test_different_actual_thickness_or_z_keeps_separate_named_groups(self):
        registry = SchematicRegistry()
        registry.register("container", component, key="test-die")
        source = structure(container("root", children=[
            container("a", key="test-die", bodies=[body("a-si", 10, 20)]),
            container("b", key="test-die", bodies=[body("b-si", 10, 25)]),
            container("c", key="test-die", bodies=[body("c-si", 15, 20)]),
        ]))
        doc = compose_schematic(source, registry)
        self.assertEqual(len(doc["components"]), 9)
        self.assertEqual(len({item["groupLabel"] for item in doc["items"]}), 3)
        self.assertEqual(doc["totalThickness"], 25)

    def test_component_hint_is_not_applied_to_internal_unkeyed_layers(self):
        registry = SchematicRegistry()
        registry.register("container", component, key="test-die")
        source = structure(container("root", key="test-die", bodies=[body("envelope", 0, 40)], children=[
            container("internal1", bodies=[body("internal-si", 10, 10)]),
            container("internal2", bodies=[body("internal-si2", 25, 5)]),
        ]))
        doc = compose_schematic(source, registry)
        self.assertEqual(len(doc["components"]), 3)
        self.assertEqual(len(doc["items"]), 3)
        self.assertEqual(len(doc["shapes"]), 9)

    def test_explicit_noncomponent_support_stays_in_structure(self):
        registry = SchematicRegistry()
        registry.register("container", lambda context: [], key="support")
        source = structure(container("root", children=[container("support", key="support", bodies=[body("carrier", 0, 500)])]))
        doc = compose_schematic(source, registry)
        self.assertFalse(doc["components"])
        self.assertEqual(len(doc["items"]), 1)

    def test_presenter_is_read_only_and_failure_falls_back_per_node(self):
        def bad(context):
            context.node["geometry"]["thk"] = 999
            return []
        registry = SchematicRegistry()
        registry.register("body", bad, key="bad")
        registry.register("body", lambda context: [slab("Good", "#ffffff")], key="good")
        source = structure(container("root", bodies=[body("bad", 0, 5, key="bad"), body("good", 5, 2, key="good")]))
        doc = compose_schematic(source, registry)
        self.assertEqual(len(doc["shapes"]), 2)
        self.assertEqual(len(doc["warnings"]), 1)
        self.assertEqual(source["root"]["bodies"][0]["geometry"]["thk"], 5)

    def test_invalid_presenter_geometry_falls_back_without_nonfinite_json(self):
        registry = SchematicRegistry()
        registry.register("body", lambda context: [SchematicPart("Bad", primitives=(Primitive(x=math.nan),))])
        doc = compose_schematic(structure(container("root", bodies=[body("a", 0, 5)])), registry)
        self.assertEqual(len(doc["shapes"]), 1)
        self.assertEqual(len(doc["warnings"]), 1)
        json.dumps(doc, allow_nan=False)

    def test_failed_container_presenter_preserves_its_entire_subtree(self):
        def bad(context):
            raise RuntimeError("Presenter failure")
        registry = SchematicRegistry()
        registry.register("container", bad, key="test-die")
        source = structure(container("root", key="test-die", children=[
            container("base", bodies=[body("base-si", 0, 5)]),
            container("core", bodies=[body("core-si", 5, 8)]),
        ]))
        doc = compose_schematic(source, registry)
        self.assertEqual(len(doc["components"]), 1)
        self.assertEqual(doc["components"][0]["sourceIds"], ["root"])
        self.assertEqual(len(doc["items"]), 2)
        self.assertEqual(len(doc["warnings"]), 1)

    def test_zero_density_feature_stays_absent_even_if_presenter_fails(self):
        def bad(context):
            raise RuntimeError("Presenter failure")
        registry = SchematicRegistry()
        registry.register("bump", bad)
        bump = {**body("bump", 0, 5), "density": 0, "direction": "+z", "stage": "reflowed"}
        doc = compose_schematic(structure(container("root", bumps=[bump])), registry)
        self.assertEqual(doc["shapes"], [])
        self.assertEqual(doc["items"], [])

    def test_queries_are_memoized_within_one_composition_and_never_reused(self):
        calls = []
        def presenter(context):
            count = context.query("shared", lambda: calls.append(1) or len(calls))
            return [slab(f"Call {count}")]
        registry = SchematicRegistry()
        registry.register("body", presenter)
        source = structure(container("root", bodies=[body("a", 0, 5), body("b", 5, 3)]))
        first = compose_schematic(source, registry)
        self.assertEqual(len(calls), 1)
        second = compose_schematic(source, registry)
        self.assertEqual(len(calls), 2)
        self.assertEqual(first["items"][0]["label"], "Call 1")
        self.assertEqual(second["items"][0]["label"], "Call 2")

    def test_circle_radius_remains_scalar_and_occlusion_intervals_are_unioned(self):
        registry = SchematicRegistry()
        registry.register("body", lambda context: [SchematicPart("Base", primitives=(Primitive(kind="circle"),),
                                                                     occluded_by=("a", "a", "b"))], key="mask")
        source = structure(container("root", bodies=[body("base", 0, 10, key="mask")], children=[
            container("a", bodies=[body("a-si", 0, 10)]), container("b", bodies=[body("b-si", 0, 10)]),
        ]))
        doc = compose_schematic(source, registry)
        shape = next(s for s in doc["shapes"] if s["kind"] == "circle")
        self.assertIn("r", shape)
        cuts = shape["clip"]["exclusions"]
        self.assertEqual(len(cuts), 1)  # both equivalent source containers map to one representative
        self.assertGreater(cuts[0]["width"], 0)

    def test_repeated_circles_fill_wide_narrow_and_thin_display_bounds(self):
        counts = {}
        for name, component_width, thickness in (("wide", None, 10), ("die", 100, 10),
                                                  ("narrow", 0.1, 10), ("thin", 100, 0.0001)):
            with self.subTest(name=name):
                registry = SchematicRegistry()
                registry.register("bump", lambda context: [SchematicPart("Contact", primitives=(
                    Primitive(kind="circle", r=0.42, repeat_x=True),))])
                contact = {**body("contact", 0, thickness, width=component_width or 100), "density": 1}
                if component_width is None:
                    root = container("root", bumps=[contact])
                else:
                    registry.register("container", lambda context: [SchematicPart(
                        "Die", component=ComponentHint("Die"))], key="die")
                    root = container("root", children=[container("die", key="die", bumps=[contact],
                        bodies=[body("silicon", thickness, 20)])])
                source = structure(root)
                before = copy.deepcopy(source)
                doc = compose_schematic(source, registry)
                circles = [shape for shape in doc["shapes"] if shape["kind"] == "circle"]
                counts[name] = len(circles)
                self.assertTrue(circles)
                self.assertEqual(doc["warnings"], [])
                rect = circles[0]["clip"]
                radius = circles[0]["r"]
                left_margin = circles[0]["cx"] - radius - rect["x"]
                right_margin = rect["x"] + rect["width"] - circles[-1]["cx"] - radius
                self.assertAlmostEqual(left_margin, right_margin)
                self.assertGreater(left_margin, 0)
                self.assertLess(left_margin, 2 * radius)
                for circle in circles:
                    self.assertEqual(circle["r"], radius)
                    self.assertGreaterEqual(circle["cy"] - radius, rect["y"])
                    self.assertLessEqual(circle["cy"] + radius, rect["y"] + rect["height"])
                for left, right in zip(circles, circles[1:]):
                    gap = right["cx"] - left["cx"]
                    self.assertGreaterEqual(gap + 1e-9, 2.8 * radius)
                    self.assertAlmostEqual(gap, circles[1]["cx"] - circles[0]["cx"])
                self.assertEqual(len({shape["id"] for shape in doc["shapes"]}), len(doc["shapes"]))
                item = next(item for item in doc["items"] if "contact" in item["sourceIds"])
                self.assertEqual({shape["itemId"] for shape in circles}, {item["id"]})
                self.assertEqual(source, before)
                json.dumps(doc, allow_nan=False)
        self.assertGreater(counts["wide"], counts["die"])
        self.assertGreater(counts["thin"], counts["die"])
        self.assertEqual(counts["narrow"], 1)

    def test_repeated_circle_clipping_preserves_the_full_row_pattern(self):
        source = structure(container("root", bodies=[body("base", 0, 10, key="contacts")], children=[
            container("die", bodies=[body("silicon", 0, 20)]),
        ]))
        documents = []
        for exclusions in ((), ("die",)):
            registry = SchematicRegistry()
            registry.register("body", lambda context: [SchematicPart("Contacts", primitives=(
                Primitive(kind="circle", r=0.42, repeat_x=True),), occluded_by=exclusions)], key="contacts")
            documents.append(compose_schematic(source, registry))
        plain, masked = [[shape for shape in doc["shapes"] if shape["kind"] == "circle"] for doc in documents]
        self.assertGreater(len(masked), 3)
        self.assertEqual([(s["cx"], s["cy"], s["r"]) for s in plain],
                         [(s["cx"], s["cy"], s["r"]) for s in masked])
        self.assertTrue(all(s["clip"]["exclusions"] for s in masked))

    def test_invalid_horizontal_repetition_falls_back_per_node(self):
        for primitive in (Primitive(repeat_x=True), Primitive(kind="path", repeat_x=True),
                          Primitive(kind="circle", repeat_x=1), Primitive(kind="circle", r=0, repeat_x=True)):
            with self.subTest(primitive=primitive):
                registry = SchematicRegistry()
                registry.register("body", lambda context: [SchematicPart("Bad", primitives=(primitive,))])
                doc = compose_schematic(structure(container("root", bodies=[body("layer", 0, 5)])), registry)
                self.assertEqual(len(doc["warnings"]), 1)
                self.assertEqual([shape["kind"] for shape in doc["shapes"]], ["rect"])

    def test_referenced_parts_keep_physical_measurements_and_share_path_repetition(self):
        registry = SchematicRegistry()
        registry.register("container", component, key="test-die")
        def relation(context):
            if context.node["id"] != "upper":
                return []
            return [SchematicPart("Contact", source_id=source_id, display_bounds=bounds, repeat_group="pair",
                primitives=(Primitive(kind="path", points=((0, 0), (0.5, 1), (1, 0)), closed=True,
                                      repeat_x=True, r=1),)) for source_id, bounds in (
                    ("upper", Bounds(30, 0, 20, 50, 100, 30)),
                    ("lower", Bounds(30, 0, 0, 50, 100, 20)))]
        registry.register("body", relation)
        source = structure(container("root", bodies=[body("lower", 0, 20, material="Lower")], children=[
            container("die", key="test-die", bodies=[body("upper", 20, 10, material="Upper", x=30, width=20)])]))
        before = copy.deepcopy(source)
        document = compose_schematic(source, registry)
        upper = next(item for item in document["items"] if item["sourceIds"] == ["upper"])
        lower = next(item for item in document["items"] if item["sourceIds"] == ["lower"])
        self.assertEqual((lower["material"], lower["zMin"], lower["thickness"]), ("Lower", 0, 20))
        self.assertEqual((upper["material"], upper["zMin"], upper["thickness"]), ("Upper", 20, 10))
        rows = [[s for s in document["shapes"] if s["itemId"] == item["id"]] for item in (upper, lower)]
        self.assertEqual(len(rows[0]), len(rows[1]))
        self.assertGreater(len(rows[0]), 0)
        for a, b in zip(*rows):
            self.assertEqual([p[0] for p in a["points"]], [p[0] for p in b["points"]])
        self.assertEqual(document["schemaVersion"], 1)
        self.assertEqual(document["warnings"], [])
        self.assertEqual(source, before)

    def test_invalid_source_and_display_bounds_fall_back_without_losing_geometry(self):
        for options in ({"source_id": "missing"}, {"source_id": ""},
                        {"display_bounds": Bounds(0, 0, 0, 10, 10, math.inf)},
                        {"display_bounds": Bounds(10, 0, 0, 0, 10, 1)}, {"repeat_group": ""}):
            with self.subTest(options=options):
                registry = SchematicRegistry()
                registry.register("body", lambda context: [SchematicPart("Invalid", primitives=(Primitive(),), **options)])
                source = structure(container("root", bodies=[body("layer", 0, 5)]))
                before = copy.deepcopy(source)
                document = compose_schematic(source, registry)
                self.assertEqual(len(document["warnings"]), 1)
                self.assertEqual(document["items"][0]["sourceIds"], ["layer"])
                self.assertEqual(source, before)

    def test_relation_cannot_cross_an_ineligible_component(self):
        registry = SchematicRegistry()
        registry.register("container", lambda context: [SchematicPart("Component", component=ComponentHint(context.node["id"]))], key="die")
        registry.register("body", lambda context: [SchematicPart("Relation", layout="bridges", eligible_container_ids=("a", "c"))], key="relation")
        source = structure(container("root", bodies=[body("r", 0, 5, key="relation")], children=[
            container(name, key="die", bodies=[body(name+"-si", 0, 10)]) for name in ("a", "b", "c")
        ]))
        doc = compose_schematic(source, registry)
        self.assertFalse(any(s["itemId"] == doc["items"][0]["id"] for s in doc["shapes"]))

    def test_geometry_types_and_zero_or_removed_layers(self):
        self.assertEqual(geometry_bounds({"type": "CylinderGeometry", "center": [0, 0, 4], "bottom_radius": 5, "thk": 6}).z_max, 10)
        self.assertEqual(geometry_bounds({"type": "ConeGeometry", "center": [0, 0, 1], "bottom_radius": 5, "top_radius": 7, "thk": 2}).x_max, 7)
        self.assertEqual(geometry_bounds({"type": "PolygonGeometry", "polys": [[[0, 0, 3], [10, 0, 3], [0, 10, 3]]], "thk": 2}).z_min, 3)
        self.assertIsNone(geometry_bounds(None))
        self.assertIsNone(geometry_bounds({"type": "BoxGeometry", "thk": math.inf}))
        doc = compose_schematic(structure(container("root", bodies=[body("zero", 0, 0)])), SchematicRegistry())
        self.assertEqual(doc["totalThickness"], 0)
        self.assertEqual(doc["items"], [])
        self.assertEqual(doc["shapes"], [])

    def test_registry_specificity_and_duplicate_registration(self):
        generic, specific = lambda c: [], lambda c: []
        registry = SchematicRegistry()
        registry.register("body", generic)
        registry.register("body", specific, key="role")
        self.assertIs(registry.resolve("body", "role"), specific)
        self.assertIs(registry.resolve("body", "other"), generic)
        with self.assertRaises(ValueError):
            registry.register("body", generic)


if __name__ == "__main__":
    unittest.main()
