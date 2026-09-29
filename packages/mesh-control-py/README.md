# Mesh control sets

This package contains Python-authored mesh control sets. A set reads a
`ProcessGeometryState` and returns a complete canonical mesh-control document
plus human-readable details for the CDB form. It must not mutate its input.

To add a set, create a module under `process_flow_mesh_control/sets` with a class
implementing `definition()` and `build(state)`, then register one instance in
`MeshControlSetRegistry`. Definitions need unique `id` and non-empty `version`.
The result is `MeshControlSetResult(mesh_control=..., details=...)`. The API
validates `mesh_control` with the installed mesher contract before returning it.

`HbmExampleSet` demonstrates resolving real body boundaries without creating
gap bodies. Its element sizes are illustrative and are **not** an approved mesh
standard. It accepts only the standalone HBM generator v2 structure.
