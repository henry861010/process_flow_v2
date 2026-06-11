# Geometry Kernel API

## 1. Purpose

This document defines the target Geometry Kernel API for process-step authors,
kernel maintainers, and application developers.

The API described here is a forward-looking design contract. It is not a
description of the current implementation. The goal is to make process steps
easy to write while keeping the geometry model correct, object-oriented, and
safe to serialize.

The most important rule is:

> Process-step code operates through `ProcessGeometryState`. It does not mutate
> raw object properties, does not reach into private fields, and does not
> manipulate `Container`, `Body`, `Via`, `Circuit`, or `Bump` directly.

## 2. Design Goals

1. Keep object boundaries strict.
   Every mutation must go through a public method. Code outside a class must not
   write private or internal fields such as `_cursorZ`, `_container`, or
   `_processFootprint`.

2. Make process steps easy to write.
   A process-step author should be able to initialize a wafer, deposit molding,
   add RDL, place dies, or add bumps by calling high-level methods on a state
   object.

3. Treat `cursorZ` as process runtime state.
   `cursorZ` is the current process plane. It is not necessarily the maximum Z
   value of the whole geometry tree.

4. Make the process footprint explicit.
   Full-area operations such as molding or dielectric deposit use an explicit
   runtime footprint. The kernel should not repeatedly guess the footprint from
   existing bodies.

5. Keep the serialized structure simple.
   Persisted geometry remains a global-coordinate container tree. It does not
   store local transforms, parent references, or runtime process cursors.

6. Hide low-level model construction from process authors.
   Process authors should not create `Body`, `Via`, `Circuit`, `Bump`, or raw
   `Container` objects. They should pass geometry parameters to
   `ProcessGeometryState` methods.

7. Keep advanced kernel objects available to kernel maintainers.
   The kernel may still use domain model objects internally, but those objects
   must protect their invariants through public methods.

## 3. Conceptual Layers

| Layer | Main Objects | Primary Users | Responsibility |
| --- | --- | --- | --- |
| Process runtime API | `ProcessGeometryState` | Process-step authors | Build and mutate geometry through process-friendly methods. |
| Geometry domain model | `Container`, `Body`, `Via`, `Circuit`, `Bump` | Kernel maintainers | Represent the container tree and scoped geometry features. |
| Geometry primitives | `BoxGeometry`, `CylinderGeometry`, `PolygonGeometry`, `ConeGeometry` | Kernel maintainers, advanced APIs | Represent primitive solid envelopes. |
| Serialization boundary | `GeometryStructure` | Kernel runtime, repositories, apps | Save and load immutable geometry payloads. |
| Application layer | `GeometryKernel`, repositories, viewers, exporters | UI and app developers | Execute process flows, preview results, export geometry. |

## 4. Core Mental Model

`ProcessGeometryState` represents a mutable runtime geometry state for one
process step or one resolved geometry input.

It owns:

- a root geometry scope
- a process cursor plane, exposed as `cursorZ()`
- an optional process footprint used by full-area operations
- the current geometry tree

It outputs:

- a normalized `GeometryStructure`
- immutable copies for preview, export, storage, or downstream steps

The runtime state may contain information that is not serialized. For example,
`cursorZ` and process footprint are runtime concepts. When a state is restored
from a persisted `GeometryStructure`, the kernel must explicitly set or derive
runtime state through public construction methods.

### 4.1 Shared Public Types

These types are referenced throughout the API. They are public input or output
contracts, not low-level mutable domain objects.

`FeatureDirection`:

```js
"+z" | "-z"
```

`Bounds3D`:

```js
{
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number
}
```

`GeometryHandle`:

```js
{
  id: string,
  type: "body" | "via" | "circuit" | "bump",
  scope: GeometryScopeRef
}
```

`GeometryHandle` is an opaque reference to a created object. It is not the
created `Body`, `Via`, `Circuit`, or `Bump` instance.

`GeometryScopeRef`:

```js
{
  id: string
}
```

`GeometryScopeRef` is an opaque reference to a geometry scope. It is not a
`Container` instance.

`ProcessFootprintSpec`:

```js
{
  type: "box" | "cylinder" | "polygon" | "cone",
  // shape-specific fields
}
```

`GeometrySpec`:

```js
{
  type: "box" | "cylinder" | "polygon" | "cone",
  thickness: number,
  // shape-specific fields
}
```

## 5. Public Runtime Object: `ProcessGeometryState`

`ProcessGeometryState` is the primary API for process-step authors.

### 5.1 Create an Empty State

```js
const state = ProcessGeometryState.create({
  key: "package-root",
  unitSystem: "um",
});
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `key` | string | no | `"main"` | Human-readable root scope key. |
| `unitSystem` | string | no | `"um"` | Unit system for serialized geometry. |
| `schemaVersion` | string | no | current schema version | Geometry structure schema version. |

Returns:

| Return | Description |
| --- | --- |
| `ProcessGeometryState` | Empty mutable process geometry state. |

### 5.2 Restore From Geometry Structure

```js
const state = ProcessGeometryState.fromStructure(structure, {
  cursorZ: "geometryTop",
  footprint: { derive: "largestRootBody" },
});
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `structure` | `GeometryStructure` | yes | none | Persisted geometry structure to restore. |
| `cursorZ` | number or `"geometryTop"` | no | `"geometryTop"` | Initial process cursor plane. |
| `footprint` | `ProcessFootprintSpec`, `{ derive: string }`, or `null` | no | `null` | Runtime process footprint after restore. |

Notes:

- This method is the only supported way to hydrate a process state from a
  geometry payload.
- Kernel code must not hydrate by creating an empty state and writing private
  fields.
