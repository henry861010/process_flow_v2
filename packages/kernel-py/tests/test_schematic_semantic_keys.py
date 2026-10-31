from __future__ import annotations

import copy
import subprocess
import sys
import unittest

from process_flow_kernel import BODY_KEYS, ProcessGeometryState, ProcessStepContext, normalize_geometry_structure
from process_flow_kernel.application.material_instances import rewrite_geometry_materials
from process_flow_steps.layer.rdl import execute as execute_rdl
from process_flow_steps.uf.under_fill import execute as execute_underfill


def context(state, values):
    return ProcessStepContext(state=state, values=values, raw_parameter_values=values,
        step_ref={}, step_template={}, step_configuration={}, geometry_inputs={},
        input_geometry=None, geometry_resolver=lambda _: None)


def layer_state(key=None):
    state = ProcessGeometryState.create()
    state.initialize_box_layer(material="Poly", bottom_left=[0, 0, 0],
                               top_right=[20, 20, 0], thickness=10, key=key)
    return state


class SchematicSemanticKeyTests(unittest.TestCase):
    def test_normal_step_execution_does_not_load_schematic(self):
        result = subprocess.run([sys.executable, "-c", "\n".join((
            "import sys",
            "from process_flow_kernel import ProcessGeometryState, ProcessStepContext",
            "from process_flow_steps.layer.rdl import execute",
            "state = ProcessGeometryState.create()",
            "state.initialize_box_layer(material='Si', bottom_left=[0,0,0], top_right=[10,10,0], thickness=10)",
            "values = {'layers':[{'Dielectric':'PI','Conductivity':'Cu','thk':2,'density':50}]}",
            "context = ProcessStepContext(state, values, values, {}, {}, {}, {}, None, lambda _: None)",
            "execute(context)",
            "assert not any(name.startswith('process_flow_schematic') for name in sys.modules)",
            "assert not any('schematic' in name for name in sys.modules if name.startswith('process_flow_steps'))",
        ))], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_producer_steps_tag_actual_bodies(self):
        state = layer_state()
        execute_rdl(context(state, {"layers": [
            {"Dielectric": "PI", "Conductivity": "Cu", "thk": 2, "density": 30},
            {"Dielectric": "PI", "Conductivity": "Cu", "thk": 3, "density": 60},
        ]}))
        self.assertEqual([node.get("key") for node in state.to_geometry_structure()["root"]["bodies"]],
                         [None, "rdl", "rdl"])

        main = layer_state()
        for x in (0, 12):
            die = layer_state()
            die.add_bump_above_cursor(material="SnAg", density=40, thickness=2,
                                      direction="+z", stage="reflowed")
            die.flip_around_z()
            main.place_geometry_state(die, x=x, y=0, bottom_z=10, key="dram")
        execute_underfill(context(main, {"material": "UF-A", "thk": 4, "gap": 2}))
        structure = main.to_geometry_structure()
        uf_bodies = [node for child in structure["root"]["children"]
                     for node in child["bodies"] if node["material"] == "UF-A"]
        self.assertGreaterEqual(len(uf_bodies), 2)
        self.assertTrue(all(node["key"] == "uf" for node in uf_bodies))

    def test_roles_survive_clone_rewrite_pnp_flip_grind_and_serialization(self):
        self.assertTrue({"rdl", "uf"} <= BODY_KEYS)
        for key in ("rdl", "uf"):
            with self.subTest(key=key):
                state = layer_state(key)
                original = copy.deepcopy(state.to_geometry_structure())
                cloned = state.clone()
                rewritten, _ = rewrite_geometry_materials(cloned.to_geometry_structure(), {"Poly": "Poly_dup2"})
                self.assertEqual(rewritten["root"]["bodies"][0]["key"], key)
                self.assertEqual(rewritten["root"]["bodies"][0]["material"], "Poly_dup2")
                assembly = layer_state()
                assembly.place_geometry_state(ProcessGeometryState.from_structure(rewritten), x=5, y=5,
                                              bottom_z=10, key="lsi")
                assembly.flip_around_z()
                assembly.grind_to(z=5)
                output = normalize_geometry_structure(assembly.to_geometry_structure())
                body = output["root"]["children"][0]["bodies"][0]
                self.assertEqual(body["key"], key)
                self.assertEqual(body["geometry"]["thk"], 5)
                self.assertEqual(state.to_geometry_structure(), original)
                self.assertEqual(ProcessGeometryState.from_structure(output).to_geometry_structure(), output)


if __name__ == "__main__":
    unittest.main()
