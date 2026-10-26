---
title: Target contract 實作對照
status: descriptive
owner: integration.platform
audience:
  - 產品與架構負責人
  - 開發者
  - QA
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
source_of_truth:
  - docs/data-model.md
  - docs/architecture/decisions/0004-semantic-preview-sessions.md
  - docs/architecture/decisions/0008-pnp-mixed-target-shapes.md
  - docs/architecture/decisions/0011-unified-process-flow.md
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
| DM-001 | 正式 flow 至少一 input/step、單一 terminal、preview 使用 result_geometry | Graph validation 與新 flow API 保存驗證已套用；kernel／API tests 覆蓋。 | integration.platform | Closed |
| DM-002 | GeometryStructure 與所有 spatial parameter 固定 `um`；所有 ingestion、compiler 與 consumer boundary 都拒絕其他 unit | Normalizer 保留任意 `unitSystem`，compiler、direct preview/STEP、CAD/mesher 未統一拒絕；`ParameterDefinition.unit` 仍是 free string。`packages/kernel-py/src/process_flow_kernel/serialization/schema.py`、`packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py`、`apps/api/src/process_flow_api/geometry_preview_exporter.py` | integration.platform | Open |
| DM-003 | Density 是 inclusive `0..100` percentage，consumer 只除以 100 一次 | Fixtures與viewer已改用percentage並只除100一次；kernel constructor/hydration仍只驗finite，未一致拒絕negative／`>100`。`packages/kernel-py/src/process_flow_kernel/domain/process_geometry_state.py`、`apps/viewer/components/geometry-preview/geometry-feature-overlay.tsx` | integration.platform | Open |
| DM-004 | `optionSource` 是 strict enum；value type、membership、`selectionMode` 與 control 組合規則在 UI/API/compiler 一致 | Compiler 與 readiness helper 不驗 membership；Pydantic 可能把 boolean option coercion 成 number；省略 array `selectionMode` 的 renderer 行為不等同 `multiple`。`apps/api/src/process_flow_api/models.py`、`packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py`、`apps/viewer/components/process-flow-parameters/parameter-value-editor.tsx` | integration.platform | Open |
| DM-005 | 所有 user-authored Process Flow id 符合 `^[A-Za-z][A-Za-z0-9_.-]*$` | UI 有部分檢查，backend 多數只驗 non-empty。`apps/api/src/process_flow_api/models.py` | integration.platform | Open |
| DM-006 | `workingTemp` 已棄用；新 template 不得宣告，UI/compiler 不得補入 | Seed instances已清除legacy values，但API/kernel仍未禁止新template宣告；若省略`required`仍會依model default成為required。`apps/api/src/process_flow_api/models.py`、`apps/api/src/process_flow_api/fixtures/process-flows.json` | integration.platform | Open |
| DM-007 | `GeometryEntity` Python/TypeScript 的 required、nullable 與 canonical omission policy 一致 | Backend metadata 多為 nullable，TypeScript 多為 required，而 `structure` 反為 optional。`apps/api/src/process_flow_api/models.py`、`apps/viewer/lib/process-flow/types.ts` | integration.platform | Open |
| DM-008 | Optional input readiness 依有效 upstream closure，包含採用 recipe 的 PnP [] 裁剪 | Compiler 與 viewer dependency helpers 使用 selectedRecipeId；partial preview 與 zero-placement tests 覆蓋。 | integration.platform | Closed |
| DM-009 | `controlType` 必填且必須是 `valueType` 的合法組合 | Pydantic 允許省略，backend/compiler 不驗組合規則。`apps/api/src/process_flow_api/models.py` | integration.platform | Open |
| DM-010 | Step-template create 驗證 `program` locator grammar 與 module loadability | Invalid path/module 可保存，直到 execute 才由 resolver 失敗。`apps/api/src/process_flow_api/services.py`、`packages/kernel-py/src/process_flow_kernel/infrastructure/module_resolver.py` | integration.platform | Open |
| DM-011 | Catalog ingestion 應驗證 geometry；flow save 不生成 geometry | Catalog validation 保留；embedded runtime 已移除；flow save 只驗 binding 引用，完整生成留到預覽／執行。 | integration.platform | Closed |
| DM-012 | Repeat wrapper/item strict、`itemId` 合法唯一、`index` 為 integer；`items[]` order 是 execution order且不得依 `index` reorder | Compiler 忽略 wrapper/item extras，只驗 itemId non-empty/unique，未驗 regex/index type。`packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py` | integration.platform | Open |
| DM-013 | Canonical persisted JSON 省略 optional `null`；selectedRecipeId 的 null 選擇必須保留 | API model dump 省略 null，但 raw fixtures 保留部分 null。`apps/api/src/process_flow_api/fixtures` | integration.platform | Open |
| DM-014 | 新 canonical timestamp 使用 RFC 3339 UTC `Z` | Server 以 `datetime.isoformat()` 輸出 `+00:00`。`apps/api/src/process_flow_api/repository.py` | integration.platform | Open |
| DM-015 | Seed／ZIP import 驗證新模型、拓樸、候選已提供值與 catalog refs | `apps/api/src/process_flow_api/seed.py` 與 fixture archive 驗證；generator 完整度在使用時驗證。 | integration.platform | Closed |
| DM-016 | Schema migration 保留資料、備份、交易與 marker 一致 | schema 11／13、collision、SQL failure rollback、unknown／15 拒絕測試見 `apps/api/tests/test_flow_migration.py`。 | integration.platform | Closed |
| DM-017 | Stored read/list payload 在離開 repository 前重新通過 response model | Repository 直接 `json.loads(payload)` 回傳，corrupt/raw資料可略過 model。`apps/api/src/process_flow_api/repository.py` | integration.platform | Open |
| DM-018 | Non-empty names/category/program/owner、positive `iconScale`、opaque non-empty `version`、`structureFormat: "standard"` 等 metadata constraints 一致 | 多數欄位仍是 unconstrained `str`／`float`；空字串、負 scale 與任意 format 可通過 Pydantic。`apps/api/src/process_flow_api/models.py` | integration.platform | Open |
| DM-019 | Normalized structure-local ids 保留或 deterministic 產生，且全 structure 唯一 | Hydration/serialization 未完整保留 explicit ids，也未一致驗 uniqueness。`packages/kernel-py/src/process_flow_kernel/serialization` | integration.platform | Open |
| DM-020 | 未正式發行前，內建 template fixture/default 使用 `V0.0.0`、geometry fixture/default 使用 `v0.0.0`，且 label 不驅動行為 | Fixtures、editor defaults 與 generator save default 已歸零；API 仍保留使用者提供的 opaque non-empty label。Evidence：`apps/api/tests/test_api.py` 的 `test_seed_resources_use_unreleased_versions_and_resolvable_ids` 與 `test_step_template_create_duplicate_and_delete_unavailable` | integration.platform | Closed |
| DM-021 | 同一PnP batch可交錯absolute rectangle與polygon target；Box source的所有root direct features可轉exact polygon，children維持relative rigid translation | Runtime逐筆將absolute target轉成adapter-local frame並以absolute center放回；compiler固定zero pose／center anchor。測試覆蓋mixed order、root bump metadata、突出child translation、source immutability與atomic rejection。`packages/process-step-py/src/process_flow_steps/pnp/pnp.py`、`packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py`、`packages/kernel-py/tests/test_adaptive_pnp.py` | integration.platform | Closed |
| DM-022 | Step label 屬於 flow 自有 definition，副本不連動 | ADR-0011 取代原 restricted update；完整 flow update 與 copy independence tests 覆蓋。 | integration.platform | Closed |

