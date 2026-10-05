# Geometry Generators

This package owns versioned geometry generator implementations, their manifest
contract, registry, preview generation, and bounded materialization cache. It
does not import the API application.

Install it with `pip install -e packages/geometry_generators`. A new registry is
empty until generators are registered:

```python
from process_flow_geometry_generators import (
    GeometryGeneratorRegistry,
    register_builtin_generators,
)

registry = GeometryGeneratorRegistry()
register_builtin_generators(registry)
```

Register an additional implementation with `registry.register(generator)`. A
generator implements `definition()`, `validate(parameters)`, and
`evaluate(parameters)`; the latter returns `GeneratorEvaluation`. Each `(id,
version)` pair must be unique. Keep versions referenced by saved instances
registered so compilation can resolve their exact recipes.

SoC uses four fixed layers from bottom to top: Pass2 (5.625 um, `pass2`),
usg (2.89 um, `usg`), elk (1.315 um, `elk`), and si (200 um, `si`). Each layer
has editable `<layer>Thickness` and `<layer>Material` parameters. Thickness 0
omits that layer without leaving a gap; negative thickness and an all-zero stack
are invalid. The default stack is 209.83 um thick at 8000 x 10000 um, centered
on Z. SoC intentionally retains generator version 1: legacy single-box
`thickness`/`material` parameters are ignored on regeneration and replaced by
the four-layer defaults. Explicit new layer parameters take precedence, and saved
recipes retain zero thickness values. Existing static catalog geometry is updated
only when regenerated. VRM remains a separate single-box generator.
