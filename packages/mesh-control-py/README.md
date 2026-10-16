# Mesh control sets

This package contains Python-authored mesh control sets. A set reads a
`ProcessGeometryState` and returns a complete canonical mesh-control document
plus human-readable details for the CDB form. It must not mutate its input.

To add a set, create a module under `process_flow_mesh_control/sets` with a class
implementing `definition()` and `build(state)`, then register one instance in
`MeshControlSetRegistry`. Definitions need unique `id` and non-empty `version`.
The result is `MeshControlSetResult(mesh_control=..., details=...)`. The API
validates `mesh_control` with the installed mesher contract before returning it.

`MeshModel1Set`, `MeshModel2Set`, and `MeshModel3Set` each compose shared rules
in their own `build()` method. Their settings remain local to each model:
`TIM_SETTINGS`, `ADHESIVE_SETTINGS`, `HBM_UF_SETTINGS`, `SOC_UF_SETTINGS`,
`BUMP_ELEMENT_SIZE`, `CARRIER_OFFSET`, and `GLOBAL_ELEMENT_SIZE`. Changing one
model's settings does not affect the others. A new set can reuse any subset of
the helpers below without adopting the numbered models' complete workflow.

## Geometry selection

All single representative selections use the XY bounding-box center, comparing
**X first, then Y**, with the greatest pair winning. Exact ties keep the first
node in DFS order; Z coordinates and IDs never affect rank. Selection consumes
the candidates once without sorting or modifying them. This replaces the old
DFS-first selection, which could reference a lower-left object removed by half
or quarter symmetry reduction.

The rule applies to HBM and SoC containers, the global `soc.si` body, bumps
inside the selected container subtree, and base/top die representatives inside
the selected HBM. HBM has priority. If the selected HBM has no bump, the bump
rule falls back to the selected SoC, rather than choosing another HBM.

`state.find_geometry()` returns detached summaries with serialized structure
IDs, kind/key/material, parent/container IDs, and `xMin`, `xMax`, `yMin`, `yMax`,
`zMin`, `zMax` in um. Container XY bounds include all descendant features.
Empty containers have `None` XY bounds and are ignored by position selection;
an empty candidate set returns `None`. Box, polygon, cylinder and cone bounds
are supplied by the kernel. Queries retain DFS order and cannot mutate state.

Without HBM, all three models use the selected body keyed `soc.si` for TD_UF
sections, even if it has no enclosing container keyed `soc`. Section bounds and the minimum 110 um thickness
requirement use only that Si body; references and detail source IDs also point
to it. Other SoC layers and bumps do not extend the TD_UF range. If no `soc.si`
body exists, no noHBM TD_UF controls are generated, with no fallback to the
`soc` container. HBM cores retain ordering by Z, numeric key suffix, and DFS
order. The default SoC surface/transition zone thicknesses are 50/60 um.

Tim and adhesive controls still apply to every matching body, in DFS order.
All three models add a `Z_POINT` at `z_min + 10 um` for each body keyed
`carrier` whose bottom matches the lowest Z of all geometry features (bodies,
vias, circuits, and bumps), within `1e-9 um`. The point references the carrier
body by ID and uses a relative `z_min` offset of 10.

## Reusable functions

Import helpers directly from the following public modules. Each function has
typed arguments and an English docstring describing its inputs, outputs,
mutation behavior and relevant errors. All distances and sizes are in um.

| Module | Functions | Purpose |
| --- | --- | --- |
| `process_flow_mesh_control.geometry` | `select_upper_right`, `belongs_to_subtree`, `subtree_nodes` | Select representatives and query nested container trees without modifying geometry. |
| `process_flow_mesh_control.controls` | `append_full_feature_control`, `append_absolute_section`, `append_relative_z_point`, `build_mesh_control` | Build canonical controls and matching resolved details. |
| `process_flow_mesh_control.rules` | `append_tim_controls`, `append_adhesive_controls`, `append_hbm_uf_controls`, `append_soc_uf_controls`, `append_bottom_carrier_points` | Compose the existing domain rules with keyword parameter overrides. |