## Semantic preview session

Target authority是
[ADR-0004](./architecture/decisions/0004-semantic-preview-sessions.md)。本表對照accepted target、current
session path與仍保留的legacy single-GLB path；文件不得把下列Open項目描述成已完成驗收。

| ID | Target | Current implementation / evidence | Owner | 狀態 |
| --- | --- | --- | --- | --- |
| PV-001 | `POST /api/preview-sessions`一次執行selected upstream closure，manifest含每個executed upstream snapshot；snapshot切換不重跑flow，LRU eviction後可用原request重建相同identities | 已實作content-derived session/snapshot ids、bounded LRU、bounded in-flight admission、single-flight coalescing與ordered timeline；capacity overload回retryable 503，legacy endpoint仍保留但UI不依賴。Evidence：`apps/api/src/process_flow_api/preview_sessions.py`、`apps/api/src/process_flow_api/services.py`、`apps/viewer/components/geometry-preview/geometry-preview-panel.tsx`、`apps/api/tests/test_api.py`的`ProcessFlowApiTests.test_preview_session_step_timeline_compiles_and_executes_once`及`test_preview_section_inflight_limit_returns_retryable_503` | integration.platform | Closed |
| PV-002 | Snapshot以geometryHash/version定位binary GLB；mesh response為`model/gltf-binary`、content-derived ETag、private immutable cache並支援304；session JSON不inline base64 mesh，viewer reuse相同geometryHash model | 已實作lazy binary mesh endpoint、byte/entry bounded cache、ETag/304與viewer model cache。Evidence：`apps/api/src/process_flow_api/preview_sessions.py`、`apps/viewer/components/geometry-preview/geometry-preview-client.ts`、`apps/api/tests/test_api.py`的`ProcessFlowApiTests.test_preview_session_flow_input_mesh_cache_etag_and_not_found` | integration.platform | Closed |
| PV-003 | X/Y vertical section endpoint對resolved OpenCascade CadBody產生strict deterministic body/material regions、exact CAD area與tolerance-bounded closed contours；同geometry的多position reuse prepared OCC model；viewer以同一response顯示3D cap/2D section且無stale result | 已實作prepare-once CadQuery/OpenCascade section、共面material ownership difference、per-model serialized queries、bounded prepared cache/single-flight、snapshot-correct strong ETag、strict API model、debounced/cancelable request、closed caps與depth-tested boundary outlines。Evidence：`packages/cad-py/src/process_flow_cad/section.py`、`apps/api/src/process_flow_api/preview_sessions.py`、`apps/viewer/components/geometry-preview/geometry-section-caps.tsx`、`apps/viewer/components/geometry-preview/geometry-section-view.tsx`、`apps/api/tests/test_cad_exporter.py`的`test_prepared_section_resolves_once_for_multiple_positions`、`test_section_coplanar_child_wall_has_exclusive_material_ownership`、`test_section_coplanar_siblings_use_stable_body_identity_priority`與`apps/api/tests/test_api.py`的`test_preview_session_prepares_cad_once_for_multiple_section_positions`、`test_preview_session_exact_section_cache_etag_and_validation` | integration.platform | Closed |
| PV-004 | Three.js baseline使用demand rendering、DPR 1、tight near/far、opaque FrontSide bodies、無realtime shadow與無accelerated-context 2D-section fallback；以representative fixture驗證idle/frame behavior | Core implementation已切至`frameloop="demand"`、explicit invalidate、DPR 1、low-power context、tight clip、opaque/no-shadow materials與Canvas fallback；尚無automated browser performance/idle acceptance。`apps/viewer/components/viewer/viewer-scene.tsx`、`apps/viewer/components/viewer/model-loader.ts` | integration.platform | Open |
| PV-005 | Density envelope/hatch/glyph明示`Estimated density`、default off、全數depth-test，且不包含於OCC exact body section；`direction`/`koz`未套用時不得暗示exact | Viewer已改為Estimated label、master default off、wireframe/highlight與depth-tested glyph/hatch；CAD section排除feature envelopes。CAD exclusion有`apps/api/tests/test_cad_exporter.py`的`CadExporterTests.test_section_does_not_materialize_density_features`，但Estimated UI/depth policy尚無automated browser acceptance。`apps/viewer/components/geometry-preview/geometry-feature-overlay.tsx`、`apps/viewer/components/geometry-preview/geometry-preview-panel.tsx` | integration.platform | Open |
| PV-006 | Estimated feature field使用低面數packed instancing；full-view由body depth判斷裸露，3D/2D section共用client-side envelope intersection與fixed pattern；density 0不產生marks；exact API不變 | Pure feature model/layout/section與shared 3D/SVG consumers已實作，包含Box/Cylinder/Cone/Polygon、hole與deterministic budget unit tests；仍缺browser/software-WebGL performance acceptance。`apps/viewer/lib/geometry-preview/features/`、`apps/viewer/components/geometry-preview/geometry-feature-overlay.tsx`、`geometry-feature-section-caps.tsx`、`geometry-section-view.tsx` | Process Flow UI | Open |

