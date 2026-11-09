"""Underfill regressions through real flow execution and the preview API."""
from __future__ import annotations

import copy
from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from process_flow_api.main import create_app
from process_flow_kernel import normalize_geometry_structure
from process_flow_schematic import UNDERFILL_FILL
from process_flow_schematic.geometry import geometry_bounds
from test_schematic_planning import add_step, context, execute_document, inp, out, placement


def _box(z, thickness):
    return {"type": "BoxGeometry", "bottom_left": [0, 0, z],
            "top_right": [100, 100, z], "thk": thickness}


def _die(identifier, role, *, bumped=False):
    root = {"key": role, "bodies": [{"material": "Si", "geometry": _box(2 if bumped else 0, 10)}]}
    if bumped:
        root["bumps"] = [{"material": "SnAg", "density": 40, "direction": "-z", "koz": 0,
                          "stage": "joined", "geometry": _box(0, 2)}]
    return {"id": identifier, "structure": normalize_geometry_structure(root)}


def _flow(*, physical_gap=4, bumped=False, soc_positions=(0,)):
    ctx = context(source=_die("die", "soc", bumped=bumped),
                  placements=[placement(x) for x in soc_positions])
    ctx.referenced_catalog_geometries["hbm"] = _die("hbm", "hbm", bumped=bumped)
    ctx.definition["flowInputs"].append({"flowInputId": "hbm", "name": "HBM",
                                         "dataType": "geometry", "required": True})
    ctx.configuration["inputBindings"]["hbm"] = {"kind": "catalog", "geometryId": "hbm"}
    add_step(ctx, "hbm-place", "pnp/pnp", out("first"),
             {"placements": [placement(soc_positions[-1] + 10 + physical_gap)]}, inp("hbm"))
    add_step(ctx, "uf", "uf/under_fill", out("hbm-place"), {"material": "UF", "thk": 6, "gap": 5})
    return ctx


def _layered_flow(*, remove_middle=False):
    ctx = context(source=_die("die", "lsi"))
    sources = [("soc", "soc"), ("hbm", "hbm")]
    if remove_middle:
        sources.append(("reserved", "lsi"))
    for identifier, role in sources:
        ctx.referenced_catalog_geometries[identifier] = _die(identifier, role)
        ctx.definition["flowInputs"].append({"flowInputId": identifier, "name": identifier,
                                             "dataType": "geometry", "required": True})
        ctx.configuration["inputBindings"][identifier] = {"kind": "catalog", "geometryId": identifier}
    add_step(ctx, "rdl", "layer/rdl", out("first"), {"layers": {"items": [{
        "itemId": "layer", "index": 0,
        "values": {"Dielectric": "PI", "Conductivity": "Cu", "thk": 12, "density": 0},
    }]}})
    add_step(ctx, "soc-place", "pnp/pnp", out("rdl"), {"placements": [placement()]}, inp("soc"))
    previous = "soc-place"
    if remove_middle:
        add_step(ctx, "reserved-place", "pnp/pnp", out(previous),
                 {"placements": [placement(60)]}, inp("reserved"))
        previous = "reserved-place"
    add_step(ctx, "hbm-place", "pnp/pnp", out(previous), {"placements": [placement(14)]}, inp("hbm"))
    previous = "hbm-place"
    if remove_middle:
        add_step(ctx, "cut", "saw/saw", out(previous),
                 {"bottomLeftX": 0, "bottomLeftY": 0, "topRightX": 24, "topRightY": 10})
        previous = "cut"
    add_step(ctx, "uf", "uf/under_fill", out(previous), {"material": "UF", "thk": 6, "gap": 5})
    return ctx


def _target(ctx, step):
    return replace(ctx, target={"type": "stepOutput", "stepRefId": step, "outputPortId": "result_geometry"})


def _uf_bodies(root):
    result = {node["id"]: node for node in root.get("bodies", ()) if node.get("key") == "uf"}
    for child in root.get("children", ()):
        result.update(_uf_bodies(child))
    return result


def _uf_items(document):
    return [item for item in document["items"] if item["label"].startswith("UF · ")]


def _uf_shapes(document):
    return [shape for shape in document["shapes"] if shape["fill"] == UNDERFILL_FILL]


def _slots(document):
    return [(item["id"], item["x"], item["width"]) for item in document["components"]]