- `footprint: { derive: "largestRootBody" }` is an explicit runtime choice. It
  should be used only when the step semantics really mean "derive a process
  footprint from restored geometry".

### 5.3 Serialize

```js
const structure = state.toGeometryStructure();
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `schemaVersion` | string | no | state default | Target schema version. |
| `unitSystem` | string | no | state default | Target unit system. |

Returns:

| Return | Description |
| --- | --- |
| `GeometryStructure` | Normalized immutable geometry structure. |

Notes:

- The returned structure is a copy.
- Runtime fields such as `cursorZ` and process footprint are not serialized.

### 5.4 Clone

```js
const copy = state.clone();
```

Returns a deep copy of the process state, including runtime cursor and process
footprint.

## 6. Runtime Cursor API

`cursorZ` is the process cursor plane. It is where the next default deposit or
placement operation starts.

It is deliberately separate from `geometryZMax()`.

### 6.1 Read Cursor

```js
const z = state.cursorZ();
```

Returns the current process cursor plane.

### 6.2 Set Cursor

```js
state.setCursorZ(300);
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `z` | number | yes | New process cursor plane. |

Rules:

- `z` must be finite.
- This method changes runtime state only. It does not move geometry.

### 6.3 Advance Cursor By Thickness

```js
state.advanceCursorBy(50);
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `thickness` | number | yes | Positive Z distance to advance. |

Rules:

- `thickness` must be positive.

### 6.4 Advance Cursor To Z

```js
state.advanceCursorTo(500);
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `z` | number | yes | Target process cursor plane. |

Rules:

- `z` must be finite.
- By default, `z` must be greater than or equal to the current `cursorZ`.
- Use `setCursorZ()` when intentionally moving the cursor backward.

### 6.5 Geometry Bounds

```js
const zMax = state.geometryZMax();
const rootBodyTop = state.rootBodyZMax();
const bounds = state.bounds();
```

Methods:

| Method | Return | Description |
| --- | --- | --- |
| `geometryZMin()` | number | Minimum Z in the geometry tree. |
| `geometryZMax()` | number | Maximum Z in the geometry tree. |
| `rootBodyZMax()` | number | Maximum Z among direct root bodies only. Does not inspect root vias, circuits, bumps, or child scopes. Returns `0` when the root has no direct bodies. |
| `zBounds()` | `{ min: number, max: number }` | Z bounds of the geometry tree. |
| `bounds()` | `Bounds3D` | XYZ bounds of the geometry tree. |

## 7. Process Footprint API

The process footprint is a runtime shape used by full-area operations. It is not
a `Body`. It is not saved in `GeometryStructure`.

Examples of operations that use the footprint:

- molding deposit
- dielectric deposit
- panel-level full-area via envelope
- RDL circuit envelope

The footprint exists because "the next full-area process shape" is process
context. It is not always safe to infer it from the current geometry tree.

### 7.1 Footprint Specs

Box footprint:

```js
{
  type: "box",
  bottomLeft: [-2500, -2500],
  topRight: [2500, 2500]
}
```

Cylinder footprint:

```js
{
  type: "cylinder",
  center: [0, 0],
  radius: 150000
}
```

Polygon footprint:

```js
{
  type: "polygon",
  polygons: [
    [[0, 0], [10, 0], [10, 10], [0, 10]]
  ]
}
```

Cone footprint:

```js
{
  type: "cone",
  center: [0, 0],
  bottomRadius: 20,
  topRadius: 15
}
```

Notes:

- Box, cylinder, and polygon footprints are the preferred full-area process
  footprints.
- Cone footprints are supported for tapered process envelopes, but most package
  stack operations should use box, cylinder, or polygon footprints.
- The footprint is interpreted in XY. Z placement is decided by the operation
  using it.

### 7.2 Set Footprint

```js
state.setProcessFootprint({
  type: "box",
  bottomLeft: [-2500, -2500],
  topRight: [2500, 2500],
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `footprint` | `ProcessFootprintSpec` | yes | Runtime footprint for future full-area operations. |

Convenience methods:

```js
state.setBoxFootprint({
  bottomLeft: [-2500, -2500],
  topRight: [2500, 2500],
});

state.setCylinderFootprint({
  center: [0, 0],
  radius: 150000,
});