## UI

| ID | Target | Current implementation / evidence | Owner | 狀態 |
| --- | --- | --- | --- | --- |
| UI-IA-001 | Home／Management 使用單一 Flow 列表，統一編輯器支援更新／另存／草稿恢復 | 已移除兩種 editor；見 UI-FLOW-001 至 008 與 `apps/viewer/app/management/page.tsx`。 | Process Flow UI | Closed |
| UI-GAP-A11Y-001 | Modal 有 dialog semantics、focus trap、initial focus 與 focus restore | Flow editor、Preview、Export 已使用共用 dialog stack／focus lifecycle；其他自製 overlay 與 background inert 仍需完整檢閱。`apps/viewer/components` | integration.platform | Open |
| UI-GAP-DRAG-001 | Geometry Input 可由 keyboard/touch command 新增 | Flow Editor 的 geometry palette 只有 HTML drag；touch-only mobile 無 fallback。`apps/viewer/components/process-flow-editor/process-flow-editor.tsx` | integration.platform | Open |
| UI-GAP-RESP-001 | Compact viewport 不遺失 command 或 pane | `lg` 三欄最小寬約 1140px，1024px viewport 可能裁切右 pane。`apps/viewer/components/process-flow-editor/process-flow-editor.tsx` | integration.platform | Open |
| UI-GAP-MODAL-STACK-001 | Nested modal 的 Escape/backdrop/close 只作用於最上層 overlay | Node Editor／Preview／Export 使用共用 dialog stack；UI-FLOW-008 實測 Escape 只關閉 Export 並還原 trigger，見 [操作紀錄](ui/evidence/unified-flow-editor/README.md)。 | integration.platform | Closed |

