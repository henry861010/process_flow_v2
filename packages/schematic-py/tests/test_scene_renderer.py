import math
import unittest
from dataclasses import replace

from process_flow_schematic.contracts import Primitive
from process_flow_schematic.scene import (
    AnchorRef, AnchorSpec, LayoutRegion, PhysicalSample, ResolvedPhysicalData,
    SceneRelation, SceneState, SchematicObject,
)
from process_flow_schematic.scene_layout import make_scene_layout_plan
from process_flow_schematic.scene_renderer import SceneSymbolRegistry, render_scene


def physical(object_id, z_min, z_max, material="Si", density=None, source_id=None):
    return ResolvedPhysicalData(object_id, "selected", "um", (
        PhysicalSample(source_id or f"physical-{object_id}", z_min, z_max, material, density),
    ))


def nested_scene(nesting="arranged"):
    return SceneState(objects=(
        SchematicObject("assembly", "assembly", "package", "Package"),
        SchematicObject("cow", "component", "composite", "CoW", parent_id="assembly",
                        layout="member", region_id="mount", nesting=nesting),
        SchematicObject("wafer", "body", "slab", "Wafer", parent_id="cow",
                        layout="span", region_id="inside", color_role="silicon"),
        SchematicObject("die", "component", "generic", "Logic", parent_id="cow",
                        layout="member", region_id="inside"),
        SchematicObject("silicon", "body", "slab", "Silicon", parent_id="die",
                        layout="span", region_id="die-inside", color_role="silicon"),
        SchematicObject("ring", "body", "frame", "Ring", parent_id="assembly",
                        layout="boundary", region_id="mount", color_role="support"),
        SchematicObject("lid", "body", "cover", "Lid", parent_id="assembly",
                        layout="span", region_id="mount", color_role="conductor"),
        SchematicObject("fill", "body", "fill", "Fill", parent_id="cow",
                        layout="span", region_id="inside", color_role="underfill"),
    ), regions=(LayoutRegion("mount", "assembly"), LayoutRegion("inside", "cow", parent_region_id="mount"),
                LayoutRegion("die-inside", "die", parent_region_id="inside")),
        relations=(SceneRelation("ring-surrounds", "surrounds", "ring", region_id="mount"),
                   SceneRelation("lid-covers", "covers", "lid", region_id="mount"),
                   SceneRelation("fill-excludes-die", "fills", "fill", (AnchorRef("die"),), "inside")))


def stacked_scene():
    return SceneState(objects=(
        SchematicObject("assembly", "assembly", "generic", "Assembly"),
        SchematicObject("lower", "component", "generic", "Lower", parent_id="assembly",
                        layout="member", region_id="mount", anchors=(AnchorSpec("contact", side="upper"),)),
        SchematicObject("lower-body", "body", "slab", "Lower body", parent_id="lower",
                        layout="span", region_id="lower-inside"),
        SchematicObject("upper", "component", "generic", "Upper", parent_id="assembly",
                        layout="member", region_id="mount", anchors=(AnchorSpec("contact", side="lower"),)),
        SchematicObject("upper-body", "body", "slab", "Upper body", parent_id="upper",
                        layout="span", region_id="upper-inside"),
        SchematicObject("link", "feature", "generic", "Link", parent_id="assembly",
                        layout="span", region_id="mount"),
    ), regions=(LayoutRegion("mount", "assembly"), LayoutRegion("lower-inside", "lower"),
                LayoutRegion("upper-inside", "upper")), relations=(
        SceneRelation("connection", "connects", "link", (AnchorRef("lower", "contact"),
                                                          AnchorRef("upper", "contact"))),
    ))