state.setPolygonFootprint({
  polygons: [
    [[0, 0], [10, 0], [10, 10], [0, 10]],
  ],
});
```

### 7.3 Read Footprint

```js
const footprint = state.processFootprint();
```

Returns a copy of the current process footprint, or `null` if no footprint is
set.

### 7.4 Require Footprint

```js
const footprint = state.requireProcessFootprint();
```

Returns the current process footprint. Throws a clear error if no footprint has
been set.

### 7.5 Derive Footprint

```js
state.deriveProcessFootprint({
  from: "largestRootBody",
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `from` | string | yes | Derivation strategy. |
| `scope` | `GeometryScopeRef` or `"root"` | no | Scope to inspect. Defaults to root. |

Supported strategies:

| Strategy | Description |
| --- | --- |
| `"firstRootBody"` | Use the first direct root body. |
| `"largestRootBody"` | Use the largest direct root body by XY area. |
| `"geometryBounds"` | Use the full tree bounds as a box footprint. |

Guidance:

- Derivation is an explicit runtime operation, not hidden default behavior.
- Prefer setting the footprint during initialization.
- Use derivation mostly for hydration from external geometry structures.

## 8. Geometry Specs

Geometry specs are public input objects. They let process authors describe
geometry without constructing low-level `Body` or primitive classes.

Box geometry:

```js
{
  type: "box",
  bottomLeft: [-50, -50, 0],
  topRight: [50, 50, 0],
  thickness: 10
}
```

Cylinder geometry:

```js
{
  type: "cylinder",
  center: [0, 0, 0],
  radius: 150000,
  thickness: 775
}
```

Polygon geometry:

```js
{
  type: "polygon",
  polygons: [
    [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]
  ],
  thickness: 5
}
```

Cone geometry:

```js
{
  type: "cone",
  center: [0, 0, 0],
  bottomRadius: 20,
  topRadius: 15,
  thickness: 30
}
```

Rules:

- `thickness` must be positive.
- Coordinates are global coordinates.
- Box `bottomLeft[2]` and `topRight[2]` must be on the same XY plane.
- Polygon points in one polygon loop must be on the same XY plane.
- The kernel converts specs into the correct internal primitive classes.

## 9. Initialization API

Initialization methods create the first material layer, set the process
footprint, and move `cursorZ` to the layer top.

Process authors should use these methods instead of creating a `Body` and then
calling a separate footprint method.

### 9.1 Initialize With Generic Geometry

```js
state.initializeLayer({
  key: "panel",
  material: "BT substrate",
  geometry: {
    type: "box",
    bottomLeft: [-2500, -2500, 0],
    topRight: [2500, 2500, 0],
    thickness: 300,
  },
  setFootprint: true,
});
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `key` | string | no | method default | Optional scope or body label for debugging. |
| `material` | string | yes | none | Material name or material entity id. |
| `geometry` | `GeometrySpec` | yes | none | Geometry of the first layer. |
| `setFootprint` | boolean | no | `true` | Whether to derive the process footprint from this geometry. |
| `cursorZ` | `"top"` or number | no | `"top"` | Cursor after initialization. |

Returns:

| Return | Description |
| --- | --- |
| `GeometryHandle` | Opaque handle for the created body. |

### 9.2 Initialize Box Layer

```js
state.initializeBoxLayer({
  material: "BT substrate",
  bottomLeft: [-2500, -2500, 0],
  topRight: [2500, 2500, 0],
  thickness: 300,
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `material` | string | yes | Material name or id. |
| `bottomLeft` | number[3] | yes | Box footprint lower-left point and bottom Z. |
| `topRight` | number[3] | yes | Box footprint upper-right point and bottom Z. |
| `thickness` | number | yes | Layer thickness. |
| `setFootprint` | boolean | no | Defaults to `true`. |

### 9.3 Initialize Cylinder Layer

```js
state.initializeCylinderLayer({
  material: "silicon wafer",
  center: [0, 0, 0],
  radius: 150000,
  thickness: 775,
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `material` | string | yes | Material name or id. |
| `center` | number[3] | yes | Cylinder bottom center. |
| `radius` | number | yes | Cylinder radius. |
| `thickness` | number | yes | Layer thickness. |
| `setFootprint` | boolean | no | Defaults to `true`. |

### 9.4 Initialize Polygon Layer

```js
state.initializePolygonLayer({
  material: "redistribution dielectric",
  polygons: [
    [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
  ],
  thickness: 5,
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `material` | string | yes | Material name or id. |
| `polygons` | number[][][] | yes | One or more polygon loops. |
| `thickness` | number | yes | Layer thickness. |
| `setFootprint` | boolean | no | Defaults to `true`. |

### 9.5 Initialize Cone Layer

```js
state.initializeConeLayer({
  material: "tapered plating",
  center: [0, 0, 0],
  bottomRadius: 20,
  topRadius: 15,
  thickness: 30,
  setFootprint: false,
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `material` | string | yes | Material name or id. |
| `center` | number[3] | yes | Cone bottom center. |
| `bottomRadius` | number | yes | Bottom radius. |
| `topRadius` | number | yes | Top radius. |
| `thickness` | number | yes | Layer thickness. |
| `setFootprint` | boolean | no | Defaults to `false` for cone layers. |

## 10. Body Deposit API

Body deposit methods create solid material regions.

### 10.1 Deposit From Process Footprint

```js
state.depositLayer({
  material: "epoxy mold",
  thickness: 120,
});
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `material` | string | yes | none | Material name or id. |
| `thickness` | number | yes | none | Positive layer thickness. |
| `z` | number | no | `state.cursorZ()` | Bottom Z of the new layer. |
| `advanceCursor` | boolean | no | `true` | Whether to move cursor to layer top. |
| `scope` | `GeometryScopeRef` or `"root"` | no | `"root"` | Target geometry scope. |

Returns:

| Return | Description |
| --- | --- |
| `GeometryHandle` | Opaque handle for the created body. |

Behavior:

- Uses `state.requireProcessFootprint()`.
- Creates a body whose bottom is at `z`.
- If `advanceCursor` is true, sets `cursorZ` to `z + thickness`.

### 10.2 Fill To Z

```js
state.fillTo({
  material: "underfill",
  z: 500,
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `material` | string | yes | Material name or id. |
| `z` | number | yes | Target top Z. |
| `scope` | `GeometryScopeRef` or `"root"` | no | Target scope. Defaults to root. |

Behavior:

- Uses the process footprint.
- Creates a body from `cursorZ()` to `z`.
- Advances cursor to `z`.
- Throws if `z` is not above the current cursor.

### 10.3 Deposit Explicit Geometry

```js
state.depositGeometry({
  material: "Si die",
  geometry: {
    type: "box",
    bottomLeft: [-800, -800, 40],
    topRight: [800, 800, 40],
    thickness: 200,
  },
  advanceCursor: false,
});
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `material` | string | yes | none | Material name or id. |
| `geometry` | `GeometrySpec` | yes | none | Explicit geometry envelope. |
| `advanceCursor` | boolean | no | `false` | Whether to move cursor to geometry top. |
| `scope` | `GeometryScopeRef` or `"root"` | no | `"root"` | Target scope. |

Convenience methods:

```js
state.depositBoxLayer({ material, bottomLeft, topRight, thickness });
state.depositCylinderLayer({ material, center, radius, thickness });
state.depositPolygonLayer({ material, polygons, thickness });
state.depositConeLayer({ material, center, bottomRadius, topRadius, thickness });
```

## 11. Feature API

Features represent density-based process effects. They are scoped to the
geometry scope that owns them.

Supported feature types:

| Feature | Direction Required | Typical Meaning |
| --- | --- | --- |
| Via | yes | Vertical interconnect or via density. |
| Circuit | no | Routing or circuit density. |
| Bump | yes | Solder bump, micro bump, C4, BGA, or contact feature. |

Direction values:

| Value | Meaning |
| --- | --- |
| `"+z"` | Feature points from lower Z to higher Z. |
| `"-z"` | Feature points from higher Z to lower Z. |

### 11.1 Add Explicit Via

```js
state.addVia({
  material: "Cu",
  density: 0.3,
  direction: "-z",
  geometry: {
    type: "box",
    bottomLeft: [-50, -50, 290],
    topRight: [50, 50, 290],
    thickness: 10,
  },
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `material` | string | yes | Material name or id. |
| `density` | number | yes | Effective feature density. |
| `direction` | `"+z"` or `"-z"` | yes | Z-axis direction. |
| `geometry` | `GeometrySpec` | yes | Feature envelope. |
| `scope` | `GeometryScopeRef` or `"root"` | no | Target scope. Defaults to root. |

### 11.2 Add Via Below Cursor

```js
state.addViaBelowCursor({
  material: "Cu",
  density: 0.2,
  thickness: 3,
});
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `material` | string | yes | none | Material name or id. |
| `density` | number | yes | none | Effective via density. |
| `thickness` | number | yes | none | Via envelope thickness. |
| `direction` | `"+z"` or `"-z"` | no | `"-z"` | Via direction. |
| `scope` | `GeometryScopeRef` or `"root"` | no | `"root"` | Target scope. |

Behavior:

- Uses the process footprint.
- Creates a via envelope from `cursorZ() - thickness` to `cursorZ()`.
- Does not move `cursorZ`.

This method is useful after depositing dielectric, when the via should occupy
the layer that was just deposited.

### 11.3 Add Via Above Cursor

```js
state.addViaAboveCursor({
  material: "Cu",
  density: 0.2,
  thickness: 3,
});
```

Behavior:

- Uses the process footprint.
- Creates a via envelope from `cursorZ()` to `cursorZ() + thickness`.
- Defaults direction to `"+z"`.
- Does not move `cursorZ`.

### 11.4 Add Circuit

```js
state.addCircuit({
  material: "Cu",
  density: 0.35,
  geometry: {
    type: "box",
    bottomLeft: [-750, -750, 240],
    topRight: [750, 750, 240],
    thickness: 10,
  },
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `material` | string | yes | Material name or id. |
| `density` | number | yes | Effective circuit density. |
| `geometry` | `GeometrySpec` | yes | Circuit envelope. |
| `scope` | `GeometryScopeRef` or `"root"` | no | Target scope. Defaults to root. |

### 11.5 Add Circuit At Cursor

```js
state.addCircuitAtCursor({
  material: "Cu",
  density: 0.35,
  thickness: 3,
});
```

Behavior:

- Uses the process footprint.
- Creates a circuit envelope from `cursorZ()` to `cursorZ() + thickness`.
- Does not move `cursorZ`.

### 11.6 Add Bump

```js
state.addBump({
  material: "SAC305",
  density: 0.55,
  direction: "+z",
  geometry: {
    type: "box",
    bottomLeft: [-80, -80, 0],
    topRight: [80, 80, 0],
    thickness: 20,
  },
});
```

Parameters are the same as `addVia()`, except the feature type is bump.

### 11.7 Add Bump Above Cursor

```js
state.addBumpAboveCursor({
  material: "SAC305",
  density: 0.55,
  thickness: 40,
  direction: "+z",
  xyInset: 20,
});
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `material` | string | yes | none | Material name or id. |
| `density` | number | yes | none | Effective bump density. |
| `thickness` | number | yes | none | Bump envelope thickness. |
| `direction` | `"+z"` or `"-z"` | no | `"+z"` | Bump direction. |
| `scope` | `GeometryScopeRef` or `"root"` | no | `"root"` | Target scope that receives the bump feature. |
| `xyInset` | number | no | `0` | XY inset applied to the process footprint before creating the bump. Positive values shrink the footprint; negative values expand it. |

Behavior:

- Uses the runtime process footprint as the bump XY envelope.
- Creates a bump envelope from `cursorZ()` to `cursorZ() + thickness`.
- Defaults direction to `"+z"`.
- Applies `xyInset` through geometry primitive copy methods. Box, cylinder, and
  cone footprints support positive inset and negative outset. Polygon footprints
  only support `xyInset: 0`; non-zero polygon inset/outset is not supported.
- Does not move `cursorZ`.

This method matches package bump formation steps that grow bump material from the
active process surface upward while leaving the process cursor available for the
next modeled operation.

## 12. Transform and Removal API

### 12.1 Move Geometry

```js
state.move({
  x: 100,
  y: 0,
  z: 0,
});
```

Moves all geometry in the selected scope by the given offset.

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `x` | number | no | `0` | X offset. |
| `y` | number | no | `0` | Y offset. |
| `z` | number | no | `0` | Z offset. |
| `scope` | `GeometryScopeRef` or `"root"` | no | `"root"` | Scope to move. |
| `moveCursor` | boolean | no | `false` | Whether to move `cursorZ` by the same Z offset. |

### 12.2 Flip Around Z

```js
state.flipAroundZ({
  z: 0,
});
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `z` | number | no | `0` | XY plane used as mirror plane. |
| `scope` | `GeometryScopeRef` or `"root"` | no | `"root"` | Scope to flip. |
| `normalizeZMinToZero` | boolean | no | `true` | Move flipped geometry so minimum Z becomes 0. |
| `updateCursor` | boolean | no | `true` | Set cursor to geometry top after flip. |

Behavior:

- Flips bodies, vias, circuits, bumps, and child scopes.
- Reverses via and bump direction.
- Keeps all geometry represented with positive thickness.
- If `updateCursor` is true, cursor uses the selected scope's full geometry top.
  For root-direct-body cursor semantics, call `flipAroundZ()` with
  `updateCursor: false`, then set `cursorZ` from `rootBodyZMax()`.

### 12.3 Grind To Z

```js
state.grindTo({
  z: 450,
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `z` | number | yes | New top clipping plane. |
| `scope` | `GeometryScopeRef` or `"root"` | no | Scope to clip. Defaults to root. |
| `updateCursor` | boolean | no | Defaults to `true`. |

Behavior:

- Clips features and bodies whose top exceeds `z`.
- Removes features and bodies entirely above the clipped region.
- If `updateCursor` is true, sets `cursorZ` to `min(cursorZ(), z)`.

### 12.4 Saw To Box

```js
state.sawToBox({
  bottomLeftX: -2500,
  bottomLeftY: -2500,
  topRightX: 2500,
  topRightY: 2500,
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `bottomLeftX` | number | yes | Retained rectangle lower-left X coordinate. |
| `bottomLeftY` | number | yes | Retained rectangle lower-left Y coordinate. |
| `topRightX` | number | yes | Retained rectangle upper-right X coordinate. Must be greater than `bottomLeftX`. |
| `topRightY` | number | yes | Retained rectangle upper-right Y coordinate. Must be greater than `bottomLeftY`. |
| `scope` | `GeometryScopeRef` or `"root"` | no | Scope to clip. Defaults to root. |
| `updateFootprint` | boolean | no | Defaults to `true`. When true, updates the runtime process footprint to the retained box. |

Behavior:

- Clips bodies, vias, circuits, bumps, and child scopes recursively in XY.
- Removes geometry completely outside the retained rectangle.
- Does not move `cursorZ`.
- `BoxGeometry` and `PolygonGeometry` support retained-rectangle clipping.
- `CylinderGeometry` and `ConeGeometry` are kept when fully inside and removed
  when fully outside. Partial XY clipping throws because the current primitive
  model cannot represent the exact intersection.
- Via and bump direction is unchanged because saw does not flip Z.

### 12.5 Remove Top Root Bodies

```js
state.removeTopRootBodies();
```

Removes the direct root body or bodies whose `zMax()` equals the highest direct
root body top.

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `updateCursor` | boolean | no | `true` | Whether to update `cursorZ` after removing bodies. |

Returns:

```js
{ removedCount: number }
```

Behavior:

- Only inspects bodies directly owned by the root scope.
- Does not inspect or remove bodies in child scopes.
- Does not remove vias, circuits, bumps, or child scopes.
- If several direct root bodies share the highest `zMax()`, all of them are
  removed.
- If the root scope has no direct bodies, this method is a no-op.
- If `updateCursor` is true and at least one body was removed, sets `cursorZ`
  to `rootBodyZMax()`.

## 13. Component and Placement API

Process steps often combine geometry from multiple inputs, such as placing die
geometry on a carrier.

Placement APIs preserve container scope semantics without exposing raw
containers to process-step authors.

### 13.1 Place Another Geometry State

```js
const dieScope = state.placeGeometryState(dieState, {
  key: "logic-die-1",
  x: 100,
  y: 200,
  bottomZ: state.cursorZ(),
  anchor: "bottomLeft",
  clone: true,
});
```

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `source` | `ProcessGeometryState` | yes | none | State to place as a child scope. |
| `key` | string | no | source root key | Key for the placed scope. |
| `x` | number | yes | none | Target X anchor position. |
| `y` | number | yes | none | Target Y anchor position. |
| `bottomZ` | number | no | `cursorZ()` | Target bottom Z. |
| `anchor` | string | no | `"bottomLeft"` | Source anchor used for placement. |
| `clone` | boolean | no | `true` | Whether to copy source geometry before placing. |

Supported anchors:

| Anchor | Meaning |
| --- | --- |
| `"bottomLeft"` | Align source XY minimum to `{ x, y }`. |
| `"center"` | Align source XY center to `{ x, y }`. |
| `"origin"` | Align source origin to `{ x, y }`. |

Returns:

| Return | Description |
| --- | --- |
| `GeometryScopeRef` | Opaque reference to the placed child scope. |

Rules:

- Placement moves primitive coordinates. The serialized result still uses
  global coordinates.
- `clone` defaults to true so a reusable die state is not mutated by placement.
- The parent cache is maintained internally.
- Process authors do not call `attachChild()` or mutate child arrays.

### 13.2 Place Multiple States

```js
state.placeGeometryStates(dieState, [
  { key: "die-a", x: 100, y: 200 },
  { key: "die-b", x: -25, y: 50 },
]);
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `source` | `ProcessGeometryState` | yes | State to copy and place. |
| `placements` | object[] | yes | Placement options for each copy. |

Returns an array of `GeometryScopeRef` values.

### 13.3 Bond Carrier Geometry

```js
state.bondCarrierGeometry(carrierState);
```

Copies the source carrier state's root direct bodies onto the top of the target
state as root direct bodies.

Parameters:

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `source` | `ProcessGeometryState` | yes | none | Carrier geometry state. Only its root direct bodies are copied. |
| `updateCursor` | boolean | no | `true` | Whether to set `cursorZ` to the top of the bonded carrier stack. |

Returns:

```js
{
  bondedBodyCount: number,
  bottomZ: number,
  topZ: number
}
```

Behavior:

- Uses the target state's full `geometryZMax()` as the carrier bond bottom Z.
- Copies only the source root direct bodies. Source child scopes, vias,
  circuits, and bumps are not copied.
- Shifts the copied carrier body stack so the source direct-body `zMin` aligns
  to `bottomZ`.
- Adds the copied bodies directly to the target root scope, not as a child
  scope.
- If `updateCursor` is true, sets `cursorZ` to the copied carrier stack top.

## 14. Scope References

`GeometryScopeRef` is an opaque reference to a geometry scope. It is not a
`Container` and does not expose child arrays or mutable properties.

Process authors usually do not need scope references. They are useful when a
step places several components and then needs to add a scoped feature to one of
them.

### 14.1 Root Scope

```js
const root = state.rootScopeRef();
```

### 14.2 Find Scopes

```js
const dies = state.findScopes({
  key: "logic-die",
});
```

Parameters:

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `key` | string | no | Match scope key. |
| `id` | string | no | Match scope id. |
| `recursive` | boolean | no | Defaults to `true`. |

Returns an array of `GeometryScopeRef` values.

### 14.3 Inspect Scope

```js
const summary = state.scopeSummary(dieScope);
```

Returns a read-only summary:

```js
{
  id: "container:...",
  key: "logic-die-1",
  bounds: { xMin, xMax, yMin, yMax, zMin, zMax },
  bodyCount: 1,
  viaCount: 0,
  circuitCount: 1,
  bumpCount: 1,
  childCount: 0
}
```

## 15. Query and Inspection API

Query APIs return copies or summaries. They must not return live mutable
collections.

```js
const summary = state.inspect();
```

Example return:

```js
{
  cursorZ: 300,
  unitSystem: "um",
  footprint: { type: "box", bottomLeft: [-2500, -2500], topRight: [2500, 2500] },
  bounds: { xMin: -2500, xMax: 2500, yMin: -2500, yMax: 2500, zMin: 0, zMax: 300 },
  bodyCount: 1,
  viaCount: 0,
  circuitCount: 0,
  bumpCount: 0,
  scopeCount: 1
}
```

Recommended methods:

| Method | Return | Description |
| --- | --- | --- |
| `inspect()` | object | Read-only state summary. |
| `bounds()` | `Bounds3D` | Full geometry bounds. |
| `materialSummary()` | object[] | Body and feature counts grouped by material. |
| `featureSummary()` | object | Counts and density ranges by feature type. |
| `scopeSummary(scope)` | object | Read-only scope summary. |

## 16. Kernel Internal Domain Model

These objects represent the geometry structure internally. They should not be
the normal API for process-step authors.

### 16.1 `Container`

Concept:

- Semantic scope in the geometry tree.
- Owns direct bodies, vias, circuits, bumps, and child containers.
- Has an internal parent cache for navigation and invariant checks.
- Parent reference is never serialized.

Required public methods:

| Method | Description |
| --- | --- |
| `key()` | Read human-readable key. |
| `parent()` | Read parent cache. Returns null for root. |
| `children()` | Return a copy of child list. |
| `attachChild(child)` | Attach child while checking cycles and parent consistency. |
| `detachChild(childOrRef)` | Remove child and clear parent cache. |
| `addBody(body)` | Add direct body. |
| `addVia(via)` | Add direct via. |
| `addCircuit(circuit)` | Add direct circuit. |
| `addBump(bump)` | Add direct bump. |
| `walk(visitor)` | Traverse this scope and descendants. |
| `bounds(options)` | Compute bounds. |
| `move(offset)` | Move this scope and descendants. |
| `flipAroundZ(z)` | Flip this scope and descendants. |
| `grindTo(z)` | Clip this scope and descendants. |
| `clipXYToBox(bounds)` | Recursively clip this scope and descendants to an XY box. |
| `copy()` | Deep copy. |
| `toTreePayload()` | Return container payload, not full structure. |

Forbidden public methods:

| Method | Reason |
| --- | --- |
| `setParent(parent)` | Breaks tree invariants if called outside attach/detach. |
| direct access to child arrays | Allows unsynchronized mutation. |
| direct access to `_parent`, `_children`, `_bodies` | Violates object boundary. |

### 16.2 `Body`

Concept:

- Solid material region.
- Defines physical volume ownership.
- Has geometry and material.

Required public methods:

| Method | Description |
| --- | --- |
| `geometry()` | Return a copy of the geometry primitive. |
| `material()` | Return material. |
| `zMin()` / `zMax()` | Return Z bounds. |
| `bounds()` | Return XYZ bounds. |
| `move(offset)` | Move body geometry. |
| `flipAroundZ(z)` | Flip body geometry. |
| `clipTopTo(z)` | Clip top. |
| `clipXYToBox(bounds)` | Clip XY footprint to a retained box. |
| `copy()` | Deep copy. |
| `toPayload()` | Return serialized body payload. |

### 16.3 `Via`

Concept:

- Density-based vertical interconnect feature.
- Scoped to its owner container.
- Requires direction.

Required public methods:

| Method | Description |
| --- | --- |
| `geometry()` | Return a copy of geometry. |
| `material()` | Return material. |
| `density()` | Return density. |
| `direction()` | Return `"+z"` or `"-z"`. |
| `move(offset)` | Move feature envelope. |
| `flipAroundZ(z)` | Flip geometry and reverse direction. |
| `clipTopTo(z)` | Clip feature envelope. |
| `clipXYToBox(bounds)` | Clip feature envelope to a retained XY box. |
| `copy()` | Deep copy. |
| `toPayload()` | Return serialized via payload. |

### 16.4 `Circuit`

Concept:

- Density-based routing or planar circuit feature.
- Scoped to its owner container.
- Does not have direction.

Required public methods are the same as `Via`, except there is no
`direction()`.

### 16.5 `Bump`

Concept:

- Density-based solder/contact feature.
- Scoped to its owner container.
- Requires direction.

Required public methods are the same as `Via`.

### 16.6 Geometry Primitive Classes

Primitive classes represent geometry envelopes:

| Class | Required Fields |
| --- | --- |
| `BoxGeometry` | `bottomLeft`, `topRight`, `thickness` |
| `CylinderGeometry` | `center`, `radius`, `thickness` |
| `PolygonGeometry` | `polygons`, `thickness` |
| `ConeGeometry` | `center`, `bottomRadius`, `topRadius`, `thickness` |

Required public methods:

| Method | Description |
| --- | --- |
| `zMin()` / `zMax()` | Z bounds. |
| `thickness()` | Positive thickness. |
| `bounds()` | XYZ bounds. |
| `copy()` | Deep copy. |
| `copyWithThickness(thickness)` | Copy with replaced thickness. |
| `move(offset)` | Move coordinates. |
| `flipAroundZ(z)` | Mirror around an XY plane. |
| `clipTopTo(z)` | Clip top. |
| `toPayload()` | Serialized primitive payload. |

## 17. Process-Step Authoring Model

Process-step modules should receive a `ProcessGeometryState` and return a
`ProcessGeometryState`.

Example signature:

```js
export async function execute({ state, values, geometryState }) {
  // mutate state through public methods
  return state;
}
```

Parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| `state` | `ProcessGeometryState` | Main geometry state for `main_geometry`. |
| `values` | object | Validated process parameter values. |
| `geometryState(fieldId)` | function | Returns another resolved geometry input as `ProcessGeometryState`. |

Rules:

- Do not read or write private fields.
- Do not call `state.container()`.
- Do not create `Body`, `Via`, `Circuit`, `Bump`, or `Container`.
- Do use high-level state methods.
- Return `state` unless the step intentionally creates a new state.

### 17.1 Panel Process Example

```js
export function execute({ state, values }) {
  state.initializeBoxLayer({
    material: values.material,
    bottomLeft: [-values.width / 2, -values.width / 2, 0],
    topRight: [values.width / 2, values.width / 2, 0],
    thickness: values.thickness,
  });

  return state;
}
```

### 17.2 Wafer Process Example

```js
export function execute({ state, values }) {
  state.initializeCylinderLayer({
    material: values.material,
    center: [0, 0, 0],
    radius: values.radius,
    thickness: values.thickness,
  });

  return state;
}
```

### 17.3 Molding Process Example

```js
export function execute({ state, values }) {
  state.depositLayer({
    material: values.mold_compound,
    thickness: values.mold_thickness,
  });

  return state;
}
```

### 17.4 RDL Process Example

```js
export function execute({ state, values }) {
  for (const [index, layer] of values.rdl_layers.entries()) {
    if (index % 2 === 0) {
      state.depositLayer({
        material: layer.pm_material,
        thickness: layer.thickness,
      });

      state.addViaBelowCursor({
        material: layer.metal_material,
        density: layer.density,
        thickness: layer.thickness,
      });
    } else {
      state.addCircuitAtCursor({
        material: layer.metal_material,
        density: layer.density,
        thickness: layer.thickness,
      });

      state.depositLayer({
        material: layer.pm_material,
        thickness: layer.thickness,
      });
    }
  }

  return state;
}
```

### 17.5 Pick-And-Place Process Example

```js
export function execute({ state, values, geometryState }) {
  const die = geometryState("die_geometry");

  for (const placement of values.coordinates) {
    state.placeGeometryState(die, {
      key: placement.name,
      x: placement.bottomLeft_x,
      y: placement.bottomLeft_y,
      bottomZ: state.cursorZ(),
      anchor: "bottomLeft",
    });
  }

  return state;
}
```

### 17.6 Bump Process Example

```js
export function execute({ state, values }) {
  state.addBumpAboveCursor({
    material: values.bump_material,
    density: values.bump_density,
    thickness: values.bump_thickness,
    direction: "+z",
  });

  return state;
}
```

## 18. Kernel Development Model

Kernel maintainers implement the runtime, hydration, validation, and
serialization behavior behind `ProcessGeometryState`.

### 18.1 Kernel Responsibilities

The kernel is responsible for:

- converting geometry specs into validated primitive objects
- enforcing positive thickness and finite coordinates
- enforcing via and bump direction
- preserving feature scope
- maintaining parent cache internally
- preventing container cycles
- returning defensive copies from read methods
- serializing to normalized `GeometryStructure`
- hydrating states through public constructors
- keeping runtime fields out of persisted geometry

### 18.2 Hydration Rules

Hydration must use:

```js
ProcessGeometryState.fromStructure(structure, options);
```

Hydration must not:

```js
const state = ProcessGeometryState.create();
state._root = root;
state._cursorZ = root.zMax();
state._processFootprint = footprint;
```

Reason:

- Direct private field writes bypass validation.
- Direct field writes make future runtime invariants hard to maintain.
- Constructor and restore logic should remain centralized.

### 18.3 Serialization Rules

Serialization must use:

```js
state.toGeometryStructure();
```

Rules:

- Return a normalized copy.
- Include container ids and feature ids.
- Do not include runtime cursor.
- Do not include process footprint.
- Do not include parent references.
- Do not include local transforms.

### 18.4 Parent Cache Rules

The parent link exists only as an internal cache.

Allowed:

```js
parent.attachChild(child);
parent.detachChild(child);
```

Forbidden:

```js
child.setParent(parent);
child._parent = parent;
parent.children().push(child);
```

`attachChild()` must:

- reject cycles
- reject duplicate children
- detach from an old parent or reject reparenting explicitly
- set the child parent cache
- keep serialization unaffected

### 18.5 Copy Rules

Public methods must define whether they mutate or copy.

Defaults:

- `placeGeometryState()` copies source geometry by default.
- `toGeometryStructure()` returns a copy.
- `processFootprint()` returns a copy.
- `children()` and query methods return copies or summaries.
- Explicit `clone: false` may be allowed only when the method name and docs make
  mutation obvious.

## 19. Application-Layer Development Model

Application code should treat the geometry kernel as an execution and preview
service.

Application developers usually work with:

- `GeometryKernel`
- process-flow templates
- process-flow instances
- geometry repositories
- preview APIs
- exporters and viewers

Application code should not:

- mutate geometry state internals
- inspect raw private fields
- repair container trees
- infer process footprint unless a user action explicitly asks for it
- write geometry arrays by hand when a kernel API can generate them

### 19.1 Execute a Flow

```js
const result = await kernel.execute("flow_inst_aaatv_001");
const geometry = result.geometry();
```

Application responsibilities:

- choose the process flow instance
- provide repositories
- display validation errors
- render or export the returned geometry

Kernel responsibilities:

- resolve geometry refs
- hydrate states
- execute process modules
- normalize outputs
- return immutable result payloads

### 19.2 Preview a Step

```js
const preview = await kernel.executePreview({
  processFlowTemplate,
  processFlowInstance,
  previewTarget: {
    type: "stepOutput",
    stepRefId: "molding",
  },
});
```

Application responsibilities:

- provide preview target
- display loading, validation, and error states
- pass returned geometry to viewer

The UI should not manually build process geometry for preview.

### 19.3 Build Process Parameters

Application code gathers and validates user input based on
`ProcessStepTemplate.fieldDefinitions`. It passes primitive values to the kernel.

Application code does not need to know how a process step creates bodies or
features.

## 20. Error Design

Errors should be specific and actionable.

Examples:

| Situation | Error Message Style |
| --- | --- |
| Missing footprint | `depositLayer requires a process footprint. Call initialize... or setProcessFootprint... first.` |
| Bad thickness | `thickness must be a positive finite number.` |
| Invalid direction | `via direction must be "+z" or "-z".` |
| Missing geometry input | `geometryState("die_geometry") returned null.` |
| Invalid placement | `placeGeometryState requires finite x and y.` |
| Missing footprint for bump | `process footprint is required. Call initialize...Layer or setProcessFootprint first.` |

Guidelines:

- Mention the method name.
- Mention the missing or invalid parameter.
- Prefer errors that tell the process author how to fix the call.

## 21. Naming Guidelines

Use names that describe process intent.

Preferred:

- `initializeBoxLayer`
- `depositLayer`
- `fillTo`
- `addViaBelowCursor`
- `addCircuitAtCursor`
- `addBumpAboveCursor`
- `placeGeometryState`
- `cursorZ`
- `geometryZMax`
- `rootBodyZMax`
- `setProcessFootprint`

Avoid:

- `initialBody`
- `container`
- `setParent`
- `zNow` if the API can use clearer `cursorZ`
- names that expose low-level implementation details to process authors

Compatibility aliases may exist during migration, but new process-step modules
should use the preferred names.

## 22. Migration Principles

When migrating existing code:

1. Replace `Status` with `ProcessGeometryState`.
2. Replace `zNow()` with `cursorZ()`.
3. Replace direct `status.container()` mutations with state methods.
4. Replace `initialBody()` with `initialize...Layer()` or
   `setProcessFootprint...()`.
5. Replace direct `_zNow`, `_container`, and `_baseGeometry` writes with public
   methods or static constructors.
6. Replace direct `Container.addChild()` placement with `placeGeometryState()`.
7. Keep `Container`, `Body`, `Via`, `Circuit`, and `Bump` behind the state API
   for process-step code.

## 23. Non-Goals

This API does not attempt to:

- persist runtime process cursor
- persist process footprint
- infer all process semantics from geometry
- expose CAD boolean operations as process-step authoring primitives
- make `Container` a public process authoring API
- store local transforms in geometry structure

## 24. Recommended Minimal API Surface

For the first restructure milestone, implement this set first:

```js
ProcessGeometryState.create(options)
ProcessGeometryState.fromStructure(structure, options)
state.toGeometryStructure()

state.cursorZ()
state.setCursorZ(z)
state.advanceCursorBy(thickness)
state.advanceCursorTo(z)
state.geometryZMax()
state.rootBodyZMax()
state.bounds()

state.setProcessFootprint(footprint)
state.processFootprint()
state.requireProcessFootprint()

state.initializeBoxLayer(options)
state.initializeCylinderLayer(options)
state.initializePolygonLayer(options)

state.depositLayer(options)
state.fillTo(options)
state.depositGeometry(options)

state.addVia(options)
state.addViaBelowCursor(options)
state.addCircuit(options)
state.addCircuitAtCursor(options)
state.addBump(options)
state.addBumpAboveCursor(options)

state.placeGeometryState(source, options)
state.grindTo(options)
state.flipAroundZ(options)
state.inspect()
```

Everything else can be added after these methods are stable.