class SchematicUnderfillTests(unittest.TestCase):
    def assert_actual_uf_measurements(self, document, structure):
        bodies = _uf_bodies(structure["root"])
        items = _uf_items(document)
        self.assertEqual({source for item in items for source in item["sourceIds"]}, set(bodies))
        for item in items:
            for source in item["sourceIds"]:
                bounds = geometry_bounds(bodies[source]["geometry"])
                self.assertEqual((item["zMin"], item["zMax"], item["thickness"]),
                                 (bounds.z_min, bounds.z_max, bounds.thickness))

    def test_mixed_dies_without_bumps_show_actual_gap_without_moving_slots(self):
        ctx = _flow()
        before_context = copy.deepcopy(ctx)
        _, before, _, _ = execute_document(_target(ctx, "hbm-place"))
        _, filled, snapshots, _ = execute_document(_target(ctx, "uf"))

        self.assertEqual(ctx, before_context)
        self.assertEqual(filled["warnings"], [])
        self.assertEqual(filled["schemaVersion"], 1)
        self.assertEqual(_slots(before), _slots(filled))
        self.assertEqual(before["viewBox"], filled["viewBox"])
        self.assertEqual(_uf_shapes(before), [])
        self.assertEqual(len(_uf_items(filled)), 1)
        self.assert_actual_uf_measurements(filled, snapshots[-1].geometry_structure)
        self.assertEqual((_uf_items(filled)[0]["zMin"], _uf_items(filled)[0]["zMax"]), (10, 16))
        left, right = sorted(filled["components"], key=lambda item: item["x"])
        bridge, = _uf_shapes(filled)
        self.assertEqual(bridge["kind"], "rect")
        self.assertEqual(bridge["x"], left["x"] + left["width"])
        self.assertEqual(bridge["x"] + bridge["width"], right["x"])
        json.dumps(filled, allow_nan=False)

    def test_unkeyed_imported_wrappers_resolve_their_selected_die_endpoints(self):
        ctx = _flow()
        for identifier, role in (("die", "soc"), ("hbm", "hbm")):
            child = _die(identifier, role)["structure"]["root"]
            ctx.referenced_catalog_geometries[identifier] = {
                "id": identifier, "structure": normalize_geometry_structure({"children": [child]}),
            }
        _, before, _, _ = execute_document(_target(ctx, "hbm-place"))
        _, filled, snapshots, _ = execute_document(_target(ctx, "uf"))

        self.assertEqual(filled["warnings"], [])
        self.assertEqual(_slots(before), _slots(filled))
        self.assertEqual({component["label"] for component in filled["components"]}, {"SoC", "HBM"})
        wrappers = snapshots[-1].geometry_structure["root"]["children"][:2]
        selected_ids = {source for component in filled["components"] for source in component["sourceIds"]}
        self.assertTrue(all(wrapper["id"] not in selected_ids for wrapper in wrappers))
        self.assertEqual({wrapper["children"][0]["id"] for wrapper in wrappers}, selected_ids)
        self.assert_actual_uf_measurements(filled, snapshots[-1].geometry_structure)
        left, right = sorted(filled["components"], key=lambda item: item["x"])
        bridge, = _uf_shapes(filled)
        self.assertEqual(bridge["x"], left["x"] + left["width"])
        self.assertEqual(bridge["x"] + bridge["width"], right["x"])
        self.assertFalse(any("retained fill connects" in note for note in filled["notes"]))

    def test_lower_region_slot_does_not_block_adjacent_upper_underfill(self):
        ctx = _layered_flow()
        _, before, _, _ = execute_document(_target(ctx, "hbm-place"))
        planning, filled, snapshots, _ = execute_document(_target(ctx, "uf"))
        self.assertEqual(filled["warnings"], [])
        self.assertEqual(_slots(before), _slots(filled))
        self.assertEqual(before["viewBox"][2], filled["viewBox"][2])
        components = {component["label"]: component for component in filled["components"]}
        soc, lower, hbm = (components[role] for role in ("SoC", "LSI", "HBM"))
        self.assertLess(soc["x"], lower["x"])
        self.assertLess(lower["x"], hbm["x"])
        slots = {slot.id: slot for slot in planning.layout_for(_target(ctx, "uf").target).slots}
        self.assertEqual(slots[soc["id"]].region_id, slots[hbm["id"]].region_id)
        self.assertNotEqual(slots[lower["id"]].region_id, slots[soc["id"]].region_id)
        self.assert_actual_uf_measurements(filled, snapshots[-1].geometry_structure)
        self.assertEqual((_uf_items(filled)[0]["zMin"], _uf_items(filled)[0]["zMax"]), (22, 28))
        bridge, = _uf_shapes(filled)
        self.assertEqual(bridge["x"], soc["x"] + soc["width"])
        self.assertEqual(bridge["x"] + bridge["width"], hbm["x"])
        self.assertFalse(any("retained fill connects" in note for note in filled["notes"]))

    def test_empty_reserved_slot_does_not_block_layer_fill(self):
        ctx = _layered_flow(remove_middle=True)
        _, before, _, _ = execute_document(_target(ctx, "cut"))
        planning, filled, snapshots, _ = execute_document(_target(ctx, "uf"))
        self.assertEqual(filled["warnings"], [])
        self.assertEqual(_slots(before), _slots(filled))
        components = {component["label"]: component for component in filled["components"]}
        slots = {slot.id: slot for slot in planning.layout_for(_target(ctx, "uf").target).slots}
        upper_region = slots[components["SoC"]["id"]].region_id
        upper_slots = sorted((slot for slot in slots.values() if slot.region_id == upper_region),
                             key=lambda slot: slot.x)
        self.assertEqual(len(upper_slots), 3)
        self.assertEqual(upper_slots[0].id, components["SoC"]["id"])
        self.assertEqual(upper_slots[-1].id, components["HBM"]["id"])
        self.assertNotIn(upper_slots[1].id, {component["id"] for component in filled["components"]})
        self.assert_actual_uf_measurements(filled, snapshots[-1].geometry_structure)
        self.assertEqual(len(_uf_items(filled)), 1)
        self.assertEqual(_uf_items(filled)[0]["thickness"], 6)
        self.assertEqual(len(_uf_shapes(filled)), 1)
        self.assertFalse(any("retained fill connects" in note for note in filled["notes"]))

    def test_layer_fill_ignores_physical_gap_and_retains_cavity_measurements(self):
        for physical_gap, bumped in ((4, False), (5, False), (6, False), (1000, False), (6, True)):
            with self.subTest(physical_gap=physical_gap, bumped=bumped):
                _, document, snapshots, _ = execute_document(_target(
                    _flow(physical_gap=physical_gap, bumped=bumped), "uf"))
                self.assertEqual(document["warnings"], [])
                process_items = [item for item in _uf_items(document) if item.get("measurementSource") == "process"]
                self.assertEqual(len(process_items), 1)
                item = process_items[0]
                self.assertEqual((item["zMin"], item["zMax"], item["thickness"]), (10, 16, 6))
                self.assertEqual(item["sourceStepRefId"], "uf")
                bodies = _uf_bodies(snapshots[-1].geometry_structure["root"])
                self.assertTrue(set(item["sourceIds"]) <= bodies.keys())
                if physical_gap > 5 and not bumped:
                    self.assertEqual(bodies, {})
                    self.assertEqual(item["sourceIds"], [])
                if bumped:
                    cavities = [item for item in _uf_items(document) if item.get("measurementSource") != "process"]
                    self.assertEqual(len(cavities), 2)
                    self.assertTrue(all(item["thickness"] == 2 for item in cavities))
                self.assertEqual(sum(shape["itemId"] == item["id"] for shape in _uf_shapes(document)), 1)

    def test_gap_touching_non_first_cohort_instance_still_connects_its_slot(self):
        _, document, snapshots, _ = execute_document(_target(_flow(soc_positions=(0, 30)), "uf"))
        self.assertEqual(document["warnings"], [])
        self.assertEqual(len(document["components"]), 2)
        soc = next(item for item in document["components"] if item["label"] == "SoC")
        self.assertEqual(len(soc["sourceIds"]), 2)
        root = snapshots[-1].geometry_structure["root"]
        soc_children = [child for child in root["children"] if child.get("key") == "soc"]
        self.assertEqual(soc["sourceIds"][0], soc_children[0]["id"])
        self.assertEqual(soc_children[1]["bodies"][0]["geometry"]["bottom_left"][0], 30)
        self.assertEqual(len(_uf_shapes(document)), 1)
        self.assert_actual_uf_measurements(document, snapshots[-1].geometry_structure)

    def test_grind_updates_retained_gap_measurement_and_removes_consumed_gap(self):
        ctx = _flow()
        add_step(ctx, "grind", "grinding/grinding", out("uf"), {"thk": 6})
        add_step(ctx, "remove", "grinding/grinding", out("grind"), {"thk": 4})
        _, filled, _, _ = execute_document(_target(ctx, "uf"))
        _, ground, snapshots, _ = execute_document(_target(ctx, "grind"))
        self.assertEqual(ground["warnings"], [])
        self.assertEqual(_slots(filled), _slots(ground))
        self.assert_actual_uf_measurements(ground, snapshots[-1].geometry_structure)
        self.assertEqual(len(_uf_shapes(ground)), 1)
        self.assertEqual((_uf_items(ground)[0]["zMin"], _uf_items(ground)[0]["zMax"],
                          _uf_items(ground)[0]["thickness"]), (10, 14, 4))
        self.assertLess(_uf_shapes(ground)[0]["height"], _uf_shapes(filled)[0]["height"])

        _, removed, snapshots, _ = execute_document(_target(ctx, "remove"))
        self.assertEqual(removed["warnings"], [])
        self.assertEqual(_uf_bodies(snapshots[-1].geometry_structure["root"]), {})
        self.assertEqual(_uf_items(removed), [])
        self.assertEqual(_uf_shapes(removed), [])

    def test_synthetic_fill_is_trimmed_removed_and_mirrored_without_a_gap_body(self):
        ctx = _flow(physical_gap=1000)
        add_step(ctx, "flip", "flip/flip", out("uf"), {})
        add_step(ctx, "flip-back", "flip/flip", out("flip"), {})
        add_step(ctx, "grind", "grinding/grinding", out("uf"), {"thk": 6})
        add_step(ctx, "remove", "grinding/grinding", out("grind"), {"thk": 4})
        for step, interval in (("uf", (10, 16)), ("flip", (4, 10)),
                               ("flip-back", (10, 16)), ("grind", (10, 14))):
            with self.subTest(step=step):
                _, doc, snapshots, _ = execute_document(_target(ctx, step))
                self.assertEqual(_uf_bodies(snapshots[-1].geometry_structure["root"]), {})
                item, = [i for i in _uf_items(doc) if i.get("measurementSource") == "process"]
                self.assertEqual((item["zMin"], item["zMax"]), interval)
                self.assertEqual(item["sourceIds"], [])
        _, removed, _, _ = execute_document(_target(ctx, "remove"))
        self.assertEqual(_uf_shapes(removed), [])

    def test_copied_synthetic_fill_keeps_source_step_and_moves_with_the_assembly(self):
        from test_schematic_planning import entity
        ctx = _flow(physical_gap=6)
        ctx.referenced_catalog_geometries["outer"] = entity("outer", "carrier")
        ctx.definition["flowInputs"].append({"flowInputId": "outer", "name": "outer", "dataType": "geometry", "required": True})
        ctx.configuration["inputBindings"]["outer"] = {"kind": "catalog", "geometryId": "outer"}
        target = placement()
        target["targetRegion"].update(topRightX=100, topRightY=100)
        add_step(ctx, "copy", "pnp/pnp", inp("outer"), {"placements": [target]}, out("uf"))
        _, doc, _, bindings = execute_document(_target(ctx, "copy"))
        self.assertEqual(doc["warnings"], [])
        item, = [i for i in _uf_items(doc) if i.get("measurementSource") == "process"]
        self.assertEqual((item["zMin"], item["zMax"]), (20, 26))
        self.assertEqual(item["sourceStepRefId"], "uf")
        self.assertEqual(item["sourceIds"], [])
        self.assertNotEqual(bindings["copy"].layer_fills[0].object_id, bindings["uf"].layer_fills[0].object_id)

    def test_wafer_dummy_is_excluded_from_layer_fill_endpoints(self):
        ctx = _flow()
        ctx.referenced_catalog_geometries["dummy"] = _die("dummy", "wafer-dmy")
        ctx.definition["flowInputs"].append({"flowInputId": "dummy", "name": "dummy", "dataType": "geometry", "required": True})
        ctx.configuration["inputBindings"]["dummy"] = {"kind": "catalog", "geometryId": "dummy"}
        add_step(ctx, "dummy", "pnp/pnp", out("hbm-place"), {"placements": [placement(50)]}, inp("dummy"))
        for edge in ctx.definition["flowEdges"]:
            if edge["target"]["stepRefId"] == "uf":
                edge["source"] = out("dummy")
        _, doc, _, _ = execute_document(_target(ctx, "uf"))
        components = {item["label"]: item for item in doc["components"] if item["label"] != "Wafer DMY"}
        bridge, = _uf_shapes(doc)
        left,right = sorted(components.values(), key=lambda item:item["x"])
        self.assertEqual((bridge["x"], bridge["width"]),
                         (left["x"]+left["width"], right["x"]-left["x"]-left["width"]))

    def test_polygon_holes_islands_and_xy_placement_do_not_change_layer_climbs(self):
        from process_flow_api.schematic_builder import build_schematic
        ctx = _target(_flow(), "uf")
        planning, expected, snapshots, bindings = execute_document(ctx)
        for loops in (
            [[[1000,1000,10],[2000,1000,10],[2000,2000,10],[1000,2000,10]],
             [[1200,1200,10],[1200,1800,10],[1800,1800,10],[1800,1200,10]]],
            [[[500,500,10],[501,500,10],[501,501,10],[500,501,10]],
             [[800,800,10],[801,800,10],[801,801,10],[800,801,10]]],
        ):
            source = copy.deepcopy(snapshots[-1].geometry_structure)
            for node in _uf_bodies(source["root"]).values():
                node["geometry"]["polys"] = loops
            for child in source["root"].get("children", ()):
                if child.get("key") in ("soc", "hbm"):
                    for body in child.get("bodies", ()):
                        for corner in ("bottom_left", "top_right"):
                            body["geometry"][corner][0] += 10000
            doc = build_schematic(source, layout_plan=planning.layout_for(ctx.target),
                                  component_bindings=bindings["uf"])
            self.assertEqual(doc, expected)

    def test_uf_composition_does_not_classify_or_intersect_polygons(self):
        from process_flow_api.schematic_builder import build_schematic
        from process_flow_kernel.utils import polygon
        ctx = _target(_flow(), "uf")
        planning, doc, snapshots, bindings = execute_document(ctx)
        with patch.object(polygon, "_classify_indices", side_effect=AssertionError("polygon classification")), \
             patch("shapely.intersection", side_effect=AssertionError("polygon intersection")), \
             patch("shapely.set_precision", side_effect=AssertionError("polygon precision")):
            repeated = build_schematic(snapshots[-1].geometry_structure, layout_plan=planning.layout_for(ctx.target),
                                       component_bindings=bindings["uf"], polygon_lookup=snapshots[-1].polygons.get)
        self.assertEqual(repeated, doc)

    def test_http_preview_serializes_gap_and_rebuilds_the_same_slots_after_cache_eviction(self):
        ctx = _flow()
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(db_path=Path(directory) / "underfill.sqlite3")
            try:
                for template in ctx.step_templates:
                    if app.state.store.get_process_step_template(template["id"]) is None:
                        app.state.store.insert_process_step_template(template)
                for identifier, geometry in ctx.referenced_catalog_geometries.items():
                    app.state.store.insert_geometry({
                        **geometry, "name": identifier, "entityType": "panel" if identifier == "base" else "die",
                        "category": "carrier" if identifier == "base" else "lsi", "dim": "", "structureFormat": "standard",
                    })
                documents = []
                with TestClient(app) as client:
                    for step in ("hbm-place", "uf", "uf"):
                        app.state.preview_sessions._layout_plans.clear()
                        response = client.post("/api/preview-sessions", json={
                            "flow": {"definition": ctx.definition, "configuration": ctx.configuration},
                            "target": {"type": "stepOutput", "stepRefId": step},
                        })
                        self.assertEqual(response.status_code, 200, response.text)
                        session = response.json()
                        snapshot = next(item for item in session["snapshots"]
                                        if item["snapshotId"] == session["initialSnapshotId"])
                        self.assertEqual(snapshot["schematicWarnings"], [])
                        document = snapshot["schematic"]
                        self.assertIsNotNone(document)
                        self.assertEqual(document["warnings"], [])
                        json.dumps(document, allow_nan=False)
                        documents.append(document)
                self.assertEqual(_slots(documents[0]), _slots(documents[1]))
                self.assertEqual(documents[1], documents[2])
                self.assertEqual(_uf_shapes(documents[0]), [])
                self.assertEqual(len(_uf_shapes(documents[1])), 1)
                self.assertEqual(_uf_items(documents[1])[0]["thickness"], 6)
            finally:
                app.state.store.close()


if __name__ == "__main__":
    unittest.main()
