# Mesh control sets

This package contains Python-authored mesh control sets. A set reads a
`ProcessGeometryState` and returns a complete canonical mesh-control document
plus human-readable details for the CDB form. It must not mutate its input.

To add a set, create a module under `process_flow_mesh_control/sets` with a class
implementing `definition()` and `build(state)`, then register one instance in
`MeshControlSetRegistry`. Definitions need unique `id` and non-empty `version`.
The result is `MeshControlSetResult(mesh_control=..., details=...)`. The API
validates `mesh_control` with the installed mesher contract before returning it.

`MeshModel1Set`, `MeshModel2Set`, and `MeshModel3Set` are independent
implementations. They start with the same geometry-aware Tim, adhesive, uBump,
and UF rules, but keep their constants and helper functions separate so each
model can tune control sizes without changing the others.

Without HBM, all three models use the first body keyed `soc.si` in geometry
DFS order for TD_UF sections. Section bounds and the minimum 110 um thickness
requirement use only that Si body; references and detail source IDs also point
to it. Other SoC layers and bumps do not extend the TD_UF range. If no `soc.si`
body exists, no noHBM TD_UF controls are generated, with no fallback to the
`soc` container. HBM takes priority, and the separate `TD_uBump` rule is unchanged.

All three models add a `Z_POINT` at `z_min + 10 um` for each body keyed
`carrier` whose bottom matches the lowest Z of all geometry features (bodies,
vias, circuits, and bumps), within `1e-9 um`. The point references the carrier
body by ID and uses a relative `z_min` offset of 10.
