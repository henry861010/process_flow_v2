from __future__ import annotations

import copy
import unittest

from process_flow_kernel import BoxGeometry, PolygonGeometry
from process_flow_schematic import (
    CONDUCTOR_FILL, RDL_DIELECTRIC_FILL, SOLDER_FILL, UNDERFILL_FILL, SchematicContext, SchematicRegistry, geometry_bounds,
)
from process_flow_steps.joint.schematic import present_schematic as present_joint
from process_flow_steps.layer.rdl_schematic import present_circuit, present_schematic as present_rdl, present_via
from process_flow_steps.schematic_presenters import register_presenters
from process_flow_steps.uf.schematic import present_schematic as present_underfill


def box(z=0, thickness=10, x=0, width=20):
    return BoxGeometry([x, 0, z], [x + width, 20, z], thickness).json()


def context(node, container=None, ancestors=(), kind="body"):
    container = container or {"id": "root"}
    structure = {"schemaVersion": "1.0.0", "unitSystem": "um", "root": ancestors[0] if ancestors else container}
    return SchematicContext(structure=structure, node=node, container=container,
        ancestors=ancestors, kind=kind, bounds=geometry_bounds(node["geometry"]), unit="um")


def bump(id="bump", geometry=None, stage="reflowed", density=40):
    return {"id": id, "geometry": geometry or box(), "material": "SnAg", "density": density,
            "stage": stage, "direction": "+z", "koz": 0}


def underfill_gap(loops, *, z=100, thickness=30):
    body = {"id": "uf-gap", "key": "uf", "material": "UF", "geometry":
            PolygonGeometry([[[x, y, z] for x, y in loop] for loop in loops], thickness).json()}
    return body, {"id": "gap-scope", "bodies": [body]}


def underfill_component(id, x_min, y_min, x_max, y_max, *, z=90, thickness=60, key=None):
    return {"id": id, "key": key, "bodies": [{"id": id + "-si", "key": "si", "material": "Si",
            "geometry": BoxGeometry([x_min, y_min, z], [x_max, y_max, z], thickness).json()}]}


class StepPresenterTests(unittest.TestCase):
    def test_process_symbols_share_material_palette_without_changing_source_materials(self):
        node = bump(stage="joined")
        before = copy.deepcopy(node)
        joint = present_joint(context(node, kind="bump"))[0]
        self.assertEqual(joint.fill, SOLDER_FILL)
        self.assertEqual([primitive.fill for primitive in joint.primitives],
                         [SOLDER_FILL, CONDUCTOR_FILL, CONDUCTOR_FILL])
        for presenter, kind in ((present_via, "via"), (present_circuit, "circuit")):
            part = presenter(context(node, kind=kind))[0]
            self.assertEqual(part.fill, CONDUCTOR_FILL)
            self.assertTrue(all(primitive.fill == CONDUCTOR_FILL for primitive in part.primitives))
        self.assertEqual(present_rdl(context(node))[0].fill, RDL_DIELECTRIC_FILL)
        uf = {"id": "uf", "material": "custom fill", "geometry": box(thickness=3)}
        assembly = {"id": "assembly", "bodies": [uf], "bumps": [node]}
        self.assertTrue(all(part.fill == UNDERFILL_FILL for part in present_underfill(context(uf, assembly))))
        self.assertEqual(node, before)

    def test_symbol_motifs_ignore_density_except_zero_density_joint(self):
        for presenter, kind, expected_count in ((present_joint, "bump", 3),
                (present_via, "via", 1), (present_circuit, "circuit", 9)):
            with self.subTest(kind=kind):
                low = bump(stage="joined", density=1)
                high = bump(stage="joined", density=100)
                before = copy.deepcopy(low)
                low_part = presenter(context(low, kind=kind))[0]
                high_part = presenter(context(high, kind=kind))[0]
                self.assertEqual(low_part.primitives, high_part.primitives)
                self.assertEqual(len(low_part.primitives), expected_count)
                if kind == "via":
                    self.assertEqual(low_part.layout, "distributed")
                    self.assertEqual(low_part.distribution_count, 9)
                zero_parts = presenter(context(bump(stage="joined", density=0), kind=kind))
                if kind == "bump":
                    self.assertEqual(zero_parts, [])
                else:
                    self.assertEqual(zero_parts[0].primitives, low_part.primitives)
                    missing_density = bump(stage="joined")
                    missing_density.pop("density")
                    self.assertEqual(presenter(context(missing_density, kind=kind))[0].primitives,
                                     low_part.primitives)
                self.assertEqual(low, before)

    def test_joint_owns_composite_bump_and_requests_horizontal_path_repetition(self):
        registry = SchematicRegistry()
        register_presenters(registry)
        presenter = registry.resolve("bump", None)
        self.assertEqual(presenter(context(bump(stage="joined"), kind="bump")),
                         present_joint(context(bump(stage="joined"), kind="bump")))
        part = presenter(context(bump(stage="joined"), kind="bump"))[0]
        self.assertTrue(all(primitive.kind == "path" and primitive.repeat_x and primitive.closed
                            for primitive in part.primitives))

    def test_unjoined_bumps_are_hidden_even_without_a_matching_joint(self):
        for stage in ("deposited", "reflowed"):
            with self.subTest(stage=stage):
                source = bump(stage=stage)
                before = copy.deepcopy(source)
                self.assertEqual(present_joint(context(source, kind="bump")), [])
                self.assertEqual(source, before)

    def test_retained_cavity_underfill_is_a_slab_without_bump_or_bridge_requirements(self):
        uf = {"id": "uf-body", "key": "uf", "material": "UF", "geometry": box(thickness=3)}
        for bumps in ([], [bump()]):
            with self.subTest(bumps=bool(bumps)):
                die = {"id": "die", "key": "lsi", "bumps": bumps, "bodies": [uf]}
                root = {"id": "root", "children": [die]}
                parts = present_underfill(context(uf, die, (root,)))
                self.assertEqual([part.layout for part in parts], ["node"])
                self.assertTrue(parts[0].primitives)

    def test_standalone_gap_underfill_is_a_slab_without_topology_queries(self):
        from unittest.mock import patch
        from process_flow_kernel.utils import polygon
        uf, gap = underfill_gap([[(10, 0), (14, 0), (14, 10), (10, 10)]])
        root = {"id": "root", "children": [gap]}
        with patch.object(polygon, "classify_polygon_loops", side_effect=AssertionError("topology query")):
            parts = present_underfill(context(uf, gap, (root,)))
        self.assertEqual([part.layout for part in parts], ["span"])
        self.assertTrue(parts[0].primitives)

    def test_process_replaced_gap_is_not_drawn_twice(self):
        from dataclasses import replace
        uf, gap = underfill_gap([[(10, 0), (14, 0), (14, 10), (10, 10)]])
        root = {"id": "root", "children": [gap]}
        self.assertEqual(present_underfill(replace(context(uf, gap, (root,)), display_replaced=True)), [])


if __name__ == "__main__":
    unittest.main()
