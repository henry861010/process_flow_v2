# Process Record

## Geometry preview child process flow

本紀錄說明 geometry preview 從前端發出 request、後端執行 preview、child process 匯出 GLB 與 STEP AP242，到回傳前端的完整技術路徑。

### Request path

1. 前端 preview panel 透過 `apps/viewer/components/geometry-preview/geometry-preview-client.ts` 發出 `POST /api/geometry-preview`。
2. Request body 會包含 `previewEdgeId`、draft flow template、draft flow instance、process step templates、available geometries，以及 optional `sourceLabel`。
3. `apps/viewer/app/api/geometry-preview/route.js` 先 normalize request，接著 validate selected edge。這些檢查會在任何 CAD export 工作開始前完成。
4. API route 建立 in-memory repositories，並呼叫 `GeometryKernel.executePreview()`。
5. Kernel 回傳 preview `geometryStructure`，以及 `sourceKind`、`outputStepRefId` 等 preview context。
6. API route 在 Next.js 主程序中組出下載用的 `geometryEntityJson`。
7. 只有最重的 `geometryStructure -> GLB / STEP AP242` 匯出會交給 child process 執行。
8. API route 讀回 child process 產生的 GLB 與 STEP，轉成 base64，最後回傳 `{ geometryEntityJson, glbBase64, stepBase64 }` 給前端。

### Child process export design

`geometryToPreviewExports()` 會在 OS temp folder 建立一次性的工作目錄，將 preview geometry structure 寫入 `geometry-structure.json`，然後啟動：

```txt
node apps/viewer/scripts/geometry-to-glb-worker.mjs <input-json> <output-glb> <output-step> <cad-exporter-js>
```

Worker 的責任很窄，只做 preview CAD exports：

1. 讀取 `<input-json>`。
2. import `src/exporters/cad.js`。
3. 呼叫 `convertCad(geometryStructure, { formats: ["glb"] })`。
4. 使用同一個 OpenCascade instance 匯出 `formats: ["step"]`，並以 `includeFeatureBodies: true` 與 `stepSchema: "AP242"` 產生 STEP AP242。
5. 將產生的 GLB 寫到 `<output-glb>`，STEP 寫到 `<output-step>`。
6. 結束 process。

Parent route 等 worker 結束後讀取 `preview.glb` 與 `preview.step`，接著刪除 temp directory。這讓 request 過程不需要把大型 binary 透過 stdout 傳回，也避免 stdout buffer 成為另一個不穩定因素。

### Why use child process

OpenCascade.js 在 GLB / STEP export 時會載入大型 WebAssembly CAD kernel。若這段工作直接跑在 `next dev` 的 Node process 中，連續 preview 可能讓 V8/WASM 記憶體壓力累積在同一個長生命週期 process 裡。

Child process 的重點是隔離記憶體生命週期：

- Next.js 主程序負責 request validation、kernel preview、response assembly。
- Child process 負責 OpenCascade.js / WASM / GLB 與 STEP AP242 export。
- Worker 結束後，作業系統會回收整個 worker process 的 WASM 記憶體。
- 即使 worker 內部發生 OpenCascade OOM 或 Node fatal error，Next.js 主程序仍可存活並回傳錯誤。

### Concurrency, timeout, and failure behavior

API route 保留 module-level preview export limiter。Limiter 會記錄目前正在執行的 CAD export worker 數量，以及等待中的 preview export jobs。

Worker concurrency 由 `GEOMETRY_PREVIEW_EXPORT_CONCURRENCY` 控制，預設是 `1`。如果 env var 缺失、不是正整數、或小於 `1`，會回到預設值 `1`。

範例：

```txt
GEOMETRY_PREVIEW_EXPORT_CONCURRENCY=1
```

適合開發機或記憶體較小的環境，同一時間只跑一個 OpenCascade worker。

```txt
GEOMETRY_PREVIEW_EXPORT_CONCURRENCY=2
```

適合記憶體較足夠、且需要支援多人同時 preview 的環境。每個 child process 的 WASM memory 仍然彼此獨立，但總 RAM 使用量會隨同時執行的 worker 數量增加。

每個 worker 都有 timeout，預設是 `30000` ms，可透過 `GEOMETRY_PREVIEW_EXPORT_TIMEOUT_MS` 調整。若 worker 超時，parent 會用 `SIGKILL` 結束 worker，並透過既有 API error response path 回傳錯誤。

Parent 會收集 worker 的 `stderr` 與 `stdout`，但有大小上限，避免 fatal stack trace 或大量 log 佔用過多記憶體。Worker 如果非零 exit、被 signal 結束、或發生 OpenCascade crash，parent 會把原因整理成 preview API 的錯誤訊息。

### Files

- `apps/viewer/app/api/geometry-preview/route.js`: request validation、kernel preview execution、export queue、child process orchestration、response assembly。
- `apps/viewer/scripts/geometry-to-glb-worker.mjs`: isolated OpenCascade GLB / STEP AP242 export worker。
- `src/exporters/cad.js`: worker 共用的 CAD conversion implementation。
