# Mesh control sets

This package contains Python-authored mesh control sets. A set reads a
`ProcessGeometryState` and returns a complete canonical mesh-control document
plus human-readable details for the CDB form. It must not mutate its input.

To add a set, create a module under `process_flow_mesh_control/sets` with a class
implementing `definition()` and `build(state)`, then register one instance in
`MeshControlSetRegistry`. Definitions need unique `id` and non-empty `version`.
The result is `MeshControlSetResult(mesh_control=..., details=...)`. The API
validates the complete document with the local uniform-coordinate contract
before returning it. Region controls are also resolved against the supplied geometry.

`MeshModel1Set`, `MeshModel2Set`, and `MeshModel3Set` each compose shared rules
in their own `build()` method. Their settings remain local to each model:
`TIM_SETTINGS`, `ADHESIVE_SETTINGS`, `HBM_UF_SETTINGS`, `SOC_UF_SETTINGS`,
`BUMP_ELEMENT_SIZE`, `CARRIER_OFFSET`, `LSI_SI_SECTION_COUNT`, and `GLOBAL_ELEMENT_SIZE`. Changing one
model's settings does not affect the others. A new set can reuse any subset of
the helpers below without adopting the numbered models' complete workflow.

## Geometry selection

All single representative selections use the XY bounding-box center, comparing
**X first, then Y**, with the greatest pair winning. Exact ties keep the first
node in DFS order; Z coordinates and IDs never affect rank. Selection consumes
the candidates once without sorting or modifying them. This replaces the old
DFS-first selection, which could reference a lower-left object removed by half
or quarter symmetry reduction.

The rule applies to HBM and SoC containers, the global `soc.si` and `lsi.si` bodies, bumps
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

All three models select the upper-right body keyed `lsi.si`, independently of
HBM/SoC presence, and append a reference `Z_SECTION_AVG` labeled `lsi_si` after
UF controls and before carrier points. Its complete `z_min` to `z_max` range
uses `elementSize = (zMax - zMin) / LSI_SI_SECTION_COUNT`, defaulting to five
equal sections without rounding. Details retain the resolved Z range and source
body ID. Missing targets add nothing; thickness at most `1e-9 um` adds only an
`omitted` detail. A zero-thickness representative does not fall back to another
LSI. The generator provides the `lsi.si` key; old untagged geometry must be
regenerated or explicitly tagged. `lsi.si_carrier` does not match generic
`carrier` point rules.

Only `meshModel2` also appends four reference `3D_REGION` Boxes for every
nonempty container keyed exactly `soc` or `hbm`, after all existing controls.
Container order remains DFS; corner centers follow `(xMin, yMin, zMax)`,
`(xMin, yMax, zMax)`, `(xMax, yMin, zMax)`, `(xMax, yMax, zMax)`.
Each axis extends 25 um on either side of its corner, producing a 50 x 50 x 50 um
Box with `elementSize = 5`. Model-local `TOP_CORNER_SETTINGS` controls
`half_extent` and `element_size`. Twenty SoCs add eighty controls.
Each Box references its container ID, with labels identifying key, ID and corner;
details include source IDs and resolved XYZ bounds. Bounds include all physical
descendant features; empty child containers do not affect them. An HBM uses its
whole container's top, and nested matching containers each receive four Boxes.
Boxes may extend outside the die and overlapping Boxes remain separate.

## Reusable functions

Import helpers directly from the following public modules. Each function has
typed arguments and an English docstring describing its inputs, outputs,
mutation behavior and relevant errors. All distances and sizes are in um.

| Module | Functions | Purpose |
| --- | --- | --- |
| `process_flow_mesh_control.geometry` | `select_upper_right`, `belongs_to_subtree`, `subtree_nodes` | Select representatives and query nested container trees without modifying geometry. |
| `process_flow_mesh_control.controls` | `append_full_feature_control`, `append_absolute_section`, `append_relative_z_point`, `build_mesh_control` | Build canonical controls and matching resolved details. |
| `process_flow_mesh_control.rules` | `append_tim_controls`, `append_adhesive_controls`, `append_hbm_uf_controls`, `append_soc_uf_controls`, `append_lsi_si_control`, `append_bottom_carrier_points`, `append_die_top_corner_controls` | Compose the existing domain rules with keyword parameter overrides. |

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
validates the canonical output with the per-method contracts described below before returning it.

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
API integration tests in `apps/api/tests/test_mesh_control_sets.py` validate
all three sets, HBM/noHBM layouts, and all four symmetry settings, preserving
selected sources and resolved Z ranges. Export integration tests verify raw
JSON delivery and sidecar retention when the worker rejects the new format.

