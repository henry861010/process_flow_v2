from __future__ import annotations

import copy
import unittest

from process_flow_schematic import Bounds, SchematicContext, SchematicRegistry
from process_flow_geometry_generators.die_schematic import present_schematic as present_die
from process_flow_geometry_generators.lsi_schematic import present_schematic as present_lsi
from process_flow_geometry_generators.wafer_dmy_schematic import present_schematic as present_dummy
from process_flow_geometry_generators.schematic_presenters import register_presenters


class GeneratorSchematicPresenterTests(unittest.TestCase):
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
        for key, presenter, count, placement in (
                ("wafer-dmy", present_dummy, 2, "edges"),
                ("lsi", present_lsi, 3, "center"),
                *((key, present_die, 1, "center") for key in ("soc", "dram", "soic", "hbm", "vrm", "cpo"))):
            with self.subTest(key=key):
                component = {"id": "component", "key": key, "children": [{"id": "internal-layer"}]}
                before = copy.deepcopy(component)
                context = SchematicContext(structure={"root": component}, node=component,
                    container=component, ancestors=(), kind="container",
                    bounds=Bounds(0, 0, 0, 20, 20, 100), unit="um")
                parts = presenter(context)
                self.assertEqual(len(parts), 1)
                self.assertEqual(parts[0].component.representative_count, count)
                self.assertEqual(parts[0].component.placement, placement)
                self.assertEqual(component, before)


if __name__ == "__main__":
    unittest.main()
