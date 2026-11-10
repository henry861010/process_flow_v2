from __future__ import annotations

import copy
import unittest

from process_flow_schematic import Bounds, PhysicalSample, SchematicContext, SchematicRegistry, compose_schematic
from process_flow_schematic.source import describe_source_scene
from process_flow_schematic.scene_renderer import render_scene
from process_flow_geometry_generators.die_schematic import present_schematic as present_die
from process_flow_geometry_generators.lsi_schematic import present_schematic as present_lsi
from process_flow_geometry_generators.wafer_dmy_schematic import present_schematic as present_dummy
from process_flow_geometry_generators.schematic_presenters import register_presenters


class GeneratorSchematicPresenterTests(unittest.TestCase):
    def test_primary_diagram_labels_survive_composition_and_scene_adaptation(self):
        def body(node_id, key, material, z, thickness):
            return {"id": node_id, "key": key, "material": material, "geometry": {
                "type": "BoxGeometry", "bottom_left": [0, 0, z], "top_right": [100, 100, z], "thk": thickness}}

        source = {"schemaVersion": "1.0.0", "unitSystem": "um", "root": {
            "id": "root", "key": "carrier", "bodies": [body("carrier", "carrier", "Glass", 0, 100)],
            "children": [{"id": key, "key": key, "bodies": [body(f"{key}-si", "silicon", "Si", 100, 50)]}
                         for key in ("lsi", "soc", "hbm", "vrm", "wafer-dmy", "dram")],
        }}
        original = copy.deepcopy(source)
        registry = SchematicRegistry()
        register_presenters(registry)
        document = compose_schematic(source, registry)
        self.assertEqual([component["diagramLabel"] for component in document["components"]
                          if "diagramLabel" in component], ["DMY", "LSI", "SoC", "HBM", "VRM", "DMY"])
        carrier = next(item for item in document["items"] if item["sourceIds"] == ["carrier"])
        self.assertEqual(carrier["diagramLabel"], "Carrier")
        self.assertEqual(carrier["label"], "Glass")
        scene, bindings = describe_source_scene(source, registry, source_id="input")
        samples = {"carrier": PhysicalSample("carrier", 0, 100, "Glass"),
                   **{f"{key}-si": PhysicalSample(f"{key}-si", 100, 150, "Si")
                      for key in ("lsi", "soc", "hbm", "vrm", "wafer-dmy", "dram")}}
        adapted = render_scene(scene, samples=samples, bindings={bindings[key]: (key,) for key in samples})
        self.assertEqual({component.get("diagramLabel") for component in adapted["components"]},
                         {None, "LSI", "SoC", "HBM", "VRM", "DMY"})
        self.assertEqual(next(item for item in adapted["items"] if item["sourceIds"] == ["carrier"])["diagramLabel"], "Carrier")
        self.assertEqual(source, original)

    def test_support_presenters_explicitly_decline_component_hints(self):
        registry = SchematicRegistry()
        register_presenters(registry)
        for key in ("carrier", "carrier.panel", "carrier.wafer", "frame"):
            with self.subTest(key=key):
                presenter = registry.resolve("container", key)
                self.assertIsNotNone(presenter)
                component = {"id": "support", "key": key}
                context = SchematicContext(structure={"root": component}, node=component,
                    container=component, ancestors=(), kind="container",
                    bounds=Bounds(0, 0, 0, 20, 20, 100), unit="um")
                self.assertEqual(presenter(context), [])

    def test_representative_hints_keep_component_subtree_unchanged(self):
        for key, presenter in (
                ("wafer-dmy", present_dummy),
                ("lsi", present_lsi),
                *((key, present_die) for key in ("soc", "dram", "soic", "hbm", "vrm", "cpo"))):
            with self.subTest(key=key):
                component = {"id": "component", "key": key, "children": [{"id": "internal-layer"}]}
                before = copy.deepcopy(component)
                context = SchematicContext(structure={"root": component}, node=component,
                    container=component, ancestors=(), kind="container",
                    bounds=Bounds(0, 0, 0, 20, 20, 100), unit="um")
                parts = presenter(context)
                self.assertEqual(len(parts), 1)
                self.assertEqual(parts[0].component.role, key)
                # No generator asks for a global slot count or edge position.
                self.assertEqual(parts[0].component.representative_count, 1)
                self.assertEqual(parts[0].component.placement, "center")
                self.assertEqual(component, before)


if __name__ == "__main__":
    unittest.main()
