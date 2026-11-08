# process-flow-schematic

Semantic scene planning and final-snapshot composition for cross-section previews. This package has
no dependency on the kernel, process steps, generators, API, CAD, or a UI runtime.

The schematic kernel owns the full-flow horizontal layout. Producers declare
objects, regions and relationships; they do not assign global coordinates or
choose built-in representative counts. Physical execution remains the only
source of actual Z, thickness, material, density and surviving geometry.

## Scene contract

`scene.py` defines immutable dataclasses and validates the complete graph:

- `SchematicObject` (`SceneObject`) records logical identity, role, source reference,
  class/cohort identity, parent, local symbol/version, color role/override and anchors.
  Its layout intent is `group`, `member`, `span`, `distributed` or `boundary`.
- `LayoutRegion` (`SceneRegion`) names an assembly's mounting surface or local
  display region. `AnchorSpec` distinguishes physical faces from region boundaries.
- `SceneRelation` expresses attachment, connection, containment, exclusion,
  fill, surrounding and coverage with typed object/region references.
- `SceneState` contains the immutable objects, regions, relationships, symbolic
  cursor region, orientation, assembly phase, derivations and notes.
- `SchematicDelta` creates, replaces, removes or reparents objects, changes
  relationships/regions and records port-qualified `SceneDerivation` lineage.
  Regions and relations support explicit add/update/remove operations; a region
  anchor can change while retaining its identity and horizontal reservation.
  `apply_delta` applies the update atomically and rejects invalid references or cycles.
- `PhysicalSample` and `ResolvedPhysicalData` bind the selected snapshot to logical
  objects. Multiple sources retain their individual thickness and density values.

Object identity, physical source identity and representative cohort identity are
separate. Different PnP batches have different cohorts even for the same source
class; physical placement count does not create more schematic representatives.
Structural composites such as HBM retain one representative with their internal
subtree. An `arranged` composite can own regions with separately arranged children.

## Full-flow planning

`flow.plan_flow` accepts flow nodes and resource/parameter/description callbacks.
The application resolves catalog or generator resources and registers step
descriptors; the package traverses dependencies deterministically, applies
semantic deltas and plans all known states in each assembly phase. It does not
invoke future step execution, calculate future exact thickness, or keep copied
physical geometry in the scene.

`make_scene_layout_plan` reserves member slots across the complete phase history,
including future members and subsequently removed members. Ordinary region members use
equal widths and spacing; arranged composites can grow to fit their local regions.
The central `representation_for_role` policy gives
`wafer-dmy` two edge representatives and every other built-in role one, including
LSI. The dummy pair sits near the region's outer edges, reflecting its
wafer-warpage control role. A small outer rim (36 display units by default)
remains empty on each side and excludes distributed features. Free distributed
features occupy the space between the dummies; member and feature clearance is
reserved inside the pair. The physical placement count and density magnitude
do not alter this policy.

Distributed features receive fixed positions in the remaining region intervals,
after future member slots have been reserved. A TIV density envelope therefore
does not draw illustrative pillars through an LSI slot. Local features remain
inside their structural component; attached features can occupy their target
span. Boundary objects produce two intervals with one logical identity, while
span and fill relations define the covered and excluded intervals. The solver
contains no process-name branches.

Missing recipes, parameters, resources or descriptors stop only that lookahead
path and add a note. A contradictory region layout affects only its assembly
phase and uses an explicitly noted local fallback; other phases keep their plans.
Valid earlier previews remain usable. Unknown physical
survival after grind/saw is resolved by the actual selected snapshot. A malformed
current binding uses a visible local layout with a warning rather than hiding
the current component. Layout identity is stable within a flow revision and
assembly phase; vertical display mapping and viewport fitting remain per snapshot.

`flow.bind_flow_snapshots` consumes execution provenance qualified by source kind,
owner, output/input ports and node ID, plus creation operation/ordinal. It follows
semantic derivations across copied subtrees without matching appended child
positions. New batch-created children bind by their physical parent scope before
creation-ordinal fallback, so repeated instances stay in their own target cohorts.
This metadata is separate from serialized geometry, geometry hashes
and JSON/CDB export payloads.

Saw crops one output assembly and tags its root as CoW. Its descriptor preserves
crop lineage and opens a local arranged component phase. Imported CoW components
can request `ComponentHint.nesting="arranged"` to preserve their internal members.
TIM1/TIM2 declare coating attachment to CoW/lid targets; actual bounds and material
come from the executed snapshot. Multi-output saw and ring/lid producer modules
remain future work.

## Snapshot composition

Producers can set `diagram_label` on a `ComponentHint` or `SchematicPart` to opt
that object into the viewer's default diagram labels. Both composition paths
carry it as optional `diagramLabel` on document components/items; unmarked
objects keep their inspection names without adding diagram text. Source scenes
preserve this intent on `SchematicObject.diagram_label`.

Installed producer packages register their companion `present_schematic(context)`
functions in a `SchematicRegistry`. The API is the composition root:

```python
registry = SchematicRegistry()
register_generator_presenters(registry)
register_step_presenters(registry)
document = compose_schematic(target_structure, registry)
```

Presenters receive recursively read-only mappings and tuples. They return local
rectangles, circles, paths, semantic component roles, exclusions or relation eligibility;
they must not mutate geometry or recompute recipe thickness. Exact role matches
override generic feature-kind presenters. Duplicate selectors are rejected.
Presenter exceptions and invalid primitives fall back per node with a warning.

