"""RDL symbols retain physical layer contacts through execution and flip."""
from __future__ import annotations

import copy
import unittest

from process_flow_kernel import ProcessGeometryState, ProcessStepContext
from process_flow_schematic import SchematicRegistry, compose_schematic, geometry_bounds
from process_flow_steps.flip.flip import execute as execute_flip
from process_flow_steps.layer.rdl import execute as execute_rdl
from process_flow_steps.schematic_presenters import register_presenters
from process_flow_steps.tmv.tmv import execute as execute_tmv


def context(state, values=None):
    values = values or {}
    return ProcessStepContext(
        state=state, values=values, raw_parameter_values=values,
        step_ref={}, step_template={}, step_configuration={}, geometry_inputs={},
        input_geometry=None, geometry_resolver=lambda _: None,
    )


def rdl_state(density=40, thicknesses=(2, 3, 1, 4, 2)):
    state = ProcessGeometryState.create()
    state.initialize_box_layer(material="Si", bottom_left=[0, 0, 0],
                               top_right=[20, 20, 0], thickness=10)
    execute_rdl(context(state, {"layers": [
        {"Dielectric": "PI", "Conductivity": "Cu", "thk": thickness, "density": density}
        for thickness in thicknesses
    ]}))
    return state


def registry():
    result = SchematicRegistry()
    register_presenters(result)
    return result


def edge(shape, *, top):
    """Return the horizontal extent at a symbol's top or bottom boundary."""
    if shape["kind"] == "rect":
        return (shape["y"] if top else shape["y"] + shape["height"],
                shape["x"], shape["x"] + shape["width"])
    points = shape["points"]
    y = (min if top else max)(point[1] for point in points)
    xs = [point[0] for point in points if abs(point[1] - y) < 1e-8]
    return y, min(xs), max(xs)


def symbols(document, source_id):
    item = next(item for item in document["items"] if source_id in item["sourceIds"])
    return sorted((shape for shape in document["shapes"] if shape["itemId"] == item["id"]),
                  key=lambda shape: edge(shape, top=True)[1])


def horizontal_layout(document, container):
    """Compare routes independently of display placement, Z scale and IDs."""
    result = {}
    for kind in ("vias", "circuits"):
        result[kind] = []
        for feature in container[kind]:
            row = []
            for shape in symbols(document, feature["id"]):
                _, left, right = edge(shape, top=True)
                origin, width = shape["clip"]["x"], shape["clip"]["width"]
                values = (((left + right) / 2 - origin) / width,) if kind == "vias" else (
                    (left - origin) / width, (right - left) / width)
                row.append(tuple(round(value, 10) for value in values))
            result[kind].append(tuple(row))
    return result