## Uniform coordinate contract

Every `Z_SECTION_*`, `Z_POINT`, and `3D_REGION` control requires one
`coordinateMode: "reference" | "absolute"` covering all of its coordinates.
The envelope remains schema `1.0.0`, unit `um`, mesher `process_flow_2_5d`.
The local `validate_mesh_control(document, state=...)` validates the entire
contract; the installed mesher validator is not used by the API.

- Reference mode requires `reference`. Every coordinate is `{anchor, offset}`;
  the anchor must be the matching axis's `<axis>_min` or `<axis>_max`.
- Absolute mode forbids `reference`. Every coordinate is a finite JSON number.
- Old per-coordinate `mode`/`value` wrappers, mixed numeric/reference locations,
  missing coordinateMode and unsupported fields are rejected. There is no
  legacy-format migration or worker adapter.
- Z_POINT has `z` and no elementSize. Sections have startZ/endZ and elementSize.
  All controls require a non-blank label; element sizes must be positive.

```json
{
  "method": "Z_SECTION_AVG",
  "coordinateMode": "absolute",
  "label": "Focused Z range",
  "elementSize": 5,
  "startZ": 100,
  "endZ": 200
}
```

## 3D region controls

`3D_REGION` specifies an isotropic target element size inside a Box or
Z-extruded Polygon. For example:

```json
{
  "method": "3D_REGION",
  "coordinateMode": "reference",
  "label": "Focused silicon volume",
  "elementSize": 5,
  "reference": {"kind": "body", "key": "soc.si"},
  "region": {
    "type": "box",
    "min": {
      "x": {"anchor": "x_min", "offset": 0},
      "y": {"anchor": "y_min", "offset": 0},
      "z": {"anchor": "z_min", "offset": 0}
    },
    "max": {
      "x": {"anchor": "x_max", "offset": 0},
      "y": {"anchor": "y_max", "offset": 0},
      "z": {"anchor": "z_max", "offset": 0}
    }
  }
}
```

References use `root`, `container`, `body`, `via`, `circuit`, or `bump` kinds;
keys are allowed only for containers/bodies. Key and id filters are intersected.
Each matched region reference resolves independently. Container bounds include
physical features in descendants, ignoring empty containers. References supply
coordinates only: regions are not clipped to the reference or its material.
Absolute regions resolve once and do not look up a reference.

Polygon regions use `type: "polygon"`, `loops: [[{x: location, y: location}, ...]]`,
`startZ: location`, and `endZ: location`. Their entire XY/Z description follows
the control's selected coordinateMode. Loops follow the existing geometry
nesting/hole rules. Invalid bounds, degenerate polygons, crossing/touching loops,
and missing or empty region references are errors rather than omitted controls.

`validate_region_control()` validates syntax; `resolve_region_control()` returns
one canonical primitive and XYZ bounds per match without modifying its input.
`append_region_control(..., coordinate_mode=..., reference=...)` appends detached
authoring data and detail summaries. Omit reference in Absolute mode. Details
retain their Z fields and optionally add
`resolvedRegions: [{sourceId?, bounds: {xMin, xMax, yMin, yMax, zMin, zMax}}]`.
Absolute set rules retain their source IDs in details, not as control references.

The built-in `meshControl3dTest` set (version `1.0.0`, label `3D region test`)
returns a Reference Box and an Absolute triangle covering the root's Z range,
both at size 5, with global size 500 and full symmetry. It requires non-empty XYZ
bounds and does not depend on domain-specific semantic keys.

CDB jobs write the original new-format JSON sidecars, then pass the complete
unmodified input to the worker. The installed mesher currently rejects the new
coordinateMode contract, including Z-only controls. These jobs may fail; both
JSON sidecars are retained. Mesher support is a separate follow-up.
