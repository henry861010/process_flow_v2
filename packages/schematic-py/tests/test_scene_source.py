import copy
import unittest

from process_flow_schematic.contracts import Primitive, SchematicPart, SchematicRegistry
from process_flow_schematic.geometry import material_color
from process_flow_schematic.scene import PhysicalSample
from process_flow_schematic.scene_renderer import SceneSymbolRegistry, render_scene
from process_flow_schematic.source import describe_source_scene


def feature(node_id, *, key=None, material="Cu", density=40):
    result = {"id": node_id, "material": material, "density": density,
              "geometry": {"type": "BoxGeometry", "bottom_left": [0, 0, 0],
                           "top_right": [10, 10, 0], "thk": 10}}
    if key is not None:
        result["key"] = key
    return result


def structure(*, bodies=(), vias=(), circuits=()):
    return {"schemaVersion": "1.0.0", "unitSystem": "um", "root": {
        "id": "root", "bodies": list(bodies), "vias": list(vias),
        "circuits": list(circuits), "bumps": [], "children": [],
    }}


class SceneSourceTests(unittest.TestCase):
    def test_presenter_appearance_is_explicit_and_generic_color_comes_from_material(self):
        supplied = structure(bodies=(feature("custom", key="custom", material="Custom polymer"),
                                     feature("generic", material="Si")))
        original = copy.deepcopy(supplied)
        registry = SchematicRegistry()
        registry.register("body", lambda _: [SchematicPart("Custom", fill="#123abc", primitives=(Primitive(),))], "custom")
        scene, bindings = describe_source_scene(supplied, registry, source_id="input-a")
        custom = scene.object_map[bindings["custom"]]
        generic = scene.object_map[bindings["generic"]]
        self.assertEqual(custom.color_role, "generic")
        self.assertEqual(custom.fill_override, "#123abc")
        self.assertEqual(generic.fill_override, material_color("Si"))
        symbols = SceneSymbolRegistry()
        symbols.register("body", lambda _: (Primitive(),))
        samples = {"custom": PhysicalSample("custom", 0, 10, "Custom polymer"),
                   "generic": PhysicalSample("generic", 0, 10, "Si")}
        doc = render_scene(scene, samples=samples,
                           bindings={bindings[key]: (key,) for key in samples}, symbol_registry=symbols)
        item_sources = {item["id"]: item["sourceIds"][0] for item in doc["items"]}
        fills = {item_sources[shape["itemId"]]: shape["fill"] for shape in doc["shapes"]}
        self.assertEqual(fills, {"custom": "#123abc", "generic": material_color("Si")})
        self.assertEqual(supplied, original)
        self.assertEqual(doc["warnings"], [])

    def test_zero_density_local_symbol_survives_while_distributed_symbol_is_hidden(self):
        supplied = structure(vias=(feature("local", key="local", density=0),
                                   feature("distributed", key="pillar", density=0),
                                   feature("generic-zero", density=0)))
        registry = SchematicRegistry()
        registry.register("via", lambda _: [SchematicPart("Local trace", fill="#ffaa00",
                          primitives=(Primitive(kind="path", points=((0, .5), (1, .5))),))], "local")
        registry.register("via", lambda _: [SchematicPart("Pillars", fill="#ffaa00",
                          layout="distributed", primitives=(Primitive(),))], "pillar")
        scene, bindings = describe_source_scene(supplied, registry, source_id="input-a")
        self.assertEqual(scene.object_map[bindings["local"]].layout, "span")
        self.assertEqual(scene.object_map[bindings["distributed"]].layout, "distributed")
        self.assertNotIn(bindings["generic-zero"], scene.object_map)
        symbols = SceneSymbolRegistry()
        symbols.register("via", lambda _: (Primitive(kind="path", points=((0, .5), (1, .5))),))
        samples = {key: PhysicalSample(key, 0, 10, "Cu", 0) for key in ("local", "distributed", "generic-zero")}
        doc = render_scene(scene, samples=samples,
                           bindings={bindings[key]: (key,) for key in samples}, symbol_registry=symbols)
        self.assertEqual(doc["warnings"], [])
        self.assertEqual(len(doc["shapes"]), 1)
        self.assertEqual(doc["shapes"][0]["kind"], "path")
        self.assertEqual(doc["items"][0]["sourceIds"], ["local"])
        self.assertEqual(doc["items"][0]["densityValues"], [0])

    def test_missing_density_does_not_hide_explicit_local_presenter(self):
        local = feature("local", key="local")
        local.pop("density")
        registry = SchematicRegistry()
        registry.register("via", lambda _: [SchematicPart("Local", primitives=(Primitive(),))], "local")
        scene, bindings = describe_source_scene(structure(vias=(local,)), registry, source_id="input-a")
        self.assertIn(bindings["local"], scene.object_map)
        symbols = SceneSymbolRegistry()
        symbols.register("via", lambda _: (Primitive(),))
        doc = render_scene(scene, samples={"local": PhysicalSample("local", 0, 10, "Cu")},
                           bindings={bindings["local"]: ("local",)}, symbol_registry=symbols)
        self.assertEqual(len(doc["shapes"]), 1)
        self.assertEqual(doc["items"][0]["densityValues"], [None])


if __name__ == "__main__":
    unittest.main()
