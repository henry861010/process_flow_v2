from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetRegistry, validate_mesh_control
from process_flow_mesh_control.rules import append_lsi_si_control
from process_flow_mesh_control.sets import mesh_model_1

from mesh_control_fixtures import feature, hbm, layout, soc, z_control_result

MODELS = ("meshModel1", "meshModel2", "meshModel3")


class LsiSiTests(unittest.TestCase):
    def apply_all(self, geometry):
        state = ProcessGeometryState.from_structure(geometry)
        before = state.to_geometry_structure(), state.inspect()
        for set_id in MODELS:
            with self.subTest(set_id=set_id):
                _, result = MeshControlSetRegistry().apply(set_id, state)
                validate_mesh_control(result.mesh_control, state=state)
                self.assertEqual((state.to_geometry_structure(), state.inspect()), before)
                yield result

    def test_full_thickness_reference_control_and_details(self):
        for z, thickness in ((0, 200), (-73.5, 203.25), (125, 1e-8)):
            geometry = layout([{"id": "lsi", "key": "lsi", "children": [{
                "id": "nested", "bodies": [feature("si", 0, 0, z, thickness, key="lsi.si")],
            }]}])
            for result in self.apply_all(geometry):
                self.assertEqual(result.mesh_control["controls"], [{
                    "method": "Z_SECTION_AVG", "coordinateMode": "reference", "label": "lsi_si",
                    "reference": {"kind": "body", "id": "si"},
                    "elementSize": ((z + thickness) - z) / 5,
                    "startZ": {"anchor": "z_min", "offset": 0},
                    "endZ": {"anchor": "z_max", "offset": 0},
                }])
                self.assertEqual(result.details, [{
                    "label": "lsi_si", "status": "applied", "startZ": z,
                    "endZ": z + thickness, "sourceIds": ["si"],
                }])

    def test_selection_uses_x_then_y_regardless_of_dfs_z_or_thickness(self):
        bodies = [feature("left-top", -100, 500, 0, 100, key="lsi.si"),
                  feature("right-bottom", 50, -100, 1000, 400, key="lsi.si"),
                  feature("right-top", 50, 50, -50, 203.25, key="lsi.si")]
        for ordered in (bodies, list(reversed(bodies))):
            for result in self.apply_all(layout([{"id": "lsi", "bodies": ordered}])):
                control = result.mesh_control["controls"][0]
                self.assertEqual(control["reference"]["id"], "right-top")
                self.assertEqual(control["elementSize"], 40.65)

    def test_ties_keep_first_body_in_dfs_order(self):
        bodies = [feature("first", 50, 50, 0, 200, key="lsi.si"),
                  feature("second", 50, 50, 500, 400, key="lsi.si")]
        for ordered in (bodies, list(reversed(bodies))):
            for result in self.apply_all(layout([{"id": "lsi", "bodies": ordered}])):
                self.assertEqual(result.details[0]["sourceIds"], [ordered[0]["id"]])

    def test_missing_si_and_zero_thickness(self):
        for result in self.apply_all(layout([])):
            self.assertEqual(result.mesh_control["controls"], [])
            self.assertEqual(result.details, [])
        for thickness in (0, 1e-10, 1e-9):
            geometry = layout([{"id": "lsi", "bodies": [
                feature("si", 0, 0, 0, thickness, key="lsi.si"),
                feature("other", -100, 0, 0, 200, key="lsi.si"),
            ]}])
            for result in self.apply_all(geometry):
                self.assertEqual(result.mesh_control["controls"], [])
                self.assertEqual(result.details, [{"label": "lsi_si", "status": "omitted",
                                 "startZ": 0, "endZ": thickness, "sourceIds": ["si"]}])

    def test_lsi_follows_uf_before_generic_carrier_and_does_not_alias_keys(self):
        for stack in (soc("soc", 100, 100), hbm("hbm", 100, 100)):
            geometry = layout([stack, {"id": "lsi", "bodies": [
                feature("si", 0, 0, 20, 200, key="lsi.si"),
                feature("lsi-carrier", 0, 0, -60, 10, key="lsi.si_carrier"),
                feature("lsi-daf", 0, 0, -50, 10, key="lsi.daf"),
                feature("carrier", 0, 0, -60, 10, key="carrier"),
            ]}])
            for result in self.apply_all(geometry):
                result = z_control_result(result)
                labels = [control["label"] for control in result.mesh_control["controls"]]
                self.assertEqual(labels[-2:], ["lsi_si", "Carrier bottom +10"])
                self.assertTrue(labels[-3].startswith("TD_UF"))
                self.assertEqual(result.details[-1]["sourceIds"], ["carrier"])

    def test_section_count_settings_are_independent(self):
        state = ProcessGeometryState.from_structure(layout([{"id": "lsi", "bodies": [
            feature("si", 0, 0, 0, 200, key="lsi.si"),
        ]}]))
        registry = MeshControlSetRegistry()
        with patch.object(mesh_model_1, "LSI_SI_SECTION_COUNT", 4):
            for set_id, size in zip(MODELS, (50, 40, 40)):
                self.assertEqual(registry.apply(set_id, state)[1].mesh_control["controls"][0]["elementSize"], size)

    def test_rule_rejects_invalid_counts_without_modifying_inputs(self):
        bodies = [{"key": "lsi.si", "id": "si", "kind": "body", "xMin": 0, "xMax": 10,
                   "yMin": 0, "yMax": 10, "zMin": 0, "zMax": 200}]
        before = copy.deepcopy(bodies)
        for count in (0, -1, 1.5, True):
            controls, details = [], []
            with self.assertRaisesRegex(ValueError, "positive integer"):
                append_lsi_si_control(controls, details, bodies, section_count=count)
            self.assertEqual((controls, details), ([], []))
        controls, details = [], []
        append_lsi_si_control(controls, details, bodies, section_count=4)
        self.assertEqual(controls[0]["elementSize"], 50)
        self.assertEqual(bodies, before)
