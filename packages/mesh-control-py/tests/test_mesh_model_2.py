from __future__ import annotations

import unittest

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetNotApplicable, MeshControlSetRegistry, validate_mesh_control
from process_flow_mesh_control.sets.mesh_model_1 import MeshModel1Set
from process_flow_mesh_control.sets.mesh_model_2 import MeshModel2Set
from process_flow_mesh_control.sets.mesh_model_3 import MeshModel3Set

from mesh_control_fixtures import z_control_result


def box(z: float, thickness: float) -> dict:
    return {
        "type": "BoxGeometry",
        "bottom_left": [0, 0, z],
        "top_right": [100, 100, z],
        "thk": thickness,
    }


def body(body_id: str, z: float, thickness: float, material: str, key=None) -> dict:
    result = {
        "id": body_id,
        "geometry": box(z, thickness),
        "material": material,
    }
    if key is not None:
        result["key"] = key
    return result


def bump(bump_id: str, z: float, thickness: float, material="Sn") -> dict:
    return {
        "id": bump_id,
        "geometry": box(z, thickness),
        "material": material,
        "density": 50,
        "direction": "+z",
        "koz": 0,
        "stage": "reflowed",
    }


def container(
    container_id: str,
    *,
    key=None,
    bodies=None,
    bumps=None,
    children=None,
) -> dict:
    result = {
        "id": container_id,
        "bodies": list(bodies or []),
        "vias": [],
        "circuits": [],
        "bumps": list(bumps or []),
        "children": list(children or []),
    }
    if key is not None:
        result["key"] = key
    return result


def structure(root: dict) -> dict:
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": root,
    }


def hbm_die(container_id: str, body_id: str, key: str, z: float, thickness: float):
    return container(
        container_id,
        bodies=[body(body_id, z, thickness, "Si", key)],
    )


def soc_container(*, thickness: float, include_bump: bool = False) -> dict:
    return container(
        "container:soc",
        key="soc",
        bodies=[body("body:soc", 0, thickness, "Si", "soc.si")],
        bumps=[bump("bump:soc", 10, 5)] if include_bump else [],
    )


