---
title: Target contract 實作對照
status: descriptive
owner: integration.platform
audience:
  - 產品與架構負責人
  - 開發者
  - QA
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - docs/data-model.md
  - apps/api/src/process_flow_api/
  - apps/viewer/
  - packages/kernel-py/
---

# Target contract 實作對照

本頁是 repository 內唯一的 implementation-gap ledger；其他文件只能引用 ID，不得另維護
current/target/status table。Target 定義仍以 [data-model.md](./data-model.md)、accepted ADR 與
UI normative reference 為準。本頁的 `Open` 不會降低 target contract 的效力。

## Data contract 與 runtime

| ID | Target | Current implementation / evidence | Owner | 狀態 |
| --- | --- | --- | --- | --- |
| DM-001 | Persisted flow 至少一 input/step、恰好一個 terminal；default execute 不依 array order；preview `outputPortId` 只能是 `result_geometry` | Backend 接受 empty／multiple terminal，kernel 選 terminal list 最後一項；preview model 接受且 service 忽略其他 `outputPortId`。`packages/kernel-py/src/process_flow_kernel/application/flow_validation.py`、`packages/kernel-py/src/process_flow_kernel/application/geometry_kernel.py`、`apps/api/src/process_flow_api/models.py` | integration.platform | Open |
| DM-002 | GeometryStructure 與所有 spatial parameter 固定 `um`；所有 ingestion、compiler 與 consumer boundary 都拒絕其他 unit | Normalizer 保留任意 `unitSystem`，compiler、direct preview/STEP、CAD/mesher 未統一拒絕；`ParameterDefinition.unit` 仍是 free string。`packages/kernel-py/src/process_flow_kernel/serialization/schema.py`、`packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py`、`apps/api/src/process_flow_api/geometry_preview_exporter.py` | integration.platform | Open |
| DM-003 | Density 是 inclusive `0..100` percentage，consumer 只除以 100 一次 | Kernel constructor/hydration range checks 不一致；fixtures 有 `0..1` 值；viewer 對 `<=1` 使用 hybrid interpretation。`packages/kernel-py/src/process_flow_kernel/domain/process_geometry_state.py`、`apps/viewer/components/geometry-preview/geometry-feature-overlay.tsx` | integration.platform | Open |
| DM-004 | `optionSource` 是 strict enum；value type、membership、`selectionMode` 與 control 組合規則在 UI/API/compiler 一致 | Compiler 與 readiness helper 不驗 membership；Pydantic 可能把 boolean option coercion 成 number；省略 array `selectionMode` 的 renderer 行為不等同 `multiple`。`apps/api/src/process_flow_api/models.py`、`packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py`、`apps/viewer/components/process-flow-parameters/parameter-value-editor.tsx` | integration.platform | Open |
| DM-005 | 所有 user-authored Process Flow id 符合 `^[A-Za-z][A-Za-z0-9_.-]*$` | UI 有部分檢查，backend 多數只驗 non-empty。`apps/api/src/process_flow_api/models.py` | integration.platform | Open |
| DM-006 | `workingTemp` 已棄用；新 template 不得宣告，UI/compiler 不得補入 | API/kernel 未禁止新宣告；seed step templates 仍普遍包含，並因 default `required: true` 成為 required。`apps/api/src/process_flow_api/fixtures/process-step-templates.json` | integration.platform | Open |
| DM-007 | `GeometryEntity` Python/TypeScript 的 required、nullable 與 canonical omission policy 一致 | Backend metadata 多為 nullable，TypeScript 多為 required，而 `structure` 反為 optional。`apps/api/src/process_flow_api/models.py`、`apps/viewer/lib/process-flow/types.ts` | integration.platform | Open |
| DM-008 | Optional input readiness 只依 preview target 的 upstream closure | Compiler 依 closure；frontend helper 依整張 graph 判定。`packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py`、`apps/viewer/lib/process-flow/configuration.ts` | integration.platform | Open |
| DM-009 | `controlType` 必填且必須是 `valueType` 的合法組合 | Pydantic 允許省略，backend/compiler 不驗組合規則。`apps/api/src/process_flow_api/models.py` | integration.platform | Open |
| DM-010 | Step-template create 驗證 `program` locator grammar 與 module loadability | Invalid path/module 可保存，直到 execute 才由 resolver 失敗。`apps/api/src/process_flow_api/services.py`、`packages/kernel-py/src/process_flow_kernel/infrastructure/module_resolver.py` | integration.platform | Open |
| DM-011 | Used geometry 在 create/commit 前 deep validate、canonicalize，並拒絕 unknown fields | API envelope 只把 `structure` 當 object；deep hydration 延後；embedded commit 直接 materialize raw payload，不使用 normalized plan。`apps/api/src/process_flow_api/models.py`、`apps/api/src/process_flow_api/workspace_service.py` | integration.platform | Open |
| DM-012 | Repeat wrapper/item strict、`itemId` 合法唯一、`index` 為 integer；`items[]` order 是 execution order且不得依 `index` reorder | Compiler 忽略 wrapper/item extras，只驗 itemId non-empty/unique，未驗 regex/index type。`packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py` | integration.platform | Open |
| DM-013 | Canonical persisted JSON 省略 optional `null` | API model dump 省略 null，但 raw fixtures 保留部分 null。`apps/api/src/process_flow_api/fixtures` | integration.platform | Open |
| DM-014 | 新 canonical timestamp 使用 RFC 3339 UTC `Z` | Server 以 `datetime.isoformat()` 輸出 `+00:00`。`apps/api/src/process_flow_api/repository.py` | integration.platform | Open |
| DM-015 | Seed/import 通過與 create 相同的 Pydantic、graph、compiler 與 geometry validation | Seed path 直接 insert raw JSON。`apps/api/src/process_flow_api/repository.py`、`apps/api/src/process_flow_api/seed.py` | integration.platform | Open |
| DM-016 | Database marker 與 physical DDL 一致；不符合目前 schema 時必須 recreate 或 fail | Mismatch 只刪 rows 並更新 marker，不驗 legacy columns/indexes。`apps/api/src/process_flow_api/repository.py` | integration.platform | Open |
| DM-017 | Stored read/list payload 在離開 repository 前重新通過 response model | Repository 直接 `json.loads(payload)` 回傳，corrupt/raw資料可略過 model。`apps/api/src/process_flow_api/repository.py` | integration.platform | Open |
| DM-018 | Non-empty names/category/program/owner、positive `iconScale`、opaque non-empty `version`、`structureFormat: "standard"` 等 metadata constraints 一致 | 多數欄位仍是 unconstrained `str`／`float`；空字串、負 scale 與任意 format 可通過 Pydantic。`apps/api/src/process_flow_api/models.py` | integration.platform | Open |
| DM-019 | Normalized structure-local ids 保留或 deterministic 產生，且全 structure 唯一 | Hydration/serialization 未完整保留 explicit ids，也未一致驗 uniqueness。`packages/kernel-py/src/process_flow_kernel/serialization` | integration.platform | Open |
| DM-020 | 未正式發行前，新 resource 的 `version` metadata label 固定為 `current`，不表示 release generation | Current fixtures 與 editor defaults 仍使用 release-like numbered labels。`apps/api/src/process_flow_api/fixtures`、`apps/viewer/components/process-step-template-editor/process-step-template-editor.tsx`、`apps/viewer/components/process-flow-template-editor/process-flow-template-editor.tsx` | integration.platform | Open |