The composer groups equivalent subtrees using retained semantic roles, base
materials and current Z intervals. It ignores IDs, XY placement, density magnitude
and runtime material suffixes. Primitive coordinates are local fractions. Display
Z uses a shared monotonic piecewise transform, with a minimum height for thin
intervals; the document always includes unscaled physical Z and thickness values.
The SVG consumer understands only generic shapes, measurements and selection IDs.

Both composition paths use a fixed Z display tolerance of `0.001 um`. Physical
and declared presenter display boundaries are sorted and clustered against each
cluster's lowest Z, so a chain of nearby boundaries cannot accumulate a larger
merge. Only spans strictly below the tolerance merge; a four-ULP safety margin
keeps translated differences numerically equal to `0.001 um` distinct. The two
surfaces of any positive physical layer never merge, including computed layers
thinner than the tolerance. Interpolation through a merged span is flat and the
shared transform remains monotone for shapes, component bounds, clips and anchors.
Remaining intervals retain the square-root height transform, clamped to 10–110
display units. This affects presentation only: physical Z, thickness, total
thickness, geometry hashes and the v1 document schema are unchanged.

Circle primitives may set `repeat_x=True` (default `False`) to fill their display
rectangle with an equally spaced row; this requires a positive radius and ignores
`cx`. The composer uses radius `min(r * display_height, display_width / 2.8)` and
target pitch `1.4 * diameter`, fits at least one circle, and centers each circle in
an equal-width cell. Repetition precedes clipping, so exclusions retain the row's
spacing. It emits ordinary circle shapes without changing document schema version 1.

Path primitives also support `repeat_x=True`: normalized points define one motif,
and `r` supplies its target half-width relative to display height. Repeated paths
are emitted as ordinary path shapes. Parts from the same emitting node may share
a `repeat_group` to use the largest requested radius for a common count and pitch;
path widths match, while circles retain their individual radii.

A part may reference a physical node using `source_id` for material, source IDs,
Z, thickness and density measurements. Its optional `display_bounds` controls placement
relative to the emitting node's component without modifying physical geometry.
Component grouping includes presentation differences and referenced measurement
properties while ignoring source IDs, absolute XY and runtime material suffixes.

Relation parts may supply `bridge_groups`, a tuple of current physical container-ID
tuples. Each inner tuple describes one connected physical fill region; separate
regions never create bridges between them. Producers resolve physical contact and
holes; the composer has no geometry-engine dependency. Every physical instance maps
to its representative cohort, including instances other than the first one drawn.
Only adjacent occupied slots of different cohorts in the same mounting region can
receive a bridge; overlapping slots in other regions do not interrupt that adjacency. Bridges are bounded by
the fill and both physical/representative Z intervals. Nonadjacent, merged or missing
endpoints retain their source measurements and a connection note without crossing
other components or reserved empty slots. An empty/singleton inner tuple records a
retained region without inventing a second endpoint. Legacy `eligible_container_ids`
remains available to callers that declare only illustrative adjacency.

`SchematicItem` may include `densityValues` for bump, via and circuit features.
The composer collects density from each unique physical source ID, removes
duplicates, and sorts numeric percentages ascending with `null` last. A missing
density remains `null`; zero remains `0`, and no average or display-motif count is
used. Body items omit this field. Values use the original percentage scale
(`0` through `100`), and API validation rejects non-finite or out-of-range values.
The optional field preserves compatibility with documents that omit it and does
not change schema version 1; the presentation version changes to invalidate
cached documents. Paired PnP bump parts each retain the measurements of their
own referenced `source_id`.

Consumers can use these measurements in a read-only feature review card showing
the component, full feature name, material, actual snapshot thickness and, where
applicable, distinct density values. Missing density is shown as `Not specified`.
The values describe the physical snapshot, including grinding results, while
representation counts and grouping remain unchanged.

Local feature motifs and actual contact eligibility are supplied by the owning
producer packages. Shared layout and built-in representation counts are owned by
this package; producers do not decide global X positions. JSON/CDB consumers
continue using the unchanged physical structure.

Applications can reserve a common horizontal layout for several snapshots:

```python
groups = [SchematicLayoutGroup("assembly-die", ComponentHint("Die"))]
plan = make_layout_plan(groups, fingerprint="shared-layout-identity")
document = compose_schematic(
    target_structure, registry,
    layout_plan=plan,
    component_bindings={"physical-container-id": "assembly-die"},
)
```

`describe_schematic_components(structure, registry)` remains available for low-level
snapshot callers. `describe_source_scene` adapts sources to the new semantic graph;
the flow planner owns cohort identity and binding. Plans are immutable and reserve component X positions, widths,
and a support span. Missing cohorts leave blank slots, including for adjacency
checks, and do not add shapes or measurements. Z remains snapshot-specific.
Within one bound cohort, the first remaining physical instance supplies the
drawing. All current instance measurements remain available, and differing
structures produce a presentation note. An unbound current component retains
its drawing and measurements through a warned local-layout fallback for that assembly.
Omitting a plan preserves standalone composition.

Standalone composition and local fallback use `make_layout_plan` as a compatibility
adapter to the same semantic scene solver; there is no separate flat coordinate
algorithm. Legacy `ComponentHint` values without a semantic role can retain their
explicit count/edge policy (capped at 12). New producers declare a role and use
the central representation policy instead.

Run the core tests from the repository root:

```bash
PYTHONPATH=packages/schematic-py/src venv/bin/python -m pytest packages/schematic-py/tests
```