Append helpers modify only the supplied `controls` and `details` output lists.
Geometry selection returns references to the detached summaries, not mutable
state objects. `build_mesh_control()` deep-copies the control list into a new
canonical document. Contract validation remains owned by the installed mesher;
these helpers do not duplicate its schema or require mesher as a dependency.

`append_absolute_section()` records ranges of length at most `1e-9 um` as
`status: "omitted"` details without adding controls. HBM/SoC rules skip inverted
ranges before calling it. SoC requires positive zone thicknesses and raises
`MeshControlSetNotApplicable` when the Si thickness is less than one surface
plus one transition zone. Each generated control retains its matching label,
resolved Z range and `sourceIds` in details.

## Write and register a custom set

This complete example combines Tim/adhesive controls with custom noHBM Si zones
and a point 3 um below the selected Si top. The Si body can be nested anywhere.
The output remains editable through the existing API/CDB form.

```python
from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetRegistry, MeshControlSetResult
from process_flow_mesh_control.controls import build_mesh_control, append_relative_z_point
from process_flow_mesh_control.geometry import select_upper_right
from process_flow_mesh_control.rules import (
    append_tim_controls,
    append_adhesive_controls,
    append_soc_uf_controls,
)


class CustomSiSet:
    def definition(self) -> dict:
        return {
            "id": "customSi",
            "version": "1",
            "label": "Custom Si",
            "description": "Custom Tim, adhesive and Si zone controls.",
        }

    def build(self, state: ProcessGeometryState) -> MeshControlSetResult:
        bodies = state.find_geometry(kind="body")
        controls, details = [], []
        has_metal_tim = append_tim_controls(
            controls, details, bodies, metal_element_size=200,
        )
        append_adhesive_controls(
            controls, details, bodies, has_metal_tim=has_metal_tim,
            non_metal_tim_element_size=15,
        )
        si = select_upper_right(body for body in bodies if body["key"] == "soc.si")
        if si is not None:
            append_soc_uf_controls(
                controls, details, si, set_id="customSi",
                surface_thickness=20, transition_thickness=30,
                surface_element_size=2, transition_element_size=10,
                middle_element_size=40,
            )
            append_relative_z_point(
                controls, details, si, label="Si top -3",
                anchor="z_max", offset=-3,
            )
        return MeshControlSetResult(
            mesh_control=build_mesh_control(controls, global_element_size=250),
            details=details,
        )


# Passing an explicit tuple replaces the default registry entries.
registry = MeshControlSetRegistry(sets=(CustomSiSet(),))
# Given a ProcessGeometryState named state:
# definition, result = registry.apply("customSi", state)
```

To expose the set alongside the built-ins, add a `CustomSiSet()` instance to
the registry's default tuple. `MeshControlSetRegistry.apply()` verifies that
neither geometry nor process inspection state was changed. The existing API
validates the canonical output with the mesher contract before returning it.

For subtree rules, index containers by ID once, then compose queries:

```python
from process_flow_mesh_control.geometry import subtree_nodes

nodes = state.find_geometry()
containers = {node["id"]: node for node in nodes if node["kind"] == "container"}
hbm = select_upper_right(node for node in containers.values() if node["key"] == "hbm")
bump = select_upper_right(subtree_nodes(nodes, containers, hbm, kind="bump"))
```

## Validation

Run `venv/bin/python -m unittest discover -s packages/mesh-control-py/tests` from
the repository root for helper, model and custom-set tests. Kernel XY query
tests live in `packages/kernel-py/tests/test_mesh_control_geometry_query.py`.
API integration tests in `apps/api/tests/test_mesh_control_sets.py` also build
actual meshes for all three sets, HBM/noHBM layouts, and all four symmetry modes,
checking retained references and Z refinement against meshes without controls.
