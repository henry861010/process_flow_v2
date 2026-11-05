import copy
import itertools
import math
import unittest

from process_flow_schematic import Bounds, Primitive, SchematicPart, SchematicRegistry, compose_schematic
from process_flow_schematic.composer import _ZDisplay


def bounds(lower, upper):
    return Bounds(0, 0, lower, 100, 100, upper)


class ZDisplayTests(unittest.TestCase):
    def test_near_boundaries_do_not_chain_beyond_the_tolerance(self):
        layers = (bounds(-2, 0), bounds(0.0006, 2), bounds(0.0012, 3))
        expected = None
        for ordered in itertools.permutations(layers):
            display = _ZDisplay(ordered)
            positions = [display.y(value) for value in (0, 0.0006, 0.0012, 2, 3)]
            self.assertEqual(positions[0], positions[1])
            self.assertGreater(positions[1], positions[2])
            if expected is None:
                expected = positions
            self.assertEqual(positions, expected)

    def test_adjacent_computed_thin_layers_survive_other_nearby_boundaries(self):
        display = _ZDisplay(
            (bounds(0, 0.0004), bounds(0.0004, 0.0008)),
            display_bounds=(bounds(0.0002, 0.0006),),
        )
        for lower, upper in ((0, 0.0004), (0.0004, 0.0008)):
            self.assertGreaterEqual(display.y(lower) - display.y(upper), 10)

    def test_interpolation_is_continuous_and_monotone_through_merged_spans(self):
        display = _ZDisplay((bounds(0, 1), bounds(2, 3)),
                            display_bounds=(bounds(0.0009, 3.0009),))
        samples = [-1, -0.0001, 0, 0.0002, 0.0008, 0.0009, 0.001,
                   1, 1.5, 2, 3, 3.0002, 3.0008, 3.0009, 3.001, 4]
        positions = [display.y(value) for value in samples]
        self.assertTrue(all(math.isfinite(value) for value in positions))
        self.assertTrue(all(left >= right for left, right in zip(positions, positions[1:])))
        self.assertEqual(display.y(0), display.y(0.0005))
        self.assertEqual(display.y(0), display.y(0.0009))
        self.assertEqual(display.y(3), display.y(3.0005))
        self.assertEqual(display.y(3), display.y(3.0009))
        for edge in (0, 0.0009, 3, 3.0009):
            self.assertAlmostEqual(display.y(math.nextafter(edge, -math.inf)), display.y(edge))
            self.assertAlmostEqual(display.y(math.nextafter(edge, math.inf)), display.y(edge))

    def test_empty_or_coincident_boundaries_have_a_finite_constant_mapping(self):
        for physical, extra in (((), ()), ((bounds(1, 1),), ()),
                                ((), (bounds(0, 0.0009),))):
            display = _ZDisplay(physical, display_bounds=extra)
            self.assertEqual(display.height, 0)
            self.assertEqual([display.y(value) for value in (-10, 0, 10)], [48, 48, 48])

    def test_presenter_bounds_share_the_mapping_and_fit_inside_the_viewbox(self):
        source = {"schemaVersion": "1.0.0", "unitSystem": "um", "root": {
            "id": "root", "bodies": [{
                "id": "body", "material": "Si", "geometry": {
                    "type": "BoxGeometry", "bottom_left": [0, 0, 0],
                    "top_right": [100, 100, 0], "thk": 1,
                },
            }],
        }}
        before = copy.deepcopy(source)
        registry = SchematicRegistry()
        registry.register("body", lambda _: [
            SchematicPart("Body", primitives=(Primitive(),)),
            SchematicPart("Near contact", primitives=(Primitive(),), display_bounds=bounds(1.0009, 2)),
            SchematicPart("Extended", primitives=(Primitive(),), display_bounds=bounds(-2, 4)),
        ])
        document = compose_schematic(source, registry)
        shapes = {item["label"]: next(shape for shape in document["shapes"] if shape["itemId"] == item["id"])
                  for item in document["items"]}
        self.assertEqual(shapes["Body"]["y"], shapes["Near contact"]["y"] + shapes["Near contact"]["height"])
        for shape in shapes.values():
            self.assertGreaterEqual(shape["y"], document["viewBox"][1])
            self.assertGreater(shape["height"], 0)
            self.assertLessEqual(shape["y"] + shape["height"], document["viewBox"][3])
            self.assertEqual({key: shape[key] for key in ("x", "y", "width", "height")},
                             {key: shape["clip"][key] for key in ("x", "y", "width", "height")})
        self.assertEqual(document["totalThickness"], 1)
        self.assertEqual(document["schemaVersion"], 1)
        self.assertEqual(document["warnings"], [])
        self.assertEqual(source, before)
        self.assertTrue(all((item["zMin"], item["zMax"], item["thickness"]) == (0, 1, 1)
                            for item in document["items"]))
