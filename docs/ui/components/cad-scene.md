---
title: CAD Scene
status: normative
owner: Process Flow UI
audience:
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-11
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - apps/viewer/components/viewer/viewer-scene.tsx
  - apps/viewer/components/viewer/model-loader.ts
---

# CAD Scene

## 元件契約

`ViewerScene` 是 Standalone CAD Viewer與 Geometry Preview共用的 Z-up React Three Fiber
scene。Parent擁有model、bounds與controls state；scene不提供toolbar或persistence。

```ts
type SectionPlaneMode = "xz" | "yz";
type CameraViewMode = "iso" | "x" | "y" | "z";
```

## Canvas 規格

| Property | Exact value |
| --- | --- |
| Size | parent `100% × 100%` |
| Camera | perspective、FOV `42°`、initial `[7200,-8200,5200]` |
| Near/far initial | `0.1 / 100000`，fit後依bounds調整 |
| DPR | clamp `[1,2]` |
| WebGL | antialias、alpha、transparent white clear、local clipping |
| Shadows | enabled |
| Coordinate up | `[0,0,1]` |

Lighting固定：hemisphere `#eff7fb/#b7b0a2` intensity `2.1`；主directional intensity
`2.8` + 2048 shadow map；補光 intensity `0.85`。Light positions依bounds center/max dimension。

## Camera fit 規格

當 bounds、`cameraResetKey`或`cameraView`改變時：

1. `maxDim=max(size.x,size.y,size.z,1)`。
2. 用FOV算fit distance，再乘 `1.55`。
3. camera看向bounds center。
4. near `max(maxDim/10000,.001)`；far `max(maxDim*80,1000)`。

| View | Direction | Up |
| --- | --- | --- |
| ISO | normalized `[0.86,-1.08,0.66]` | `[0,0,1]` |
| +X | `[1,0,0]` | `[0,0,1]` |
| +Y | `[0,1,0]` | `[0,0,1]` |
| +Z | `[0,0,1]` | `[0,1,0]` |

Reset caller必須明確決定是否改`cameraView`；Standalone Reset保留view，Camera Fit command改ISO。

## Orbit controls 規格

- Left mouse：rotate。
- Middle mouse：dolly。
- Right mouse：pan。
- damping on，factor `0.08`。
- `screenSpacePanning=false`。
- target永遠同步bounds center；每frame update。

Touch使用 Three.js OrbitControls default mapping；scene沒有keyboard camera mapping、measurement、
annotation或body selection。

## Section plane 規格

| Mode | Visual plane | Slider axis | Default normal | Position |
| --- | --- | --- | --- | --- |
| `xz` | XZ | Y | `[0,1,0]` | `[centerX,value,centerZ]` |
| `yz` | YZ | X | `[1,0,0]` | `[value,centerY,centerZ]` |

Flip把normal乘 `-1`。Visual plane是bounds in-plane size `×1.08`、`#1aa7d2`、opacity
`0.16`、DoubleSide、no depth write、renderOrder 10。Disabled時清空global clipping planes且不render
visual。

## Grid、axes 與 content

- Grid在bounds `zMin - zSize*.035`，XY span最大值 `×1.2`，24 divisions，colors
  `#8aa0a6/#d1dcde`，旋轉到XY plane。
- Axes size為scene max dimension `×.16`，放在min corner外移size `×.18`。
- 有`model`時render loaded object；null時render built-in Demo Package。
- Optional children與model在同一group/coordinate system；Preview用它render feature overlay。

Scene bounds必須包含所有可見 authority；Preview會把feature envelopes merge進GLB model bounds，再傳
入scene。

## Demo 材質色盤

| Material | Color | Key properties |
| --- | --- | --- |
| Substrate | `#10775d` | roughness .58 |
| Silicon | `#858987` | roughness .5 |
| HBM | `#aeb5b2` | roughness .54 |
| RDL | `#e0c629` | metalness .4 |
| Dielectric | `#20a8cf` | opacity .86 |
| Solder | `#e3e7e5` | metalness .28 |
| Mold | `#c5cbc8` | opacity .38 |

Imported model loading/disposal與stats在`model-loader.ts`；unmount或replace MUST dispose geometry與
materials，feature overlay也同樣dispose自己建立的Three resources。

## Accessibility

Canvas是視覺inspection surface，不是唯一資料來源；bounds/stats/settings在HTML pane重述。Camera
操作目前沒有keyboard parity，是已知限制。任何新增selection MUST 同步提供HTML details與
accessible command。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-CAD-101` | fixed bounds + ISO | camera位置/near/far依公式且Z-up。 |
| `UI-CAD-102` | switch XZ/YZ/flip | clipping normal、visual orientation、slider axis一致。 |
| `UI-CAD-103` | bounds change | orbit target、grid、axes、camera fit同步。 |
| `UI-CAD-104` | replace/unmount model | previous Three resources disposed一次。 |
