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
