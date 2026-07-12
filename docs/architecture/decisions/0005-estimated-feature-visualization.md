---
title: ADR-0005：Estimated feature field visualization
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - 架構與產品負責人
  - Viewer、CAD 與 QA 開發者
last_verified: 2026-07-12
last_verified_commit: eb34a9ef688da71a77c4bbd8660bcb58ebf2288a
verified_against:
  - apps/viewer/lib/geometry-preview/features/
  - apps/viewer/components/geometry-preview/
  - packages/cad-py/src/process_flow_cad/section.py
---

# ADR-0005：Estimated feature field visualization

## 背景

Via、circuit、bump 的domain geometry是density envelope，不是physical placement。ADR-0004已決定
materialized body由OCC exact section負責，density feature不得冒充exact material；但舊viewer只在
full 3D以estimated glyph顯示feature，cross section cap與2D section完全忽略feature，會讓以bump連接的
die在工程檢視中看似懸空。

舊feature renderer雖已使用每kind一個`InstancedMesh`，但bump sphere仍有396 triangles；10,000個
bump最壞約3.96M triangles。Parser、sampling、Three resources、picking與formatting也集中在單一
component，無法讓3D section與SVG共用同一語意。

## 決策

### 1. Feature是estimated field，不是preview solid

1. Viewer MUST從normalized GeometryStructure建立typed `PreviewFeature` field，保留feature ID、kind、
   material、density、direction、koz、container identity與authoritative envelope。
2. Density MUST解讀為`0..100` percentage；density 0 MUST保留envelope/metadata，但不得產生repeated
   marks或filled section pattern。
3. Viewer MUST以material color與kind-specific motif/shape同時表達material與feature kind，不得只靠顏色。
4. Estimated layer不得回寫GeometryStructure、CAD area、export geometry或material ownership。

### 2. Exact body與estimated feature section分層

1. Existing OCC `/section` response仍是`ExactMaterialSectionLayer`，不得加入density feature region。
2. Viewer MUST同步從feature envelope與current vertical plane建立獨立
   `EstimatedFeatureSectionLayer`；3D cross-section與2D SVG MUST消費同一份layer。
3. Plane只要與feature envelope有positive-area intersection，就 MUST產生固定、deterministic、
   world/feature-anchored pattern；不得要求切到某一排estimated 3D glyph。
4. Estimated regions可疊在exact body fill上，不做Boolean ownership、subtraction或estimated material area。
5. Exact loading/error與estimated ready是獨立狀態；feature-only section仍 MUST可見。
6. Cross-section pattern不受full-3D instance budget影響。

### 3. Full 3D使用低面數packed instancing

1. Default renderer MUST使用每kind共享的low-poly surface geometry與packed instance buffers；不得為每個
   mark建立React node、Three Object3D、material或geometry。
2. Bump proxy SHOULD不超過20 triangles，via SHOULD不超過24，circuit SHOULD不超過12。
3. Opaque materialized bodies先depth-write；feature marks後畫並depth-test。完全包覆feature由depth buffer
   自然隱藏，部分裸露feature保留可見部分。不得增加CPU containment、CAD Boolean或逐mark ray cast。
4. Unselected envelopes SHOULD batch；selected/hovered highlight可使用少量獨立resource。
5. Budget allocation MUST deterministic且與source array order無關；所有positive-density visible features
   先取得presence機會，再按需求比例分配剩餘budget。

### 4. 品質與效能

1. `Summary`只顯示field/envelope；`Detail`使用manual hard cap；`Auto`依measured interaction frame time與
   hysteresis在bounded tiers間調整，不依GPU vendor/name猜測。
2. Viewer MUST保留DPR 1、no antialias、no realtime shadow與demand rendering baseline。
3. Layout、style、view cache keys MUST分離；opacity、hover、selection不得重建sample layout。
4. Web Worker與impostor renderer只在reference software-WebGL benchmark證明現行adapter未達budget後評估。

### 5. Section bounds與controls

1. Feature view開啟時，navigation/slider/guide bounds MUST使用materialized body與enabled feature envelope
   聯集；feature view關閉時使用body bounds。
2. Exact cap display epsilon仍 MUST只依materialized body bounds計算。
3. 同一組feature master與kind switches MUST同時控制full 3D、3D section與2D estimated layer，不新增第二套
   section-only switches。

## API與未來擴充

Current snapshot已包含normalized geometry JSON，因此本決策不修改preview session、mesh或section API，
也不變更OCC/cache version。Future representation provider可區分：

- `estimated-density`：current envelope + percentage；
- `nominal-explicit-layout`：已有nominal placements但仍非CAD authority；
- `exact-materialized`：成為resolved CAD body並由OCC section負責。

大量explicit placement應使用content-addressed binary asset與spatial index，不應把全部transform塞進
GeometryStructure JSON。

## 拒絕方案

- 把feature envelope加入OCC exact section：錯誤暗示實體材料且增加native CPU工作。
- CPU/CAD hidden-feature classification：camera-dependent visibility無法由containment取代，且對低規格CPU不利。
- Billboard/impostor作為baseline：partial exposure、flat depth、global clipping與shader維護風險較高。
- 大型procedural envelope shader：降低triangle但增加software renderer的fragment fill。
- Occlusion query或額外body depth prepass：對目前bounded low-poly marks收益不足且增加pass/synchronization。

## 驗證基準

- Full-view feature marks draw calls不超過3；unselected envelope batch不超過1。
- Section patterns不超過3 batches，outline不超過1。
- 10,000 marks feature triangles不超過250,000，packed buffers小於2 MiB。
- Common 2,000 layout p95低於16 ms；10,000 layout p95低於50 ms。
- Idle settle 2秒後新增render count為0。
- Software-WebGL Auto interaction p95不超過50 ms，feature-on相對body-only overhead不超過25%。
