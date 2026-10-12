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
omits that layer without leaving a gap; an all-zero stack is also valid.
Negative thickness is invalid. The default stack is 209.83 um thick at 8000 x 10000 um, centered
on Z. SoC intentionally retains generator version 1: legacy single-box
`thickness`/`material` parameters are ignored on regeneration and replaced by
the four-layer defaults. Explicit new layer parameters take precedence, and saved
recipes retain zero thickness values. Existing static catalog geometry is updated
only when regenerated. VRM remains a separate single-box generator.

DMY die (`wafer-dmy` v1, category `die.wafer-dmy`) builds one Si dummy die
for wafer-edge placement to control warpage. Its editable `siThickness` and
`siMaterial` default to 200 um and `si`, grouped under `si`. It uses an
8000 x 10000 um preview footprint centered on XYZ and `box-rescale@1` for PnP
rectangle or polygon targets. The root key is `wafer-dmy`; its sole body key
is `wafer-dmy.si`. Zero thickness retains that body. It is available only in
the template geometry library and flow input pickers, with no Home or Management
entry or catalog fixture. Placement positions and counts remain flow/PnP inputs;
the generator does not arrange dies automatically or calculate warpage.

All built-in generators accept finite thickness values greater than or equal to
0, including DRAM buildup layer thicknesses and both LSI generations. Their
manifests use an inclusive minimum of 0. DRAM package thickness must still
contain its substrate and occupied die stack; a zero package thickness requires
all internal thicknesses and die gaps to be zero.