class RdlSchematicTests(unittest.TestCase):
    def test_tmv_is_straight_while_rdl_stays_tapered_before_and_after_flip(self):
        state = rdl_state()
        execute_tmv(context(state, {"material": "Cu", "thk": 30, "density": 40}))
        state.deposit_layer(material="EMC", thickness=30, key="molding")
        for flipped in (False, True):
            with self.subTest(flipped=flipped):
                if flipped:
                    execute_flip(context(state))
                snapshot = state.to_geometry_structure()
                tmv_id = next(via["id"] for via in snapshot["root"]["vias"]
                              if geometry_bounds(via["geometry"]).thickness == 30)
                before = copy.deepcopy(snapshot)
                document = compose_schematic(snapshot, registry())
                self.assertEqual(document["warnings"], [])
                columns = symbols(document, tmv_id)
                self.assertEqual(len(columns), 9)
                self.assertTrue(all(shape["kind"] == "rect" for shape in columns))
                for shape in columns:
                    self.assertEqual(edge(shape, top=True)[1:], edge(shape, top=False)[1:])
                    self.assertAlmostEqual(shape["height"], shape["clip"]["height"])
                rdl_features = {kind: [feature for feature in snapshot["root"][kind]
                                      if feature["id"] != tmv_id]
                                for kind in ("vias", "circuits")}
                self.assert_layer_symbols(document, rdl_features)
                self.assertEqual(snapshot, before)

    def assert_layer_symbols(self, document, container):
        self.assertEqual(document["warnings"], [])
        for kind in ("vias", "circuits"):
            for feature in container[kind]:
                shapes = symbols(document, feature["id"])
                self.assertEqual(len(shapes), 9)
                self.assertGreater(len(shapes), 3)
                measurement = next(item for item in document["items"]
                                   if feature["id"] in item["sourceIds"])
                bounds = geometry_bounds(feature["geometry"])
                self.assertEqual((measurement["zMin"], measurement["zMax"], measurement["thickness"]),
                                 (bounds.z_min, bounds.z_max, bounds.thickness))
                self.assertEqual(measurement["material"], feature["material"])
                if kind == "circuits":
                    self.assertTrue(all(shape["kind"] == "rect" for shape in shapes))
                    self.assertEqual(len({(shape["y"], shape["height"]) for shape in shapes}), 1)
                for index, shape in enumerate(shapes):
                    top_y, top_left, top_right = edge(shape, top=True)
                    bottom_y, bottom_left, bottom_right = edge(shape, top=False)
                    self.assertAlmostEqual(top_y, shape["clip"]["y"])
                    self.assertAlmostEqual(bottom_y, shape["clip"]["y"] + shape["clip"]["height"])
                    self.assertGreater(top_right, top_left)
                    self.assertGreater(bottom_right, bottom_left)
                    symbol_width = max(top_right - top_left, bottom_right - bottom_left)
                    self.assertLessEqual(symbol_width, shape["clip"]["width"] * 0.1)
                    cell_left = shape["clip"]["x"] + index * shape["clip"]["width"] / 9
                    cell_right = cell_left + shape["clip"]["width"] / 9
                    self.assertGreaterEqual(min(top_left, bottom_left), cell_left)
                    self.assertLessEqual(max(top_right, bottom_right), cell_right)
                    if kind == "circuits":
                        self.assertGreater(symbol_width, shape["clip"]["width"] * 0.06)
                    if kind == "vias":
                        self.assertEqual(shape["kind"], "path")
                        self.assertTrue(shape["closed"])
                        self.assertEqual(len(shape["points"]), 4)
                        if feature["direction"] == "-z":
                            self.assertGreater(top_right - top_left, bottom_right - bottom_left)
                        else:
                            self.assertLess(top_right - top_left, bottom_right - bottom_left)

    def assert_contacts(self, document, container, expected=4):
        contacts = 0
        circuit_ends = {}
        for via in container["vias"]:
            via_bounds = geometry_bounds(via["geometry"])
            for circuit in container["circuits"]:
                circuit_bounds = geometry_bounds(circuit["geometry"])
                if via_bounds.z_max == circuit_bounds.z_min:
                    via_top, circuit_top = True, False
                elif via_bounds.z_min == circuit_bounds.z_max:
                    via_top, circuit_top = False, True
                else:
                    continue
                contacts += 1
                circuit_ends.setdefault(circuit["id"], []).append((via, via_top))
                for via_shape, circuit_shape in zip(symbols(document, via["id"]),
                                                     symbols(document, circuit["id"])):
                    via_y, via_left, via_right = edge(via_shape, top=via_top)
                    circuit_y, circuit_left, circuit_right = edge(circuit_shape, top=circuit_top)
                    self.assertAlmostEqual(via_y, circuit_y)
                    self.assertGreater(min(via_right, circuit_right) - max(via_left, circuit_left), 0)
                    self.assertLess(via_right - via_left, circuit_right - circuit_left)
        self.assertEqual(contacts, expected)
        for circuit_id, neighbors in circuit_ends.items():
            if len(neighbors) != 2:
                continue
            first, second = neighbors
            for circuit_shape, first_shape, second_shape in zip(
                    symbols(document, circuit_id), symbols(document, first[0]["id"]),
                    symbols(document, second[0]["id"])):
                _, left, right = edge(circuit_shape, top=True)
                middle = (left + right) / 2
                _, first_left, first_right = edge(first_shape, top=first[1])
                _, second_left, second_right = edge(second_shape, top=second[1])
                first_center = (first_left + first_right) / 2
                second_center = (second_left + second_right) / 2
                self.assertLess((first_center - middle) * (second_center - middle), 0)
                self.assertGreater(abs(first_center - second_center),
                                   circuit_shape["clip"]["width"] * 0.03)

    def test_executed_rdl_has_directional_vias_and_contacting_circuit_bands(self):
        state = rdl_state()
        original_layout = None
        for flipped in (False, True):
            with self.subTest(flipped=flipped):
                if flipped:
                    execute_flip(context(state))
                snapshot = state.to_geometry_structure()
                before = copy.deepcopy(snapshot)
                document = compose_schematic(snapshot, registry())
                self.assert_layer_symbols(document, snapshot["root"])
                self.assert_contacts(document, snapshot["root"])
                self.assertEqual({via["direction"] for via in snapshot["root"]["vias"]},
                                 {"+z" if flipped else "-z"})
                self.assertEqual(document["totalThickness"], 22)
                layout = horizontal_layout(document, snapshot["root"])
                if flipped:
                    self.assertEqual(layout, original_layout)
                else:
                    original_layout = layout
                    offsets = [center[0] - (index + 0.5) / 9
                               for index, center in enumerate(layout["vias"][0])]
                    self.assertEqual({offset > 0 for offset in offsets}, {False, True})
                    self.assertGreaterEqual(len({round(abs(offset), 6) for offset in offsets}), 3)
                self.assertEqual(snapshot, before)

    def test_routes_are_stable_across_recomposition_identity_material_and_translation(self):
        state = rdl_state()
        original = state.to_geometry_structure()
        document = compose_schematic(original, registry())
        layout = horizontal_layout(document, original["root"])
        self.assertEqual(compose_schematic(original, registry()), document)
        state.move(x=300, y=-700, z=50, move_cursor=True)
        variant = state.to_geometry_structure()
        variant["root"]["id"] = "renamed-root"
        for kind in ("bodies", "vias", "circuits"):
            for index, feature in enumerate(variant["root"][kind]):
                feature["id"] = f"renamed-{kind}-{index}"
                feature["material"] += "_dup2"
                if kind != "bodies":
                    feature.pop("density")
        before = copy.deepcopy(variant)
        renamed = compose_schematic(variant, registry())
        self.assertEqual(renamed["warnings"], [])
        self.assertEqual(horizontal_layout(renamed, variant["root"]), layout)
        self.assertEqual(variant, before)

    def test_detached_via_does_not_reroute_a_separate_contact_chain(self):
        snapshot = rdl_state().to_geometry_structure()
        baseline = compose_schematic(snapshot, registry())
        source = copy.deepcopy(snapshot)
        detached = copy.deepcopy(source["root"]["vias"][0])
        detached["id"] = "detached-via"
        detached["direction"] = "+z"
        for corner in ("bottom_left", "top_right"):
            detached["geometry"][corner][2] = 1000
        source["root"]["vias"].insert(0, detached)
        before = copy.deepcopy(source)
        document = compose_schematic(source, registry())
        original_features = {kind: source["root"][kind][1:] if kind == "vias" else source["root"][kind]
                             for kind in ("vias", "circuits")}
        self.assertEqual(horizontal_layout(document, original_features),
                         horizontal_layout(baseline, snapshot["root"]))
        self.assertEqual(source, before)

    def test_lone_via_and_terminal_circuit_stay_fitted_and_flip_stable(self):
        for thicknesses in ((2,), (2, 3)):
            with self.subTest(thicknesses=thicknesses):
                state = rdl_state(thicknesses=thicknesses)
                snapshot = state.to_geometry_structure()
                document = compose_schematic(snapshot, registry())
                self.assert_layer_symbols(document, snapshot["root"])
                self.assert_contacts(document, snapshot["root"], expected=len(thicknesses) - 1)
                layout = horizontal_layout(document, snapshot["root"])
                execute_flip(context(state))
                flipped = state.to_geometry_structure()
                flipped_document = compose_schematic(flipped, registry())
                self.assert_layer_symbols(flipped_document, flipped["root"])
                self.assert_contacts(flipped_document, flipped["root"], expected=len(thicknesses) - 1)
                self.assertEqual(horizontal_layout(flipped_document, flipped["root"]), layout)

    def test_two_actual_flips_restore_geometry_and_schematic(self):
        state = rdl_state()
        original = copy.deepcopy(state.to_geometry_structure())
        document = compose_schematic(original, registry())
        execute_flip(context(state))
        execute_flip(context(state))
        restored = state.to_geometry_structure()
        self.assertEqual(restored, original)
        self.assertEqual(compose_schematic(restored, registry()), document)

    def test_density_is_ignored_including_zero_and_missing_values(self):
        snapshot = rdl_state(density=1).to_geometry_structure()
        before = copy.deepcopy(snapshot)
        document = compose_schematic(snapshot, registry())
        for density in (0, 100, None):
            with self.subTest(density=density):
                variant = copy.deepcopy(snapshot)
                for kind in ("vias", "circuits"):
                    for feature in variant["root"][kind]:
                        if density is None:
                            feature.pop("density")
                        else:
                            feature["density"] = density
                variant_before = copy.deepcopy(variant)
                self.assertEqual(compose_schematic(variant, registry()), document)
                self.assertEqual(variant, variant_before)
        self.assertEqual(snapshot, before)

        zero = rdl_state(density=0).to_geometry_structure()
        zero_before = copy.deepcopy(zero)
        zero_document = compose_schematic(zero, registry())
        self.assert_layer_symbols(zero_document, zero["root"])
        self.assert_contacts(zero_document, zero["root"])
        self.assertEqual(zero_document["totalThickness"], document["totalThickness"])
        self.assertEqual(zero, zero_before)

    def test_equivalent_components_merge_despite_zero_positive_or_missing_density(self):
        carrier = ProcessGeometryState.create()
        carrier.initialize_box_layer(material="Glass", bottom_left=[0, 0, 0],
                                     top_right=[2000, 2000, 0], thickness=100)
        for index, density in enumerate((0, 40, 100)):
            carrier.place_geometry_state(rdl_state(density=density), x=index * 100,
                                         y=0, bottom_z=100)
        snapshot = carrier.to_geometry_structure()
        for kind in ("vias", "circuits"):
            for feature in snapshot["root"]["children"][2][kind]:
                feature.pop("density")
        before = copy.deepcopy(snapshot)
        document = compose_schematic(snapshot, registry())
        self.assertEqual(document["warnings"], [])
        self.assertEqual(len(document["components"]), 1)
        self.assertEqual(len(document["components"][0]["sourceIds"]), 3)
        conductor_items = [item for item in document["items"]
                           if item["label"].startswith(("Via", "Circuit"))]
        self.assertEqual(len(conductor_items), 5)
        self.assertTrue(all(len(item["sourceIds"]) == 3 for item in conductor_items))
        self.assertEqual(snapshot, before)

    def test_contacts_and_taper_fit_a_narrow_placed_component_after_flip(self):
        die = rdl_state()
        execute_flip(context(die))
        die_before = copy.deepcopy(die.to_geometry_structure())
        carrier = ProcessGeometryState.create()
        carrier.initialize_box_layer(material="Glass", bottom_left=[0, 0, 0],
                                     top_right=[2000, 2000, 0], thickness=100)
        carrier.place_geometry_state(die, x=900, y=900, bottom_z=100)
        snapshot = carrier.to_geometry_structure()
        before = copy.deepcopy(snapshot)
        document = compose_schematic(snapshot, registry())
        placed = snapshot["root"]["children"][0]
        self.assert_layer_symbols(document, placed)
        self.assert_contacts(document, placed)
        self.assertEqual(len(document["components"]), 1)
        component = document["components"][0]
        for feature in (*placed["vias"], *placed["circuits"]):
            for shape in symbols(document, feature["id"]):
                for top in (True, False):
                    _, left, right = edge(shape, top=top)
                    self.assertGreaterEqual(left, component["x"])
                    self.assertLessEqual(right, component["x"] + component["width"])
        self.assertEqual(snapshot, before)
        self.assertEqual(die.to_geometry_structure(), die_before)


if __name__ == "__main__":
    unittest.main()
