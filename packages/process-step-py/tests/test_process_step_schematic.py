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
                self.assertEqual(parts[0].bridge_groups, ())

    def test_gap_underfill_connects_heterogeneous_no_bump_components(self):
        uf, gap = underfill_gap([[(10, 0), (14, 0), (14, 10), (10, 10)]])
        soc = underfill_component("soc", 0, 0, 10, 10, key="soc")
        hbm = underfill_component("hbm", 14, 0, 24, 10, key="hbm")
        root = {"id": "root", "children": [soc, hbm, gap]}
        before = copy.deepcopy(root)
        parts = present_underfill(context(uf, gap, (root,)))
        self.assertEqual([part.layout for part in parts], ["bridges"])
        self.assertEqual(parts[0].bridge_groups, (("soc", "hbm"),))
        self.assertEqual(parts[0].primitives, ())
        self.assertEqual(parts[0].eligible_container_ids, ())
        self.assertEqual(root, before)

    def test_gap_underfill_keeps_disconnected_islands_as_separate_relations(self):
        uf, gap = underfill_gap([
            [(10, 0), (14, 0), (14, 10), (10, 10)],
            [(40, 0), (44, 0), (44, 10), (40, 10)],
        ])
        components = [underfill_component(id, x, 0, x + 10, 10)
                      for id, x in (("a", 0), ("b", 14), ("c", 30), ("d", 44))]
        root = {"id": "root", "children": [*components, gap]}
        self.assertEqual(present_underfill(context(uf, gap, (root,)))[0].bridge_groups,
                         (("a", "b"), ("c", "d")))

    def test_gap_underfill_respects_holes_and_excludes_point_only_contact(self):
        uf, gap = underfill_gap([
            [(10, 0), (40, 0), (40, 30), (10, 30)],
            [(20, 10), (30, 10), (30, 20), (20, 20)],
        ])
        components = [underfill_component("left", 0, 0, 10, 30),
                      underfill_component("right", 40, 0, 50, 30),
                      underfill_component("in-hole", 22, 12, 24, 14),
                      underfill_component("corner", 40, 30, 50, 40),
                      underfill_component("overlap", 11, 1, 12, 2)]
        root = {"id": "root", "children": [*components, gap]}
        self.assertEqual(present_underfill(context(uf, gap, (root,)))[0].bridge_groups,
                         (("left", "right", "overlap"),))

    def test_gap_underfill_uses_recursive_non_uf_bounds_with_positive_z_overlap(self):
        uf, gap = underfill_gap([[(10, 0), (14, 0), (14, 10), (10, 10)]])
        nested = {"id": "wrapper", "children": [underfill_component("inner", 0, 0, 10, 10)]}
        touching_z = underfill_component("above", 14, 0, 24, 10, z=130)
        distant = underfill_component("distant", 100, 0, 110, 10)
        distant["bodies"].append({"id": "old-uf", "key": "uf", "material": "UF",
                                   "geometry": BoxGeometry([14, 0, 100], [24, 10, 100], 30).json()})
        support = underfill_component("support", 14, 0, 24, 10, key="carrier.panel")
        root = {"id": "root", "children": [nested, touching_z, distant, support, gap]}
        self.assertEqual(present_underfill(context(uf, gap, (root,)))[0].bridge_groups, (("wrapper",),))

    def test_gap_underfill_preserves_an_explicit_empty_relation(self):
        uf, gap = underfill_gap([[(10, 0), (14, 0), (14, 10), (10, 10)]])
        root = {"id": "root", "children": [gap]}
        self.assertEqual(present_underfill(context(uf, gap, (root,)))[0].bridge_groups, ((),))

    def test_polygon_underfill_only_uses_relations_in_a_recognized_gap_helper(self):
        uf, gap = underfill_gap([[(10, 0), (14, 0), (14, 10), (10, 10)]])
        variants = [{**gap, "key": "lsi"}, {**gap, "bumps": [bump()]},
                    {**gap, "children": [{"id": "child"}]},
                    {**gap, "bodies": [uf, {"id": "si", "geometry": box()}]}]
        for container in variants:
            with self.subTest(container=container):
                root = {"id": "root", "children": [container]}
                self.assertEqual([part.layout for part in present_underfill(context(uf, container, (root,)))],
                                 ["node"])
        self.assertEqual([part.layout for part in present_underfill(context(uf, gap))], ["node"])


if __name__ == "__main__":
    unittest.main()