## 維護方式

- 新發現的差異先新增 ID，再修改 target 或 implementation；ID 不重用。
- 差異關閉時必須把狀態改為 `Closed`、連到 executable validation evidence，並更新
  `last_verified` / `last_verified_commit`。
- 本表不得用來永久替代 issue tracker；它確保 repository 內的文件不會隱藏已知 drift。

## Unified ProcessFlow schema 3

| ID | Contract | Evidence | 狀態 |
| --- | --- | --- | --- |
| FLOW-001 | Flow 自有 definition/configuration、候選與 null selection、無 embedded/舊 payload | models、recipes helpers、test_process_flows、viewer recipes tests | Closed |
| FLOW-002 | 更新／刪除 CAS、原 origin 保留、編輯器不提供複製與另存 | test_process_flows、viewer save tests | Closed |
| FLOW-003 | 草稿 schema 2 僅供新 flow、atomic commit failure 保留草稿、14→16 清除舊 target 草稿 | test_process_flows、test_flow_migration | Closed |
| FLOW-004 | 採用候選決定執行／PnP pruning／preview cache，input preview 不依賴無關站點 | kernel tests、test_process_flows、test_api | Closed |
| FLOW-005 | 三檔 ZIP、bootstrap processFlows、舊 API 退場 | test_api、test_process_flows | Closed |
| FLOW-006 | Unified editor 完整操作與 keyboard、409、preview/export | UI-FLOW-001 至 008，見 [自動測試與操作紀錄](ui/evidence/unified-flow-editor/README.md)；既有 responsive／drag gaps 另列。 | Closed |

Schema 15 是已捨棄的實驗格式，拒絕遷移屬預期行為。真實資料庫只能先在 schema 11／13 的副本驗證；不可改 marker 強行升級。

本次測試結果、外部 mesher 版本差異，以及真實 schema 15 副本拒絕升級的紀錄，見 [驗證報告](ui/evidence/unified-flow-editor/README.md)。
