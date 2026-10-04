from __future__ import annotations

import unittest

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetNotApplicable, MeshControlSetRegistry
from process_flow_mesh_control.sets.mesh_model_1 import MeshModel1Set
from process_flow_mesh_control.sets.mesh_model_2 import MeshModel2Set
from process_flow_mesh_control.sets.mesh_model_3 import MeshModel3Set


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
        bodies=[body("body:soc", 0, thickness, "Si", "envelope")],
        bumps=[bump("bump:soc", 10, 5)] if include_bump else [],
    )


class MeshModel2Tests(unittest.TestCase):
    def setUp(self):
        self.registry = MeshControlSetRegistry()

    def apply(self, geometry: dict):
        state = ProcessGeometryState.from_structure(geometry)
        before = state.to_geometry_structure()
        definition, result = self.registry.apply("meshModel2", state)
        self.assertEqual(state.to_geometry_structure(), before)
        self.assertEqual(definition["version"], "1")
        return result

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

        result = self.apply(geometry)
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
                item["reference"] == {"kind": "container", "id": "container:hbm"}
                for item in controls[5:]
            )
        )
        self.assertEqual(
            [
                (item["startZ"]["value"], item["endZ"]["value"])
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

        controls = self.apply(geometry).mesh_control["controls"]

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
                (item["startZ"]["value"], item["endZ"]["value"])
                for item in controls[2:]
            ],
            [(250, 300), (190, 250), (110, 190), (50, 110), (0, 50)],
        )

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

        controls = self.apply(geometry).mesh_control["controls"]

        self.assertEqual(
            [item["label"] for item in controls],
            ["TD_uBump", "TD_UF, HBM top die"],
        )
        self.assertEqual(controls[0]["reference"], {"kind": "bump", "id": "bump:soc"})
        self.assertEqual(controls[1]["elementSize"], 10)
        self.assertEqual(controls[1]["method"], "Z_SECTION_AVG")
        self.assertEqual(
            controls[1]["reference"], {"kind": "container", "id": "container:hbm"}
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

        result = self.apply(structure(hbm))

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
        zero_middle = self.apply(structure(soc_container(thickness=220)))
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

        overlapping = self.apply(structure(soc_container(thickness=150)))
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

        with self.assertRaisesRegex(MeshControlSetNotApplicable, "at least 110 um"):
            self.apply(structure(soc_container(thickness=109)))

    def test_missing_all_optional_targets_returns_no_local_controls(self):
        geometry = structure(
            container(
                "container:root",
                bodies=[body("body:plain", 0, 10, "Si")],
            )
        )

        result = self.apply(geometry)

        self.assertEqual(result.mesh_control["controls"], [])
        self.assertEqual(result.details, [])


if __name__ == "__main__":
    unittest.main()
