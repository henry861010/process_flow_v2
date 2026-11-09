"""Exercise generator adaptation after actual formation, flip, PnP and joint steps."""
from __future__ import annotations

import copy
import unittest
from itertools import product

from process_flow_geometry_generators import GeometryGeneratorRegistry, register_builtin_generators
from process_flow_kernel import GeometryArtifact, ProcessGeometryState, ProcessStepContext
from process_flow_steps.bump.bga_bump_formation import execute as bga_bump
from process_flow_steps.bump.c4_bump_formation import execute as c4_bump
from process_flow_steps.bump.uBump_formation import execute as micro_bump
from process_flow_steps.flip.flip import execute as flip
from process_flow_steps.joint.mr_joint import execute as mr_joint
from process_flow_steps.pnp.pnp import execute as pnp


def context(state, values, artifacts=None):
    artifacts = artifacts or {}
    return ProcessStepContext(
        state=state, values=values, raw_parameter_values=values,
        step_ref={}, step_template={}, step_configuration={}, geometry_inputs={},
        input_geometry=None, geometry_resolver=lambda _: None,
        geometry_artifact_resolver=artifacts.get,
    )


def restore(entity):
    return ProcessGeometryState.from_structure(
        entity["structure"], {"footprint": {"derive": "largestRootBody"}},
    )


def features(container):
    for kind in ("bodies", "vias", "circuits", "bumps"):
        yield from container[kind]
    for child in container["children"]:
        yield from features(child)


def bounds(geometry):
    kind = geometry["type"]
    if kind == "BoxGeometry":
        x0, y0, z = geometry["bottom_left"]
        x1, y1, _ = geometry["top_right"]
    elif kind == "PolygonGeometry":
        points = [point for loop in geometry["polys"] for point in loop]
        x0, y0 = min(p[0] for p in points), min(p[1] for p in points)
        x1, y1 = max(p[0] for p in points), max(p[1] for p in points)
        z = points[0][2]
    else:
        x, y, z = geometry["center"]
        radius = geometry["bottom_radius"]
        x0, x1, y0, y1 = x - radius, x + radius, y - radius, y + radius
    return x0, y0, x1, y1, z


def placement(width, height, kind):
    if kind == "rectangle":
        region = {"type": kind, "bottomLeftX": 0, "bottomLeftY": 0,
                  "topRightX": width, "topRightY": height}
    else:
        # Chamfer one corner: checking exact points catches bounding-box-only adaptation.
        region = {"type": kind, "points": [
            [0, 0], [width, 0], [width, height * .98],
            [width * .98, height], [0, height],
        ]}
    return {"targetRegion": region, "pose": {"x": 0, "y": 0, "rotationZ": 0},
            "anchor": "center"}


class GeneratorBumpPnpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = GeometryGeneratorRegistry()
        register_builtin_generators(cls.registry)

    def destination(self):
        entity = self.registry.generate("panel-carrier", 1, {
            "packageX": 2_000_000, "packageY": 2_000_000,
        })
        state = restore(entity)
        micro_bump(context(state, {"material": "lower-bump", "thk": 7,
                                   "density": 31, "koz": .4}))
        artifact = GeometryArtifact.from_state(state, source=GeometryArtifact.from_entity(entity))
        return state, artifact

    def test_all_generators_preserve_bumps_and_fixed_cores_through_pnp_and_joint(self):
        for definition in self.registry.definitions():
            generator_id = definition["id"]
            variants = ("gen1", "gen2", "gen2-bs-first") if generator_id == "lsi" else (None,)
            for variant in variants:
                parameters = {"generation": variant} if variant else {}
                entity = self.registry.generate(generator_id, definition["version"], parameters)
                for formation in (micro_bump, bga_bump, c4_bump):
                    for target_kind, size_factor in product(("rectangle", "polygon"), (.9, 1.1)):
                        with self.subTest(generator=generator_id, generation=variant,
                                          formation=formation.__module__, target=target_kind,
                                          size_factor=size_factor):
                            original = copy.deepcopy(entity)
                            source = restore(entity)
                            flip(context(source, {}))
                            formation(context(source, {"material": "formed-bump", "thk": 20,
                                                       "density": 43, "koz": .7}))
                            flip(context(source, {}))
                            artifact = GeometryArtifact.from_state(source, source=GeometryArtifact.from_entity(entity))
                            source_snapshot = copy.deepcopy(artifact.structure)
                            before = artifact.structure["root"]
                            x0, y0, x1, y1, _ = bounds(before["bodies"][0]["geometry"])
                            width, height = (x1 - x0) * size_factor, (y1 - y0) * size_factor
                            target = placement(width, height, target_kind)
                            state, main = self.destination()
                            main_cursor = state.cursor_z()
                            pnp(context(state, {"placements": [target]}, {
                                "main_geometry": main, "die_geometry": artifact,
                            }))
                            snapshot = state.to_geometry_structure()["root"]
                            self.assertEqual(len(snapshot["children"]), 1)
                            placed = snapshot["children"][0]
                            self.assertEqual(placed["key"], before["key"])
                            self.assertEqual(len(placed["bumps"]), len(before["bumps"]))
                            before_features = list(features(before))
                            after_features = list(features(placed))
                            self.assertEqual(len(after_features), len(before_features))
                            z_shift = bounds(after_features[0]["geometry"])[4] - bounds(before_features[0]["geometry"])[4]
                            for old, new in zip(before_features, after_features):
                                for field in ("key", "material", "density", "koz", "direction", "stage"):
                                    self.assertEqual(new.get(field), old.get(field))
                                self.assertEqual(new["geometry"]["thk"], old["geometry"]["thk"])
                                self.assertAlmostEqual(bounds(new["geometry"])[4] - bounds(old["geometry"])[4], z_shift)

                            rigid = definition["adaptationContract"]["adapterId"] == "rigid"
                            if rigid:
                                for old, new in zip(features(before), features(placed)):
                                    self.assertEqual(new["geometry"]["type"], old["geometry"]["type"])
                                    self.assertEqual(new["geometry"]["bottom_radius"], old["geometry"]["bottom_radius"])
                            if not rigid:
                                for kind in ("bodies", "vias", "circuits", "bumps"):
                                    for feature in placed[kind]:
                                        geometry = feature["geometry"]
                                        self.assertEqual(bounds(geometry)[:4], (0, 0, width, height))
                                        if target_kind == "polygon":
                                            self.assertEqual(geometry["type"], "PolygonGeometry")
                                            self.assertEqual([p[:2] for p in geometry["polys"][0]],
                                                             target["targetRegion"]["points"])
                            # The HBM base die follows the package; stacked cores stay fixed.
                            for old_child, new_child in zip(before["children"], placed["children"]):
                                if generator_id == "hbm" and "hbm-base-die" in old_child["id"]:
                                    self.assertEqual(bounds(new_child["bodies"][0]["geometry"])[:4],
                                                     (0, 0, width, height))
                                    continue
                                for old, new in zip(features(old_child), features(new_child)):
                                    old_bounds, new_bounds = bounds(old["geometry"]), bounds(new["geometry"])
                                    self.assertAlmostEqual(new_bounds[2] - new_bounds[0], old_bounds[2] - old_bounds[0])
                                    self.assertAlmostEqual(new_bounds[3] - new_bounds[1], old_bounds[3] - old_bounds[1])

                            bottom_z = min(bounds(f["geometry"])[4] for f in features(placed))
                            bottom_indices = [index for index, bump in enumerate(placed["bumps"])
                                              if bounds(bump["geometry"])[4] == bottom_z]
                            self.assertTrue(bottom_indices)
                            self.assertEqual(bottom_z, main_cursor + 7)
                            mr_joint(context(state, {"bump_joined_height": 23}))
                            joined = state.to_geometry_structure()["root"]
                            self.assertEqual(joined["bumps"], snapshot["bumps"])
                            for index in bottom_indices:
                                bump = joined["children"][0]["bumps"][index]
                                self.assertEqual(bump["stage"], "joined")
                                self.assertEqual(bump["geometry"]["thk"], 23)
                                self.assertEqual(bounds(bump["geometry"])[4], main_cursor)
                                for field in ("material", "density", "koz", "direction"):
                                    self.assertEqual(bump[field], placed["bumps"][index][field])
                            self.assertEqual(artifact.structure, source_snapshot)
                            self.assertEqual(entity, original)

    def test_hbm_and_dram_reject_truly_undersized_targets_without_partial_placement(self):
        for generator_id in ("hbm", "dram"):
            for target_kind in ("rectangle", "polygon"):
                with self.subTest(generator=generator_id, target=target_kind):
                    entity = self.registry.generate(generator_id, 2, {})
                    source = restore(entity)
                    flip(context(source, {}))
                    micro_bump(context(source, {"material": "SnAg", "thk": 20,
                                               "density": 40, "koz": 0}))
                    flip(context(source, {}))
                    artifact = GeometryArtifact.from_entity(entity).with_structure(source.to_geometry_structure())
                    state, main = self.destination()
                    original, cursor = state.to_geometry_structure(), state.cursor_z()
                    with self.assertRaisesRegex(ValueError, "fixed core geometry does not fit"):
                        pnp(context(state, {"placements": [
                            placement(11_000, 7_500, target_kind),
                            placement(4_000, 3_000, target_kind),
                        ]}, {"main_geometry": main, "die_geometry": artifact}))
                    self.assertEqual(state.to_geometry_structure(), original)
                    self.assertEqual(state.cursor_z(), cursor)


if __name__ == "__main__":
    unittest.main()
