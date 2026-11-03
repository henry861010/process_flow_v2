---
title: 系統架構總覽
status: descriptive
owner: integration.platform
audience:
  - software engineers
  - maintainers
  - technical leads
last_verified: 2026-10-31
last_verified_commit: 039906db
source_of_truth:
  - apps/api/src/process_flow_api
  - apps/viewer
  - packages/kernel-py/src/process_flow_kernel
  - packages/process-step-py/src/process_flow_steps
  - packages/geometry_generators/src/process_flow_geometry_generators
  - packages/cad-py/src/process_flow_cad
  - https://github.com/henry861010/mesher/tree/302ebe36663b727669901cbc766ccc0a2ae6f221/src/mesher/process_flow
---

# 系統架構總覽

Process Flow 是 local-first PoC，由 static Next.js viewer、FastAPI/SQLite service、pure-Python process kernel，以及隔離的 CAD/mesher workers 組成。

## Container 視圖

```mermaid
flowchart LR
  Browser["apps/viewer\nstatic Next.js browser app"] -->|"HTTP JSON"| API["apps/api\nFastAPI composition root"]
  API --> Generators["packages/geometry_generators\nregistry + geometry + 2D preview"]
  API --> Schematic["packages/schematic-py\nregistry + composer + shared primitives"]
  API --> Presenters["step / generator companion presenters"]
  Presenters -->|"shared contracts"| Schematic
  API --> Store["SQLite\nJSON snapshots + indexed metadata"]
  API --> Compiler["packages/kernel-py\nFlowCompiler"]
  Compiler --> Plan["ExecutionPlan"]
  Plan --> Kernel["GeometryKernel"]
  Kernel --> Steps["packages/process-step-py\ndynamic process modules"]
  API -->|"subprocess"| CAD["packages/cad-py\nCadQuery/OCP worker"]
  API -->|"subprocess"| Mesher["external mesher 0.2\n2.5D CDB worker"]
```

## 套件職責

| 套件 | 負責 | 不負責 |
| --- | --- | --- |
| `apps/viewer` | Browser interaction、generic SVG schematic／generator preview renderer、working editor state、HTTP clients、standalone 3D presentation | Generator engineering logic、製程呈現規則、canonical persistence、kernel execution rules |
| `apps/api` | HTTP contract、generator 註冊組裝、Pydantic request/response validation、SQLite persistence/transactions、resource orchestration、export job lifecycle | Generator 與 process-step geometry operations |
| `packages/geometry_generators` | Versioned generator manifest、registry、具體實作、engineering preview、component presenters 與 materialization cache | HTTP、SQLite、API application |
| `packages/kernel-py` | Geometry domain、flow validation/compiler、execution plan、step execution、normalization | SQLite、HTTP、CadQuery、frontend state |
| `packages/process-step-py` | Concrete `execute(context)` operations 與 companion schematic presenters | Persistence、API routing、共用 schematic layout |
| `packages/schematic-py` | 純資料契約、registry、composer、基本圖形與共用厚度／排列工具 | Kernel execution、製程專屬呈現規則、HTTP、SQLite |
| `packages/cad-py` | Geometry-to-CadQuery conversion、GLB | Flow compilation、catalog resolution |
| external `mesher` 0.2 | Standard structure to 2.5D mesh/text CDB | Flow compilation、catalog resolution |

Dependency direction 是 `viewer → API → kernel`，API 也依賴獨立的 geometry generator package，並在 `create_app` 明確註冊啟用的實作。API 另外啟動CAD與external mesher workers；
kernel在execution time動態import process-step modules；CAD與mesher process-flow extra使用kernel
的geometry contract。Kernel不依賴API或storage。

Schematic package 不依賴 step、generator 或 API；API composition root 將各 package 的 presenter
註冊到共用 registry。Presenter companion modules 可以使用 schematic 契約；一般 geometry／step
execution 不載入它們，kernel 不保存第二套顯示狀態。

## 核心 runtime flow

### Resource CRUD 流程

FastAPI 的 strict Pydantic models 會拒絕 unknown fields。Service 驗證 domain constraints
後，`SQLiteStore` 把 canonical camelCase JSON 存入 `payload` column，並另外保存 list/query
metadata。現行 flow API 統一為 `/api/process-flows`，完整 topology/configuration 可 CAS 更新。草稿統一為 `/api/process-flow-drafts`。

### Compile 與 execute

API 載入 flow 自有 definition/configuration 及 step templates。Compiler 先選出採用 recipe，進行 dependency pruning 和完整度驗證，再解析 catalog／generator inputs，產生已解析 ExecutionPlan。Kernel 只執行 plan，不讀 recipe 候選或 repository。

### Editor draft commit

草稿保存尚未正式建立 flow 的畫布與完整 configuration。Commit 在同一交易檢查 draft revision、建立 flow 並刪草稿；失敗保留原資料。既有 flow 直接以 CAS revision 更新。正式保存驗證拓樸與已提供值，不執行 generator 或 kernel。

### Preview 與 export

Preview 可以直接解析 flow input，或只執行 step output 的 upstream closure。API 對 target 的最終
snapshot 套用所屬 step／generator presenters 與共用 composer，產生 SVG schematic document；
preview 不載入 CAD mesh 或 exact section。背景 JSON/CDB export job 使用已 ready 的原始 snapshot，
不重新 compile。完整行為與操作限制見
[Preview 與 export pipeline](./preview-export-pipeline.md)。

## Persistence 與生命週期

業務 SQLite schema 16 使用 canonical JSON 加查詢欄位。已知 8–13 格式及 schema 14 經一致性備份後升級；schema 14 清除指向既有 flow 的草稿。Unknown／schema 15 拒絕且不 reset。所有 flows 的 (name, version) 唯一。舊 template／instance 及草稿轉換、embedded geometry 保留與失敗回滾詳見 [Persistence](../reference/persistence.md)。

Export job 是 process-local memory state，不是 SQLite resource。API shutdown 會取消 queued／
running jobs；restart 後 history 會消失。

## 部署邊界

Viewer 使用 `output: "export"`；`NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL` 會在 build time 寫入
browser JavaScript。API CORS 必須包含 static host origin。

現行 service 沒有 authentication 或 authorization。`POST /api/reset` 具有破壞性，export
endpoints 可寫入／取代 server-side absolute path，而 `clientId` 只做 list isolation，不是
security identity。這些 endpoints 只適合受信任的 local environment；對外部署前必須另做
security design。
