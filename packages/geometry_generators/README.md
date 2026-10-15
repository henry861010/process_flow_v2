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

LSI v1 selects `gen1`, `gen2`, or `gen2-bs-first` (shown as `gen2 (bs-first)`)
with the `generation` parameter. Gen1 stacks
Si, USG, and FsPm0 from bottom to top; Gen2 stacks DAF, BsPm0, Si, USG, PrePm0,
FsPm0, Fow, and Si carrier. Gen2 (bs-first) replaces DAF and BsPm0 with a
micro bump below Si and omits BsVia0. Each layer has editable `<prefix>Material` and
`<prefix>Thickness` parameters (`si`, `usg`, `fsPm0`, `daf`, `bsPm0`, `prePm0`,
`fow`, `siCarrier`). The default totals are 241.5 and 491.5 um. DAF, Fow, and
Si carrier defaults are provisional (DAF/10 um, Fow/10 um, Si/200 um).

The bs-first micro bump is a full-footprint Box density region in `root.bumps`,
with id `bump:lsi-micro-bump`, direction `-z`, and fixed stage `reflowed`. Its
top touches the Si bottom. Editable `microBumpMaterial`, `microBumpThickness`
(Height), `microBumpDensity`, and `microBumpKoz` default to Cu/Ni/SnAg, 28 um,
42%, and 0 um. Material is trimmed and must be nonempty; height and KOZ must be
finite and nonnegative; density must be finite and within 0–100%. A zero-height
bump is retained. Its height contributes to the centered stack's total thickness,
which defaults to 494.5 um.

LSI adds full-footprint Box density vias in the root scope. `fsVia0*` is shared
by all three variants; `bsVia0*` is original Gen2-only. Each has Material, Thickness (shown
as Height), and Density parameters. Defaults are Cu/26 um/50% for the front and
Cu/15 um/50% for the back. The front via starts at the USG top with direction
`+z`, bounded by FsPm0 in Gen1 and PrePm0 + FsPm0 in both Gen2 variants. The back via starts
at the Si bottom with direction `-z`, bounded by BsPm0. Heights are independent;
exceeding a host span returns a field error without clamping. Zero thickness or
height retains the body or via. Total thickness sums bodies plus the bs-first
bump, without double-counting vias, with the stack centered on Z.
`box-rescale@1` adapts bodies, vias, and bumps together. Si carrier uses
body key `carrier`; DAF uses `daf`. Conditional draft fields retain their values
across generation switches but are excluded from normalized recipes when hidden.
`visibleWhen` supports mutually exclusive `equals` or nonempty `in` operators;
PrePm0, Fow, and Si carrier are visible in both Gen2 variants.
This directly updates v1; old `bsmc*`,
`lsiTopMolding*`, and numbered `layer1*`–`layer4*` parameters are rejected without
migration. Full defaults are documented in
[`geometry-generator.md`](../../docs/ui/components/geometry-generator.md).

All built-in generators accept finite thickness values greater than or equal to
0, including DRAM buildup layer thicknesses and all three LSI variants. LSI via
heights must also fit their host layer spans. Their
manifests use an inclusive minimum of 0. DRAM package thickness must still
contain its substrate and occupied die stack; a zero package thickness requires
all internal thicknesses and die gaps to be zero.

Wafer carrier (`wafer-carrier` v1), panel carrier (`panel-carrier` v1), and frame
(`frame` v1) are available in the template geometry library and flow input
pickers. They use the existing catalog categories, entity types, and semantic
keys, with one root-direct body centered on XYZ:

| Generator | Editable parameters and defaults (um) | Root / body key | Shape / adapter |
| --- | --- | --- | --- |
| `wafer-carrier` | `diameter`: 300000, `carrierThickness`: 775, `carrierMaterial`: `Si` | `carrier.wafer` / `carrier` | Cylinder / `rigid@1` |
| `panel-carrier` | `packageX`: 510000, `packageY`: 515000, `carrierThickness`: 700, `carrierMaterial`: `glass` | `carrier.panel` / `carrier` | Box / `box-rescale@1` |
| `frame` | `diameter`: 350000, `tapeThickness`: 80, `tapeMaterial`: `tape` | `frame` / `frame` | Cylinder / `rigid@1` |

Diameter and X/Y must be finite and positive; thickness must be finite and
nonnegative, with zero retaining the body. Numeric strings and booleans are
invalid. Materials are trimmed and must be nonempty. Frame represents only
the circular tape; it does not include an outer frame. Preview supplies Top View,
Cross Section, and computed `packageX`, `packageY`, and `totalThickness`.
Carrier bond/debond and frame mount/demount consume the generated keys directly.
Flow bindings save normalized versioned recipes without creating catalog records;
the existing catalog fixtures remain available.
