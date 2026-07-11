# Process Flow

Process Flow 是 local-first 的半導體製程建模 PoC。它把可重用的 process step、flow
topology、研究中的 workspace、immutable product instance 與 geometry catalog 分開管理，
再由 compiler 產生可執行 plan，交給 kernel、CAD 與 mesher 處理。

## Repository 結構

| 位置 | 職責 |
| --- | --- |
| `apps/viewer` | Next.js static UI、editor working state、HTTP client 與 3D 顯示。 |
| `apps/api` | FastAPI、Pydantic boundary、SQLite repository、workspace transaction、preview/export orchestration。 |
| `packages/kernel-py` | Geometry domain、graph/configuration validation、compile 與 process-step execution；不存取 HTTP 或 SQLite。 |
| `packages/process-step-py` | `process_flow_steps.<program>` 的實際 process operations。 |
| `packages/cad-py` | GeometryStructure 到 GLB / STEP AP242 的轉換。 |
| `packages/mesher-py` | 2.5D mesh 與 text CDB 輸出。 |
| `docs` | Target contract、現行架構、UI 規格、操作手冊與 conformance ledger。 |

系統邊界與 dependency direction 見
[系統架構總覽](docs/architecture/system-overview.md)。

## 文件入口

所有文件從 [docs/README.md](docs/README.md) 開始閱讀。最重要的入口是：

- [核心資料模型](docs/data-model.md)：唯一的 Process Flow normative data contract。
- [UI 規格](docs/ui/README.md)：design system、screen、component、state 與 acceptance case。
- [Target contract 實作對照](docs/conformance.md)：target 與現行程式的唯一差異台帳。
- [本機開發與操作](docs/operations/local-development.md)：完整安裝、啟動、環境變數與疑難排解。

## 最短啟動流程

Python 3.11+ 與 Node.js 18.17+ 是最低基線。完整 dependency 與平台注意事項請依
[本機開發手冊](docs/operations/local-development.md)；以下命令從 repository root 執行：

```bash
python3 -m venv venv
venv/bin/pip install \
  -e packages/kernel-py \
  -e packages/process-step-py \
  -e packages/cad-py \
  -e packages/mesher-py \
  -e 'apps/api[test]'
```

啟動只供受信任本機使用的 API：

```bash
venv/bin/uvicorn process_flow_api.main:app --host 127.0.0.1 --port 8000
```

另一個 terminal 啟動 viewer：

```bash
cd apps/viewer
npm ci
NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL=http://localhost:8000 npm run dev -- -p 3001
```

開啟 `http://localhost:3001`。API OpenAPI UI 位於 `http://127.0.0.1:8000/docs`。

## 驗證

```bash
venv/bin/python -m unittest packages/kernel-py/tests/test_kernel.py
venv/bin/python -m unittest discover apps/api/tests
venv/bin/python -m unittest discover packages/mesher-py/tests
venv/bin/python scripts/check_docs.py
venv/bin/python scripts/check_golden_example.py
cd apps/viewer && npm run build
```

`check_golden_example.py` 會從 `docs/data-model.md` 擷取 canonical PnP example，實際通過
Pydantic、graph validator、compiler 與 kernel execution。

## Security 邊界

目前 API 沒有 authentication 或 authorization；reset endpoint 可清除資料，export endpoint
可寫入／取代 API host 的 absolute path。請維持 loopback binding，不要直接暴露到
untrusted network。
