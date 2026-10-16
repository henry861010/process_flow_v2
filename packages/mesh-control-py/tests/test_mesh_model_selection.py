from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetRegistry
from process_flow_mesh_control.sets import mesh_model_1

from mesh_control_fixtures import bump, feature, hbm, layout, soc

MODELS = ("meshModel1", "meshModel2", "meshModel3")


class MeshModelSelectionTests(unittest.TestCase):
    def apply_all(self, geometry):
        state = ProcessGeometryState.from_structure(geometry)
        before = state.to_geometry_structure(), state.inspect()
        for set_id in MODELS:
            with self.subTest(set_id=set_id):
                _, result = MeshControlSetRegistry().apply(set_id, state)
                self.assertEqual((state.to_geometry_structure(), state.inspect()), before)
                yield result

    def test_all_models_select_rightmost_then_topmost_hbm_independent_of_dfs(self):
        children = [
            hbm("lower-left", -150, -150), hbm("upper-left", -150, 80),
            hbm("lower-right", 50, -150), hbm("upper-right", 50, 50),
            hbm("last", -100, -20), soc("soc", 120, 120),
        ]
        for ordered in (children, list(reversed(children))):
            for result in self.apply_all(layout(ordered)):
                controls = result.mesh_control["controls"]
                self.assertEqual(controls[0]["reference"], {"kind": "bump", "id": "bump:upper-right"})
                self.assertEqual(result.details[0]["sourceIds"], ["bump:upper-right"])
                self.assertTrue(all(control["reference"] == {"kind": "container", "id": "hbm:upper-right"}
                                    for control in controls[1:]))
                self.assertEqual(
                    [(item["startZ"]["value"], item["endZ"]["value"]) for item in controls[1:]],
                    [(20, 60), (60, 80), (80, 110), (110, 130), (130, 160), (160, 180), (180, 220)],
                )
                self.assertTrue(all(source.endswith(":upper-right")
                                    for detail in result.details for source in detail["sourceIds"]))

    def test_all_models_select_soc_si_and_nested_upper_right_bump(self):
        selected = soc("upper-right", 50, 50)
        selected["bumps"].extend([bump("bump:lower", 70, 55), bump("bump:left", 60, 80)])
        selected["children"] = [{"id": "nested-bumps", "bumps": [bump("bump:selected", 70, 75)]}]
        children = [soc("lower-left", -150, -150), selected, soc("upper-left", -150, 80),
                    soc("lower-right", 50, -150), soc("last", -100, -20)]
        for result in self.apply_all(layout(children)):
            controls = result.mesh_control["controls"]
            self.assertEqual(controls[0]["reference"], {"kind": "bump", "id": "bump:selected"})
            for item in controls[1:]:
                self.assertEqual(item["reference"], {"kind": "body", "id": "si:upper-right"})
            self.assertEqual([detail["sourceIds"] for detail in result.details[1:]], [["si:upper-right"]] * 5)

    def test_selected_hbm_without_bumps_falls_back_to_selected_soc(self):
        children = [hbm("left-hbm", -150, -150), hbm("right-hbm", 50, 50, include_bumps=False),
                    soc("left-soc", -140, -140), soc("right-soc", 100, 100)]
        for result in self.apply_all(layout(children)):
            controls = result.mesh_control["controls"]
            self.assertEqual(controls[0]["reference"]["id"], "bump:right-soc")
            self.assertTrue(all(item["reference"]["id"] == "hbm:right-hbm" for item in controls[1:]))
            self.assertFalse(any("noHBM" in item["label"] for item in controls))

    def test_global_soc_si_without_soc_container_and_empty_hbm(self):
        geometry = layout([
            {"id": "empty-hbm", "key": "hbm", "children": [{"id": "also-empty"}]},
            {"id": "left", "bodies": [feature("si:left", -150, -150, 0, 109, key="soc.si")]},
            {"id": "right", "children": [{"id": "nested", "bodies": [
                feature("si:right", 50, 50, 20, 300, key="soc.si"),
            ]}]},
        ])
        for result in self.apply_all(geometry):
            self.assertEqual(len(result.mesh_control["controls"]), 5)
            self.assertTrue(all(item["reference"]["id"] == "si:right" for item in result.mesh_control["controls"]))

    def test_hbm_base_top_and_bump_representatives_use_xy_selection(self):
        selected = hbm("selected", 50, 50)
        selected["bumps"].append(bump("bump:topmost", 50, 60))
        # Each semantic die key has multiple candidates inside the chosen HBM.
        for name, z, thickness in (("base", 20, 40), ("top", 180, 40)):
            selected["children"].insert(0, {"id": f"duplicate:{name}", "bodies": [
                feature(f"die:{name}:left", 40, 40, z, thickness, key=f"hbm.{name}_die"),
            ]})
            selected["children"].append({"id": f"upper:{name}", "bodies": [
                feature(f"die:{name}:topmost", 50, 60, z, thickness, key=f"hbm.{name}_die"),
            ]})
        for result in self.apply_all(layout([selected])):
            self.assertEqual(result.details[0]["sourceIds"], ["bump:topmost"])
            self.assertEqual(result.details[1]["sourceIds"], ["die:base:topmost"])
            self.assertEqual(result.details[-1]["sourceIds"], ["die:top:topmost"])

    def test_model_settings_can_change_without_changing_other_models(self):
        geometry = layout([soc("selected", 50, 50)])
        state = ProcessGeometryState.from_structure(geometry)
        registry = MeshControlSetRegistry()
        before = {set_id: copy.deepcopy(registry.apply(set_id, state)[1]) for set_id in MODELS}
        with patch.dict(mesh_model_1.SOC_UF_SETTINGS, surface_element_size=2):
            changed = registry.apply("meshModel1", state)[1]
            self.assertEqual(changed.mesh_control["controls"][1]["elementSize"], 2)
            self.assertNotEqual(changed, before["meshModel1"])
            for set_id in MODELS[1:]:
                self.assertEqual(registry.apply(set_id, state)[1], before[set_id])