## UI

| ID | Target | Current implementation / evidence | Owner | 狀態 |
| --- | --- | --- | --- | --- |
| UI-GAP-A11Y-001 | Modal 有 dialog semantics、focus trap、initial focus 與 focus restore | 多個自製 overlay 只有 Escape/backdrop/close button，缺完整 ARIA/focus lifecycle。`apps/viewer/components` | integration.platform | Open |
| UI-GAP-DRAG-001 | Geometry Input 可由 keyboard/touch command 新增 | Flow Template Editor 的 geometry palette 只有 HTML drag；touch-only mobile 無 fallback。`apps/viewer/components/process-flow-template-editor/process-flow-template-editor.tsx` | integration.platform | Open |
| UI-GAP-RESP-001 | Compact viewport 不遺失 command 或 pane | `lg` 三欄最小寬約 1140px，1024px viewport 可能裁切右 pane。`apps/viewer/components/process-flow-template-editor/process-flow-template-editor.tsx` | integration.platform | Open |
| UI-GAP-VERSION-LABEL-001 | UI 不把 internal schema marker 當成產品 generation badge，new-resource default 顯示 `current` | Step editor 仍顯示 schema generation badge；step/flow editors 預填 release-like numbered label。`apps/viewer/components/process-step-template-editor/process-step-template-editor.tsx`、`apps/viewer/components/process-flow-template-editor/process-flow-template-editor.tsx` | integration.platform | Open |

## 維護方式

- 新發現的差異先新增 ID，再修改 target 或 implementation；ID 不重用。
- 差異關閉時必須把狀態改為 `Closed`、連到 executable validation evidence，並更新
  `last_verified` / `last_verified_commit`。
- 本表不得用來永久替代 issue tracker；它確保 repository 內的文件不會隱藏已知 drift。