class MeshModel2Tests(unittest.TestCase):
    def setUp(self):
        self.registry = MeshControlSetRegistry()

    def apply_z_controls(self, geometry: dict, set_id: str = "meshModel2"):
        state = ProcessGeometryState.from_structure(geometry)
        before = state.to_geometry_structure()
        definition, result = self.registry.apply(set_id, state)
        validate_mesh_control(result.mesh_control, state=state)
        self.assertEqual(state.to_geometry_structure(), before)
        self.assertEqual(definition["version"], "1")
        return z_control_result(result)

    def test_numbered_mesh_models_have_independent_implementations(self):
        geometry = structure(
            container(
                "container:root",
                bodies=[
                    body("body:tim", 0, 10, "Mat_metaltime1", "tim"),
                    body("body:adh", 10, 10, "Adhesive", "adh"),
                ],
            )
        )
        state = ProcessGeometryState.from_structure(geometry)
        self.assertIsNot(MeshModel1Set.build, MeshModel2Set.build)
        self.assertIsNot(MeshModel2Set.build, MeshModel3Set.build)
        self.assertIsNot(MeshModel1Set.build, MeshModel3Set.build)

        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            definition, result = self.registry.apply(set_id, state)
            self.assertEqual(definition["id"], set_id)
            self.assertEqual(definition["version"], "1")
            self.assertEqual(
                [control["label"] for control in result.mesh_control["controls"]],
                ["Tim", "adh"],
            )

    def test_all_models_add_relative_point_for_nested_bottom_carrier(self):
        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            for bottom_z in (-100, 25):
                with self.subTest(set_id=set_id, bottom_z=bottom_z):
                    geometry = structure(
                        container(
                            "container:root",
                            bodies=[body("body:tim", bottom_z + 100, 10, "Tim", "tim")],
                            children=[
                                container("container:empty"),
                                container(
                                    "container:carrier",
                                    bodies=[
                                        body("body:carrier", bottom_z, 100, "Glass", "carrier"),
                                    ],
                                ),
                            ],
                        )
                    )
                    state = ProcessGeometryState.from_structure(geometry)
                    before = state.to_geometry_structure()
                    _, result = self.registry.apply(set_id, state)
                    self.assertEqual(state.to_geometry_structure(), before)
                    self.assertEqual(
                        result.mesh_control["controls"],
                        [
                            {
                                "method": "Z_SECTION_AVG",
                                "coordinateMode": "reference",
                                "label": "Tim",
                                "reference": {"kind": "body", "id": "body:tim"},
                                "elementSize": 50,
                                "startZ": {"anchor": "z_min", "offset": 0},
                                "endZ": {"anchor": "z_max", "offset": 0},
                            },
                            {
                                "method": "Z_POINT",
                                "coordinateMode": "reference",
                                "label": "Carrier bottom +10",
                                "reference": {"kind": "body", "id": "body:carrier"},
                                "z": {"anchor": "z_min", "offset": 10},
                            },
                        ],
                    )
                    self.assertEqual(
                        result.details[-1],
                        {
                            "label": "Carrier bottom +10",
                            "status": "applied",
                            "startZ": bottom_z + 10,
                            "endZ": bottom_z + 10,
                            "sourceIds": ["body:carrier"],
                        },
                    )

    def test_all_models_skip_carrier_when_any_feature_is_lower(self):
        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            for kind in ("body", "via", "circuit", "bump"):
                with self.subTest(set_id=set_id, lower_kind=kind):
                    root = container(
                        "container:root",
                        bodies=[body("body:carrier", 0, 100, "Glass", "carrier")],
                    )
                    if kind == "body":
                        root["bodies"].append(body("body:lower", -20, 10, "Si"))
                    else:
                        lower = bump(f"{kind}:lower", -20, 10)
                        if kind != "bump":
                            lower.pop("stage")
                        if kind == "circuit":
                            lower.pop("direction")
                        root[{"via": "vias", "circuit": "circuits", "bump": "bumps"}[kind]] = [lower]
                    state = ProcessGeometryState.from_structure(structure(root))
                    _, result = self.registry.apply(set_id, state)
                    self.assertEqual(result.mesh_control["controls"], [])
                    self.assertEqual(result.details, [])

    def test_all_models_only_add_points_to_carriers_at_shared_bottom(self):
        geometry = structure(
            container(
                "container:root",
                bodies=[
                    body("body:top-carrier", 200, 100, "Glass", "carrier"),
                    body("body:bottom-carrier-1", 0, 100, "Glass", "carrier"),
                    body("body:plain", 0, 100, "Glass"),
                    body("body:bottom-carrier-2", 0, 100, "Glass", "carrier"),
                ],
            )
        )
        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            with self.subTest(set_id=set_id):
                state = ProcessGeometryState.from_structure(geometry)
                _, result = self.registry.apply(set_id, state)
                self.assertEqual(
                    [item["reference"]["id"] for item in result.mesh_control["controls"]],
                    ["body:bottom-carrier-1", "body:bottom-carrier-2"],
                )

    def test_full_rule_set_preserves_dfs_order_and_resolves_hbm_stack(self):
        hbm = container(
            "container:hbm",
            key="hbm",
            bumps=[bump("bump:hbm", 100, 10)],
            children=[
                hbm_die(
                    "container:hbm-base",
                    "body:hbm-base",
                    "hbm.base_die",
                    0,
                    100,
                ),
                hbm_die(
                    "container:hbm-core-1",
                    "body:hbm-core-1",
                    "hbm.core_die_1",
                    120,
                    50,
                ),
                hbm_die(
                    "container:hbm-core-2",
                    "body:hbm-core-2",
                    "hbm.core_die_2",
                    190,
                    50,
                ),
                hbm_die(
                    "container:hbm-top",
                    "body:hbm-top",
                    "hbm.top_die",
                    260,
                    40,
                ),
            ],
        )
        geometry = structure(
            container(
                "container:root",
                bodies=[
                    body("body:tim-metal", 0, 10, "Mat_metaltime2", "tim"),
                    body("body:tim-other", 10, 10, "OtherTim", "tim"),
                    body("body:adh-1", 20, 10, "Adhesive", "adh"),
                    body("body:adh-2", 30, 10, "Adhesive", "adh"),
                ],
                children=[hbm, soc_container(thickness=400, include_bump=True)],
            )
        )

        result = self.apply_z_controls(geometry)
        controls = result.mesh_control["controls"]

        self.assertEqual(result.mesh_control["globalElementSize"], 1000)
        self.assertEqual(result.mesh_control["symmetry"], "full")
        self.assertEqual(
            [item["label"] for item in controls],
            [
                "Tim",
                "Tim",
                "adh",
                "adh",
                "TD_uBump",
                "TD_UF, HBM base die",
                "TD_UF, HBM B2C gap",
                "TD_UF, HBM core die",
                "TD_UF, HBM C2C gap",
                "TD_UF, HBM core die",
                "TD_UF, HBM C2C gap",
                "TD_UF, HBM top die",
            ],
        )
        self.assertEqual(
            [item["elementSize"] for item in controls],
            [250, 50, 50, 50, 10, 10, 5, 20, 5, 20, 5, 10],
        )
        self.assertEqual(controls[4]["reference"], {"kind": "bump", "id": "bump:hbm"})
        self.assertEqual(controls[5]["method"], "Z_SECTION_CENTER")
        self.assertTrue(
            all(
                item["coordinateMode"] == "absolute" and "reference" not in item
                for item in controls[5:]
            )
        )
        self.assertEqual(
            [
                (item["startZ"], item["endZ"])
                for item in controls[5:]
            ],
            [(0, 100), (100, 120), (120, 170), (170, 190), (190, 240), (240, 260), (260, 300)],
        )
        self.assertEqual(
            [item["label"] for item in result.details],
            [item["label"] for item in controls],
        )

    def test_missing_tim_uses_non_metal_adh_and_soc_fallback(self):
        geometry = structure(
            container(
                "container:root",
                bodies=[body("body:adh", 0, 5, "Adhesive", "adh")],
                children=[soc_container(thickness=300, include_bump=True)],
            )
        )

        controls = self.apply_z_controls(geometry).mesh_control["controls"]

        self.assertEqual(
            [item["label"] for item in controls],
            [
                "adh",
                "TD_uBump",
                "TD_UF, noHBM Zone1 bot",
                "TD_UF, noHBM Zone2 bot",
                "TD_UF, noHBM Zone3",
                "TD_UF, noHBM Zone2 top",
                "TD_UF, noHBM Zone1 top",
            ],
        )
        self.assertEqual(controls[0]["elementSize"], 20)
        self.assertEqual(controls[1]["reference"], {"kind": "bump", "id": "bump:soc"})
        self.assertEqual(
            [
                (item["startZ"], item["endZ"])
                for item in controls[2:]
            ],
            [(250, 300), (190, 250), (110, 190), (50, 110), (0, 50)],
        )

    def test_all_models_soc_uf_uses_only_si_bounds_and_body_reference(self):
        geometry = structure(
            container(
                "container:soc",
                key="soc",
                bodies=[
                    body("body:pass2", 15, 25, "Passivation", "soc.pass2"),
                    body("body:si", 40, 300, "Si", "soc.si"),
                    body("body:usg", 340, 25, "USG", "soc.usg"),
                ],
                bumps=[bump("bump:soc", -10, 20)],
            )
        )
        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            with self.subTest(set_id=set_id):
                result = self.apply_z_controls(geometry, set_id)
                controls = result.mesh_control["controls"]
                self.assertEqual(controls[0]["label"], "TD_uBump")
                self.assertEqual(controls[0]["reference"], {"kind": "bump", "id": "bump:soc"})
                self.assertEqual(
                    [item["label"] for item in controls[1:]],
                    [
                        "TD_UF, noHBM Zone1 bot",
                        "TD_UF, noHBM Zone2 bot",
                        "TD_UF, noHBM Zone3",
                        "TD_UF, noHBM Zone2 top",
                        "TD_UF, noHBM Zone1 top",
                    ],
                )
                expected_ranges = [(290, 340), (230, 290), (150, 230), (90, 150), (40, 90)]
                self.assertEqual(
                    [(item["startZ"], item["endZ"]) for item in controls[1:]],
                    expected_ranges,
                )
                self.assertEqual([item["elementSize"] for item in controls[1:]], [5, 60, 120, 60, 5])
                for item in controls[1:]:
                    self.assertNotIn("reference", item)
                    self.assertEqual(result.details[controls.index(item)]["sourceIds"], ["body:si"])
                self.assertEqual(
                    [(item["startZ"], item["endZ"]) for item in result.details[1:]],
                    expected_ranges,
                )
                self.assertEqual([item["sourceIds"] for item in result.details[1:]], [["body:si"]] * 5)

    def test_all_models_missing_soc_si_skips_uf_and_keeps_other_controls(self):
        soc = soc_container(thickness=300, include_bump=True)
        soc["bodies"][0]["key"] = "envelope"
        soc["bodies"].extend([
            body("body:pass2", -20, 20, "Passivation", "soc.pass2"),
            body("body:usg", 300, 20, "USG", "soc.usg"),
            body("body:unkeyed-si", 0, 300, "Si"),
        ])
        geometry = structure(container(
            "container:root",
            bodies=[body("body:adh", 0, 5, "Adhesive", "adh")],
            children=[soc],
        ))
        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            with self.subTest(set_id=set_id):
                result = self.apply_z_controls(geometry, set_id)
                self.assertEqual([item["label"] for item in result.mesh_control["controls"]], ["adh", "TD_uBump"])
                self.assertEqual([item["sourceIds"] for item in result.details], [["body:adh"], ["bump:soc"]])

    def test_all_models_keep_first_soc_si_when_xy_centers_tie_without_soc_container(self):
        geometry = structure(container(
            "container:root",
            children=[
                container("container:outer", children=[container(
                    "container:nested",
                    bodies=[body("body:first-si", 40, 300, "Si", "soc.si")],
                )]),
                container("container:later", bodies=[body("body:later-si", 1000, 400, "Si", "soc.si")]),
            ],
        ))
        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            with self.subTest(set_id=set_id):
                result = self.apply_z_controls(geometry, set_id)
                controls = result.mesh_control["controls"]
                self.assertEqual(len(controls), 5)
                for item in controls:
                    self.assertNotIn("reference", item)
                    self.assertEqual(result.details[controls.index(item)]["sourceIds"], ["body:first-si"])
                self.assertEqual(controls[0]["startZ"], 290)
                self.assertEqual(controls[-1]["startZ"], 40)

    def test_hbm_partial_output_blocks_soc_uf_but_bump_falls_back_to_soc(self):
        hbm = container(
            "container:hbm",
            key="hbm",
            children=[
                hbm_die(
                    "container:hbm-top",
                    "body:hbm-top",
                    "hbm.top_die",
                    200,
                    40,
                )
            ],
        )
        geometry = structure(
            container(
                "container:root",
                children=[hbm, soc_container(thickness=300, include_bump=True)],
            )
        )

        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            with self.subTest(set_id=set_id):
                controls = self.apply_z_controls(geometry, set_id).mesh_control["controls"]

                self.assertEqual(
                    [item["label"] for item in controls],
                    ["TD_uBump", "TD_UF, HBM top die"],
                )
                self.assertEqual(controls[0]["reference"], {"kind": "bump", "id": "bump:soc"})
                self.assertEqual(controls[1]["elementSize"], 10)
                self.assertEqual(controls[1]["method"], "Z_SECTION_AVG")
                self.assertEqual(
                    controls[1]["coordinateMode"], "absolute"
                )

    def test_zero_hbm_gap_is_reported_and_omitted(self):
        hbm = container(
            "container:hbm",
            key="hbm",
            children=[
                hbm_die(
                    "container:hbm-base",
                    "body:hbm-base",
                    "hbm.base_die",
                    0,
                    100,
                ),
                hbm_die(
                    "container:hbm-top",
                    "body:hbm-top",
                    "hbm.top_die",
                    100,
                    50,
                ),
            ],
        )

        result = self.apply_z_controls(structure(hbm))

        self.assertEqual(
            [item["label"] for item in result.mesh_control["controls"]],
            ["TD_UF, HBM base die", "TD_UF, HBM top die"],
        )
        omitted = [item for item in result.details if item["status"] == "omitted"]
        self.assertEqual(
            [(item["label"], item["startZ"], item["endZ"]) for item in omitted],
            [("TD_UF, HBM B2C gap", 100, 100)],
        )

    def test_soc_thin_and_zero_middle_sections(self):
        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            with self.subTest(set_id=set_id):
                zero_middle = self.apply_z_controls(structure(soc_container(thickness=220)), set_id)
                self.assertEqual(
                    [item["label"] for item in zero_middle.mesh_control["controls"]],
                    [
                        "TD_UF, noHBM Zone1 bot",
                        "TD_UF, noHBM Zone2 bot",
                        "TD_UF, noHBM Zone2 top",
                        "TD_UF, noHBM Zone1 top",
                    ],
                )
                self.assertEqual(
                    [item["label"] for item in zero_middle.details if item["status"] == "omitted"],
                    ["TD_UF, noHBM Zone3"],
                )

                overlapping = self.apply_z_controls(structure(soc_container(thickness=150)), set_id)
                self.assertEqual(
                    [item["label"] for item in overlapping.mesh_control["controls"]],
                    [
                        "TD_UF, noHBM Zone1 bot",
                        "TD_UF, noHBM Zone2 bot",
                        "TD_UF, noHBM Zone2 top",
                        "TD_UF, noHBM Zone1 top",
                    ],
                )
                self.assertNotIn(
                    "TD_UF, noHBM Zone3",
                    [item["label"] for item in overlapping.details],
                )

                thin_soc = soc_container(thickness=109)
                thin_soc["bodies"].append(body("body:pass2", -100, 100, "Passivation", "soc.pass2"))
                with self.assertRaisesRegex(MeshControlSetNotApplicable, r"soc\.si thickness of at least 110 um"):
                    self.apply_z_controls(structure(thin_soc), set_id)

                minimum = self.apply_z_controls(structure(soc_container(thickness=110)), set_id)
                self.assertEqual(len(minimum.mesh_control["controls"]), 4)

    def test_missing_all_optional_targets_returns_no_local_controls(self):
        geometry = structure(
            container(
                "container:root",
                bodies=[body("body:plain", 0, 10, "Si")],
            )
        )

        result = self.apply_z_controls(geometry)

        self.assertEqual(result.mesh_control["controls"], [])
        self.assertEqual(result.details, [])


if __name__ == "__main__":
    unittest.main()