class SceneRendererTests(unittest.TestCase):
    def test_z_tolerance_is_shared_by_rectangles_components_clips_and_connection_anchors(self):
        scene = stacked_scene()
        for offset in (0, -100, 1_000_000):
            boundary = offset + 10
            for gap in (math.ulp(boundary), -0.0009, 0.0009, 0.001, 0.0011):
                with self.subTest(offset=offset, gap=gap):
                    upper_min = boundary + gap
                    data = (physical("lower-body", offset, boundary),
                            physical("upper-body", upper_min, offset + 20),
                            physical("link", offset + 5, offset + 15, "Cu", 40))
                    doc = render_scene(scene, data)
                    items = {item["label"]: item for item in doc["items"]}
                    shapes = {shape["itemId"]: shape for shape in doc["shapes"]}
                    lower, upper = (shapes[items[label]["id"]] for label in ("Lower body", "Upper body"))
                    link = shapes[items["Link"]["id"]]
                    components = {component["label"]: component for component in doc["components"]}
                    upper_bottom = upper["y"] + upper["height"]
                    if gap < 0.001:
                        self.assertEqual(lower["y"], upper_bottom)
                    else:
                        self.assertGreater(lower["y"], upper_bottom)
                    self.assertEqual(link["points"][0][1], lower["y"])
                    self.assertEqual(link["points"][1][1], upper_bottom)
                    for label, shape in (("Lower", lower), ("Upper", upper)):
                        component = components[label]
                        for key in ("x", "y", "width", "height"):
                            self.assertEqual(component[key], shape[key])
                            self.assertEqual(shape["clip"][key], shape[key])
                            self.assertTrue(math.isfinite(shape[key]))
                        self.assertGreater(shape["height"], 0)
                    self.assertEqual((items["Upper body"]["zMin"], items["Upper body"]["zMax"],
                                      items["Upper body"]["thickness"]),
                                     (upper_min, offset + 20, offset + 20 - upper_min))
                    self.assertEqual(doc["warnings"], [])
                    self.assertEqual(doc["totalThickness"], 20)
                    self.assertEqual(doc, render_scene(scene, tuple(reversed(data))))

    def test_positive_layers_at_or_below_tolerance_remain_visible(self):
        scene = stacked_scene()
        for offset in (0, -100, 1_000_000):
            boundary = offset + 10
            for thickness in (0.001, 0.0009, 0.0001, 2 * math.ulp(boundary)):
                with self.subTest(offset=offset, thickness=thickness):
                    upper_max = boundary + thickness
                    data = (physical("lower-body", offset, boundary),
                            physical("upper-body", boundary, upper_max))
                    doc = render_scene(scene, data)
                    item = next(item for item in doc["items"] if item["label"] == "Upper body")
                    slab = next(shape for shape in doc["shapes"] if shape["itemId"] == item["id"])
                    component = next(component for component in doc["components"] if component["label"] == "Upper")
                    self.assertGreaterEqual(slab["height"], 10)
                    self.assertEqual(component["height"], slab["height"])
                    self.assertEqual(slab["clip"]["height"], slab["height"])
                    self.assertEqual((item["zMin"], item["zMax"], item["thickness"]),
                                     (boundary, upper_max, upper_max - boundary))
                    self.assertEqual(doc["totalThickness"], upper_max - offset)
                    self.assertEqual(doc["warnings"], [])
                    self.assertEqual(doc, render_scene(scene, tuple(reversed(data))))

    def test_cow_lid_ring_render_actual_document_and_shared_selection_identity(self):
        scene = nested_scene()
        data = (physical("wafer", 0, 100), physical("silicon", 110, 130),
                physical("ring", 100, 160, "Steel"), physical("lid", 160, 170, "Cu"),
                physical("fill", 100, 130, "UF"))
        plan = make_scene_layout_plan(scene)
        doc = render_scene(scene, data, layout_plan=plan)
        self.assertEqual(doc["warnings"], [])
        self.assertEqual(doc["schemaVersion"], 1)
        self.assertEqual(doc["totalThickness"], 170)
        items = {item["label"]: item for item in doc["items"]}
        ring = [shape for shape in doc["shapes"] if shape["itemId"] == items["Ring"]["id"]]
        lid = [shape for shape in doc["shapes"] if shape["itemId"] == items["Lid"]["id"]]
        fill = [shape for shape in doc["shapes"] if shape["itemId"] == items["Fill"]["id"]]
        die = next(component for component in doc["components"] if component["label"] == "Logic")
        self.assertEqual(len(ring), 2)
        self.assertEqual(items["Ring"]["sourceIds"], ["physical-ring"])
        self.assertEqual(len(lid), 1)
        self.assertEqual(ring[0]["x"], lid[0]["x"])
        self.assertEqual(ring[-1]["x"] + ring[-1]["width"], lid[0]["x"] + lid[0]["width"])
        self.assertEqual(ring[0]["y"], lid[0]["y"] + lid[0]["height"])
        self.assertEqual(items["Fill"]["thickness"], 30)
        self.assertEqual(len(fill), 2)
        for shape in fill:
            self.assertTrue(shape["x"] + shape["width"] <= die["x"]
                            or shape["x"] >= die["x"] + die["width"])
        self.assertTrue(all(math.isfinite(value) for value in doc["viewBox"]))

    def test_structural_children_share_parent_width_and_arranged_children_get_slots(self):
        def make(nesting):
            base = nested_scene(nesting)
            return replace(base, objects=(*base.objects,
                SchematicObject("memory", "component", "generic", "Memory", parent_id="cow",
                                layout="member", region_id="inside"),
                SchematicObject("memory-body", "body", "slab", "Memory silicon", parent_id="memory",
                                layout="span", region_id="memory-inside")),
                regions=(*base.regions, LayoutRegion("memory-inside", "memory", parent_region_id="inside")))
        data = (physical("wafer", 0, 100), physical("silicon", 100, 120), physical("memory-body", 120, 140))
        structural = render_scene(make("structural"), data)
        arranged = render_scene(make("arranged"), data)
        structural_components = {component["label"]: component for component in structural["components"]}
        arranged_components = {component["label"]: component for component in arranged["components"]}
        self.assertEqual(structural_components["Logic"]["x"], structural_components["Memory"]["x"])
        self.assertEqual(structural_components["Logic"]["width"], structural_components["CoW"]["width"])
        self.assertLess(arranged_components["Logic"]["x"], arranged_components["Memory"]["x"])
        self.assertLessEqual(arranged_components["Logic"]["x"] + arranged_components["Logic"]["width"],
                             arranged_components["Memory"]["x"])

    def test_future_objects_reserve_positions_without_rendering_or_measurements(self):
        full = nested_scene()
        plan = make_scene_layout_plan(full)
        data = (physical("wafer", 0, 100), physical("silicon", 110, 130))
        doc = render_scene(full, data, layout_plan=plan)
        self.assertEqual({item["label"] for item in doc["items"]}, {"Wafer", "Silicon"})
        self.assertEqual(doc["totalThickness"], 130)
        self.assertEqual(doc["viewBox"][2], plan.width)
        later = render_scene(full, (*data, physical("ring", 100, 160)), layout_plan=plan)
        before_x = {item["label"]: item["x"] for item in doc["components"]}
        self.assertEqual(before_x, {item["label"]: item["x"] for item in later["components"]})

    def test_local_symbol_and_density_preserve_measurements_and_source_identity(self):
        scene = SceneState(objects=(
            SchematicObject("assembly", "assembly", "generic", "Assembly"),
            SchematicObject("feature", "feature", "generic", "Pins", parent_id="assembly",
                            layout="distributed", region_id="mount", symbol="pin", color_role="conductor"),
        ), regions=(LayoutRegion("mount", "assembly"),))
        samples = {"a": PhysicalSample("a", 10, 10.01, "Cu", 15),
                   "b": PhysicalSample("b", 10, 10.01, "Cu", None)}
        registry = SceneSymbolRegistry()
        observed = []
        def pin(context):
            observed.append(context)
            return (Primitive(kind="circle", r=0.3),)
        registry.register("pin", pin)
        doc = render_scene(scene, samples=samples, bindings={"feature": ("a", "b")}, symbol_registry=registry)
        self.assertEqual(doc["warnings"], [])
        self.assertEqual(len(doc["shapes"]), 9)
        self.assertTrue(all(shape["kind"] == "circle" for shape in doc["shapes"]))
        self.assertEqual(doc["items"][0]["sourceIds"], ["a", "b"])
        self.assertEqual(doc["items"][0]["densityValues"], [15, None])
        self.assertAlmostEqual(doc["items"][0]["thickness"], 0.01)
        self.assertEqual(observed[0].samples, tuple(samples.values()))
        self.assertFalse(hasattr(observed[0], "x"))

    def test_connects_uses_declared_anchors_and_shared_z_transform(self):
        scene = SceneState(objects=(
            SchematicObject("assembly", "assembly", "generic", "Assembly"),
            SchematicObject("left", "component", "generic", "Left", parent_id="assembly",
                            layout="member", region_id="mount", anchors=(AnchorSpec("contact", side="upper"),)),
            SchematicObject("right", "component", "generic", "Right", parent_id="assembly",
                            layout="member", region_id="mount", anchors=(AnchorSpec("contact", side="upper"),)),
            SchematicObject("link", "feature", "generic", "Link", parent_id="assembly",
                            layout="span", region_id="mount", color_role="conductor"),
        ), regions=(LayoutRegion("mount", "assembly"),), relations=(
            SceneRelation("connection", "connects", "link", (AnchorRef("left", "contact"), AnchorRef("right", "contact"))),
        ))
        doc = render_scene(scene, (physical("left", 0, 10), physical("right", 0, 10), physical("link", 10, 11, "Cu", 40)))
        link = next(shape for shape in doc["shapes"] if shape["kind"] == "path")
        components = {component["label"]: component for component in doc["components"]}
        self.assertEqual(link["points"], [[component["x"] + component["width"] / 2, component["y"]]
                                           for component in (components["Left"], components["Right"])])
        self.assertEqual(doc["warnings"], [])

    def test_invalid_symbol_falls_back_and_mixed_snapshots_are_rejected(self):
        scene = SceneState(objects=(
            SchematicObject("assembly", "assembly", "generic", "Assembly"),
            SchematicObject("body", "body", "generic", "Layer", parent_id="assembly",
                            layout="span", region_id="mount", symbol="bad"),
        ), regions=(LayoutRegion("mount", "assembly"),))
        registry = SceneSymbolRegistry()
        registry.register("bad", lambda _: (Primitive(width=float("nan")),))
        doc = render_scene(scene, (physical("body", 0, 10),), symbol_registry=registry)
        self.assertEqual(len(doc["shapes"]), 1)
        self.assertEqual(doc["shapes"][0]["kind"], "rect")
        self.assertEqual(len(doc["warnings"]), 1)
        with self.assertRaisesRegex(ValueError, "one snapshot"):
            render_scene(scene, (physical("body", 0, 10),
                ResolvedPhysicalData("assembly", "future", "um", (PhysicalSample("future", 0, 20, "Si"),))))

    def test_binding_key_anchors_use_descendant_physical_data_and_transformed_sides_once(self):
        scene = SceneState(objects=(
            SchematicObject("assembly", "assembly", "generic", "Assembly"),
            SchematicObject("left", "component", "generic", "Left", parent_id="assembly",
                            source_ref="input:left", layout="member", region_id="mount",
                            anchors=(AnchorSpec("contact", source_ref="input:left/bond", side="upper"),)),
            SchematicObject("left-body", "body", "generic", "Left bond", parent_id="left",
                            source_ref="input:left/bond", layout="span", region_id="left-inside"),
            SchematicObject("right", "component", "generic", "Right", parent_id="assembly",
                            source_ref="input:right", layout="member", region_id="mount",
                            anchors=(AnchorSpec("contact", source_ref="input:right", side="lower"),)),
            SchematicObject("link", "feature", "generic", "Link", parent_id="assembly",
                            layout="span", region_id="mount"),
        ), regions=(LayoutRegion("mount", "assembly"), LayoutRegion("left-inside", "left")),
            relations=(SceneRelation("connect", "connects", "link",
                        (AnchorRef("left", "contact"), AnchorRef("right", "contact"))),), cursor_region_id="mount")
        # Descriptor execution is tested in process-step-py. The pure renderer
        # consumes its result: physical-face sides are already transformed.
        swapped = {"lower": "upper", "upper": "lower"}
        flipped = replace(scene, orientation=-1, objects=tuple(
            replace(obj, anchors=tuple(replace(anchor, side=swapped.get(anchor.side, anchor.side))
                                      for anchor in obj.anchors)) for obj in scene.objects))
        self.assertEqual(flipped.orientation, -1)
        self.assertEqual(flipped.object_map["left"].anchors[0].side, "lower")
        data = (physical("left", 0, 50, "", source_id="container-left"),
                physical("left-body", 40, 50, source_id="node-left-bond"),
                physical("right", 20, 30, source_id="node-right"), physical("link", 30, 40, "Cu", 30))
        doc = render_scene(flipped, data)
        self.assertEqual(doc["warnings"], [])
        line = next(shape for shape in doc["shapes"] if shape["kind"] == "path")
        items = {item["label"]: item for item in doc["items"]}
        left_body = next(shape for shape in doc["shapes"] if shape["itemId"] == items["Left bond"]["id"])
        right_body = next(shape for shape in doc["shapes"] if shape["itemId"] == items["Right"]["id"])
        self.assertEqual(line["points"][0][1], left_body["y"] + left_body["height"])
        self.assertEqual(line["points"][1][1], right_body["y"])

    def test_region_boundary_anchor_uses_referenced_region_extent(self):
        scene = SceneState(objects=(
            SchematicObject("assembly", "assembly", "generic", "Assembly"),
            SchematicObject("left", "component", "generic", "Left", parent_id="assembly",
                            layout="member", region_id="mount",
                            anchors=(AnchorSpec("edge", "region-boundary", "mount", "left"),)),
            SchematicObject("right", "component", "generic", "Right", parent_id="assembly",
                            layout="member", region_id="mount",
                            anchors=(AnchorSpec("edge", "region-boundary", "mount", "right"),)),
            SchematicObject("link", "feature", "generic", "Link", parent_id="assembly",
                            layout="span", region_id="mount"),
        ), regions=(LayoutRegion("mount", "assembly"),), relations=(
            SceneRelation("connect", "connects", "link", (AnchorRef("left", "edge"), AnchorRef("right", "edge"))),))
        plan = make_scene_layout_plan(scene)
        doc = render_scene(scene, (physical("left", 0, 10), physical("right", 0, 10),
                                  physical("link", 10, 11, "Cu", 30)), layout_plan=plan)
        self.assertEqual(doc["warnings"], [])
        path = next(shape for shape in doc["shapes"] if shape["kind"] == "path")
        region = plan.regions[0]
        self.assertEqual([point[0] for point in path["points"]], [region.x, region.x + region.width])

    def test_zero_density_features_are_not_drawn_or_selected(self):
        scene = SceneState(objects=(
            SchematicObject("assembly", "assembly", "generic", "Assembly"),
            SchematicObject("pins", "feature", "generic", "Pins", parent_id="assembly",
                            layout="distributed", region_id="mount"),
        ), regions=(LayoutRegion("mount", "assembly"),))
        doc = render_scene(scene, (physical("pins", 0, 10, "Cu", 0),))
        self.assertEqual(doc["shapes"], [])
        self.assertEqual(doc["items"], [])
        mixed = ResolvedPhysicalData("pins", "selected", "um", (
            PhysicalSample("absent", 0, 10, "Cu", 0), PhysicalSample("present", 0, 10, "Cu", 30)))
        visible = render_scene(scene, (mixed,))
        self.assertEqual(len(visible["shapes"]), 9)
        self.assertEqual(visible["items"][0]["sourceIds"], ["present"])
        self.assertEqual(visible["items"][0]["densityValues"], [30])
        symbolic = replace(scene, objects=(scene.objects[0],
            replace(scene.objects[1], layout="span", symbol="local-line")))
        registry = SceneSymbolRegistry()
        registry.register("local-line", lambda _: (Primitive(kind="path", points=((0, .5), (1, .5))),))
        for density in (0, None):
            with self.subTest(density=density):
                local = render_scene(symbolic, (physical("pins", 0, 10, "Cu", density),), symbol_registry=registry)
                self.assertEqual(len(local["shapes"]), 1)
                self.assertEqual(local["shapes"][0]["kind"], "path")
                self.assertEqual(local["items"][0]["densityValues"], [density])

    def test_repeated_structural_member_repeats_local_distribution_but_not_spans_twice(self):
        scene = SceneState(objects=(
            SchematicObject("assembly", "assembly", "generic", "Assembly"),
            SchematicObject("dummy", "component", "wafer-dmy", "Dummy", parent_id="assembly",
                            layout="member", region_id="mount", nesting="structural"),
            SchematicObject("body", "body", "generic", "Body", parent_id="dummy",
                            layout="span", region_id="inside"),
            SchematicObject("pins", "feature", "generic", "Pins", parent_id="dummy",
                            layout="distributed", region_id="inside"),
        ), regions=(LayoutRegion("mount", "assembly"), LayoutRegion("inside", "dummy")))
        plan = make_scene_layout_plan(scene)
        doc = render_scene(scene, (physical("body", 0, 10), physical("pins", 10, 12, "Cu", 40)), layout_plan=plan)
        self.assertEqual(doc["warnings"], [])
        item_ids = {item["label"]: item["id"] for item in doc["items"]}
        bodies = [shape for shape in doc["shapes"] if shape["itemId"] == item_ids["Body"]]
        pins = [shape for shape in doc["shapes"] if shape["itemId"] == item_ids["Pins"]]
        self.assertEqual(len(bodies), 2)
        self.assertEqual(len(pins), 18)
        self.assertEqual([(shape["x"], shape["width"]) for shape in bodies],
                         [(slot.x, slot.width) for slot in plan.slots])
        positions = []
        for slot in plan.slots:
            local = sorted(round(shape["x"] - slot.x, 8) for shape in pins
                           if slot.x <= shape["x"] and shape["x"] + shape["width"] <= slot.x + slot.width)
            self.assertEqual(len(local), 9)
            positions.append(local)
        self.assertEqual(*positions)


if __name__ == "__main__":
    unittest.main()
