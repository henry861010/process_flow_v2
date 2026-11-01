from __future__ import annotations

import copy
import unittest

from process_flow_kernel import BoxGeometry, PolygonGeometry
from process_flow_schematic import SchematicContext, geometry_bounds
from process_flow_steps.bump.schematic import present_schematic as present_bump
from process_flow_steps.layer.rdl_schematic import present_circuit, present_via
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


class StepPresenterTests(unittest.TestCase):
    def test_symbol_motifs_ignore_positive_density_and_zero_density_is_absent(self):
        for presenter, kind, expected_count in ((present_bump, "bump", 1),
                (present_via, "via", 9), (present_circuit, "circuit", 4)):
            with self.subTest(kind=kind):
                low = bump(density=1)
                high = bump(density=100)
                before = copy.deepcopy(low)
                low_part = presenter(context(low, kind=kind))[0]
                high_part = presenter(context(high, kind=kind))[0]
                self.assertEqual(low_part.primitives, high_part.primitives)
                self.assertEqual(len(low_part.primitives), expected_count)
                self.assertEqual(presenter(context(bump(density=0), kind=kind)), [])
                self.assertEqual(low, before)

    def test_bump_requests_horizontal_circle_repetition(self):
        part = present_bump(context(bump(), kind="bump"))[0]
        self.assertEqual(part.primitives[0].kind, "circle")
        self.assertTrue(part.primitives[0].repeat_x)

    def test_joined_bumps_own_only_overlapping_ancestor_symbols(self):
        source = bump()
        overlapping = {"id": "joined-die", "bumps": [bump("upper", box(thickness=6), "joined")]}
        other_layer = {"id": "other-layer", "bumps": [bump("other", box(z=10), "joined")]}
        touching = {"id": "touching", "bumps": [bump("touch", box(x=20), "joined")]}
        root = {"id": "root", "bumps": [source], "children": [overlapping, other_layer, touching]}
        part = present_bump(context(source, root, kind="bump"))[0]
        self.assertEqual(part.occluded_by, ("upper",))
        self.assertEqual(present_bump(context(overlapping["bumps"][0], overlapping, (root,), "bump"))[0].occluded_by, ())

    def test_polygon_holes_do_not_claim_joint_ownership(self):
        source = bump(geometry=PolygonGeometry([
            [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0]],
            [[5, 5, 0], [15, 5, 0], [15, 15, 0], [5, 15, 0]],
        ], 10).json())
        in_hole = bump("upper", BoxGeometry([7, 7, 0], [13, 13, 0], 6).json(), "joined")
        root = {"id": "root", "bumps": [source], "children": [{"id": "inside-hole", "bumps": [in_hole]}]}
        self.assertEqual(present_bump(context(source, root, kind="bump"))[0].occluded_by, ())

    def test_underfill_uses_bumped_components_including_dummy_and_other(self):
        uf = {"id": "uf-body", "key": "uf", "material": "UF", "geometry": box(thickness=3)}
        dummy = {"id": "dummy", "key": "wafer-dmy", "bumps": [bump()], "bodies": [uf]}
        other = {"id": "other", "bumps": [bump()]}
        dry = {"id": "no-bump", "key": "lsi", "bodies": []}
        gap = {"id": "gap", "bodies": [uf]}
        root = {"id": "root", "children": [dummy, other, dry, gap]}
        parts = present_underfill(context(uf, dummy, (root,)))
        self.assertEqual([part.layout for part in parts], ["node", "bridges"])
        self.assertEqual(parts[1].eligible_container_ids, ("dummy", "other"))
        self.assertEqual(present_underfill(context(uf, gap, (root,)))[0].eligible_container_ids, ("dummy", "other"))
        self.assertEqual(present_underfill(context(uf, dry)), [])

    def test_single_source_underfill_allows_bridges_between_its_representatives(self):
        uf = {"id": "uf-body", "material": "UF", "geometry": box(thickness=3)}
        lsi = {"id": "lsi", "key": "lsi", "bumps": [bump()], "bodies": [uf]}
        parts = present_underfill(context(uf, lsi))
        self.assertEqual(parts[1].eligible_container_ids, ("lsi",))


if __name__ == "__main__":
    unittest.main()
