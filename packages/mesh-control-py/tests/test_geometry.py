from __future__ import annotations

import copy
import unittest

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control.geometry import belongs_to_subtree, select_upper_right, subtree_nodes

from mesh_control_fixtures import hbm, layout, soc


def positioned(node_id, x, y, *, width=10):
    return {"id": node_id, "xMin": x, "xMax": x + width, "yMin": y, "yMax": y + width}


class GeometrySelectionTests(unittest.TestCase):
    def test_x_precedes_y_and_y_breaks_x_ties_with_negative_coordinates(self):
        nodes = [positioned("upper-left", -40, 200), positioned("lower-right", -10, -50),
                 positioned("upper-right", -10, -20), positioned("last", -30, -30)]
        before = copy.deepcopy(nodes)
        self.assertIs(select_upper_right(iter(nodes)), nodes[2])
        self.assertEqual(nodes, before)
        self.assertIs(select_upper_right(nodes[:2]), nodes[1])

    def test_centers_determine_rank_instead_of_extents(self):
        nodes = [positioned("wide", -100, -100, width=200), positioned("right", 20, 20)]
        self.assertIs(select_upper_right(nodes), nodes[1])

    def test_exact_ties_keep_first_and_empty_or_unpositioned_nodes_return_none(self):
        first = positioned("first", 10, 20)
        second = {**first, "id": "second", "zMin": 999}
        self.assertIs(select_upper_right([first, second]), first)
        self.assertIsNone(select_upper_right([]))
        self.assertIsNone(select_upper_right([{"xMin": None, "xMax": None, "yMin": None, "yMax": None}]))
        self.assertIs(select_upper_right([{}, first]), first)

    def test_subtree_queries_include_nested_nodes_and_exclude_other_instances(self):
        state = ProcessGeometryState.from_structure(layout([hbm("a", -100, -100), soc("b", 50, 50)]))
        nodes = state.find_geometry()
        before = copy.deepcopy(nodes)
        index = {node["id"]: node for node in nodes if node["kind"] == "container"}
        selected = index["hbm:a"]
        subtree = subtree_nodes(nodes, index, selected)
        self.assertEqual(subtree[0]["id"], "hbm:a")
        self.assertTrue(all(belongs_to_subtree(node, "hbm:a", index) for node in subtree))
        self.assertFalse(any(node["id"] == "si:b" for node in subtree))
        self.assertEqual(
            [node["id"] for node in subtree_nodes(nodes, index, selected, kind="body", key="hbm.base_die")],
            ["die:base:a"],
        )
        self.assertEqual(subtree_nodes(nodes, index, None), [])
        self.assertFalse(belongs_to_subtree({"kind": "body", "containerId": "missing"}, "hbm:a", index))
        self.assertEqual(nodes, before)
