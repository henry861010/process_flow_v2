# process-flow-schematic

Generic final-snapshot composition for cross-section previews. This package has
no dependency on the kernel, process steps, generators, API, CAD, or a UI runtime.

Installed producer packages register their companion `present_schematic(context)`
functions in a `SchematicRegistry`. The API is the composition root:

```python
registry = SchematicRegistry()
register_generator_presenters(registry)
register_step_presenters(registry)
document = compose_schematic(target_structure, registry)
```

Presenters receive recursively read-only mappings and tuples. They return local
rectangles, circles, paths, component hints, exclusions or relation eligibility;
they must not mutate geometry or recompute recipe thickness. Exact role matches
override generic feature-kind presenters. Duplicate selectors are rejected.
Presenter exceptions and invalid primitives fall back per node with a warning.

The composer groups equivalent subtrees using retained semantic roles, base
materials and current Z intervals. It ignores IDs, XY placement, density magnitude
and runtime material suffixes. Primitive coordinates are local fractions. Display
Z uses a shared monotonic piecewise transform, with a minimum height for thin
intervals; the document always includes unscaled physical Z and thickness values.
The SVG consumer understands only generic shapes, measurements and selection IDs.

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

Representation counts, feature motifs and relation eligibility are supplied by
the owning producer packages. No process program, die name or recipe is interpreted
here. JSON/CDB consumers continue using the unchanged physical structure.

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

`describe_schematic_components(structure, registry)` returns the selected physical
container IDs and producer hints using the same selection as composition. The
calling application owns cohort identity and bindings; this package never reads
flow definitions. Plans are immutable and reserve component X positions, widths,
and a support span. Missing cohorts leave blank slots, including for adjacency
checks, and do not add shapes or measurements. Z remains snapshot-specific.
Within one bound cohort, the first remaining physical instance supplies the
drawing. All current instance measurements remain available, and differing
structures produce a presentation note. An unbound current component retains
measurements and produces a warning rather than extending the reserved layout.
Omitting a plan preserves standalone composition.

Run the core tests from the repository root:

```bash
PYTHONPATH=packages/schematic-py/src venv/bin/python -m pytest packages/schematic-py/tests
```
