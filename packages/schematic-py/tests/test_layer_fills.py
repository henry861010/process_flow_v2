"""Layer fills use semantic cohorts and display slots, never physical contact."""
import unittest
from process_flow_schematic import ComponentHint, SchematicPart, SchematicRegistry, compose_schematic
from process_flow_schematic.contracts import SchematicLayerFill, SchematicLayoutPlan, SchematicSlot


class Bindings(dict):
    pass


def document(current=("a", "b"), slots=None, eligible=("a", "b")):
    source = {"unitSystem": "um", "root": {"id": "root", "children": [
        {"id": name, "key": "die", "bodies": [{"id": name+"-body", "material": "Si", "geometry": {
            "type": "BoxGeometry", "bottom_left": [0, 0, 100], "top_right": [10, 10, 100], "thk": 20,
        }}]} for name in current]}}
    registry = SchematicRegistry()
    registry.register("container", lambda c: [SchematicPart(c.node["id"], component=ComponentHint(c.node["id"]))], key="die")
    if slots is None:
        slots = tuple(SchematicSlot(name, name, 36+356*i, 320, "upper") for i,name in enumerate(current))
    binding = Bindings({key:key for key in current})
    binding.layer_fills = (SchematicLayerFill("fill", "uf", "upper", "UF", "UF", "#123456", 100, 106, eligible),)
    return compose_schematic(source, registry, layout_plan=SchematicLayoutPlan(slots, 1800), component_bindings=binding)


def fills(doc):
    return [shape for shape in doc["shapes"] if shape["fill"] == "#123456"]


class LayerFillTests(unittest.TestCase):
    def test_no_physical_fill_is_needed_and_measurement_is_process_owned(self):
        doc=document()
        self.assertEqual(len(fills(doc)),1)
        item=next(item for item in doc["items"] if item.get("measurementSource")=="process")
        self.assertEqual(item["sourceIds"],[])
        self.assertEqual(item["sourceStepRefId"],"uf")
        self.assertEqual(item["thickness"],6)
        self.assertEqual(doc["totalThickness"],20)

    def test_empty_reservations_are_skipped(self):
        slots=tuple(SchematicSlot(key,key,36+356*i,320,"upper") for i,key in enumerate(("a","empty","b")))
        self.assertEqual(len(fills(document(slots=slots))),1)

    def test_excluded_occupied_member_blocks_a_bridge(self):
        self.assertEqual(fills(document(("a","dummy","b"))),[])

    def test_different_regions_do_not_connect(self):
        slots=(SchematicSlot("a","a",36,320,"upper"), SchematicSlot("b","b",392,320,"lower"))
        self.assertEqual(fills(document(slots=slots)),[])

    def test_single_member_does_not_draw_a_climb(self):
        self.assertEqual(fills(document(("a",))),[])

    def test_local_layout_fallback_retains_the_process_fill(self):
        doc = document(slots=(SchematicSlot("a", "a", 36, 320, "upper"),))
        self.assertEqual(len(fills(doc)), 1)
        self.assertTrue(any("local layout" in warning for warning in doc["warnings"]))
