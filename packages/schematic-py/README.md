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

Representation counts, feature motifs and relation eligibility are supplied by
the owning producer packages. No process program, die name or recipe is interpreted
here. JSON/STEP/CDB consumers continue using the unchanged physical structure.

Run the core tests from the repository root:

```bash
PYTHONPATH=packages/schematic-py/src venv/bin/python -m pytest packages/schematic-py/tests
```
