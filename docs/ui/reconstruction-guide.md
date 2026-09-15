---
title: UI Reconstruction Guide
status: normative
owner: Process Flow UI
audience:
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-12
last_verified_commit: 2b9cad3675483da156a92d0a08ec12671f4f1b62
source_of_truth:
  - docs/ui/README.md
  - docs/ui/screens
  - docs/ui/components
  - docs/ui/interaction-patterns.md
  - docs/ui/acceptance/README.md
---

# UI Reconstruction Guide

本文件是沒有讀過既有 component code 的實作者的最短入口。它把 canonical fixture、route
入口、主要操作旅程與完成條件串起來；精確尺寸、copy、token 與 component contract 仍以
各 screen/component 規格為準。

## 使用方式

重建或 review 前先完成：

1. 依 [本機開發手冊](../operations/local-development.md) 啟動 API 與 Viewer。
2. 呼叫 `POST /api/reset`，等待 `/api/bootstrap` 完成。
3. 固定 browser zoom `100%`、light scheme、locale `en-US`，依序檢查
   `1440×900`、`1024×768`、`390×844`。
4. 由下表選擇 route 與 entry state；不要依賴上一個 route 留下的 client state。
5. 先完成 semantic acceptance，再擷取 accepted reference screenshot。

## Route 與 entry state

| Route | Entry state | 主要 fixture / setup | 第一個檢查點 |
| --- | --- | --- | --- |
| `/` | Home ready | reset 後完整 bootstrap | template cards、instance counts與create routes |
| `/flow-template-editor` | fresh template draft | reset 後直接開 route，不選 template | catalog/step palettes、空 graph與單一save command |
| `/flow-instance-editor?templateId=flow_tpl_aaa_demo` | blank AAA configuration | 由Home點AAA template card | fixed template、From instance、default configuration與Save |
| `/hbm-editor`、`/dram-editor` | generator defaults | 由Home create command進入 | matching registry definition、preview與Save to DB |
| `/management` | resource overview | reset 後完整 bootstrap | 四類count、tabs與唯讀rows |
| `/admin/processstepeditor` | fresh step draft | reset 後直接開 route，不 clone template | library、empty identity、Geometry Ports、No parameters |
| `/cad-viewer` | demo workbench | 直接開 route，不 import file | demo model、Section XZ、Grid/Axes on、ISO |
| Geometry Preview | ready preview | Instance Editor 綁定 `panel_plp_310x310mm_glass` 後開 Preview | Loading → Ready、viewport、right controls、footer |

## 主要操作旅程

### Template topology

```text
fresh draft
  -> click Step template
  -> drag Geometry item to graph
  -> connect valid ports
  -> single-click node
  -> edit inspector
  -> Save Template
  -> enter template information in save dialog
  -> topology locked, configuration remains editable
  -> open Preview when target is ready
```

必要結果：

- Step palette 必須支援 click-add；Geometry palette 的 touch/keyboard fallback 是已知 gap。
- graph node 的 primary editor path 是單擊，不得要求雙擊。
- Template metadata不在editor常駐顯示；Save Template才開啟save dialog。
- Save Template 可在configuration incomplete時開dialog並成功保存，但會鎖topology。
- topology locked 後，catalog binding、parameters 與 Preview 仍依規格可用。

對應驗收：`UI-FTE-001`、`UI-FTE-002`、`UI-FTE-003`、`UI-FTE-004`、`UI-GRAPH-001`。

### Instance configuration

```text
Home AAA template card
  -> templateId route
  -> default configuration created
  -> optionally load From instance values
  -> bind geometry / edit parameters
  -> Preview a ready target
  -> Save
  -> enter id/name/version/owner/description
  -> create immutable instance
  -> return Home
```

必要結果：

- Template只能由route決定；不得render selector。
- From instance只列同template records，只copy values並重設new identity。
- dirty時啟用離頁與source-replacement protection。
- complete configuration才可Save；duplicate/invalid identity留在dialog顯示error。
- Save使用direct create且不得修改source instance；成功後返回Home。
- `workspaceId`顯示unsupported message；backend workspace API保留。

對應驗收：`UI-FIE-001` 至 `UI-FIE-007`。

### Preview 與 Export

```text
ready target
  -> open Geometry Preview
  -> Loading
  -> Ready or Error
  -> open Export JSON / STEP / CDB
  -> submit valid path
  -> drawer expands with queued/running job
  -> terminal success/failed/canceled state
```

必要結果：

- Preview request 只使用 target upstream closure；無關 branch 不得阻擋 ready target。
- 關閉 Preview 要 abort 仍在進行的 request，但不得取消已建立的 export job。
- Export form 位於 Preview 之上；最上層 modal 的 close、Escape、backdrop 行為不得穿透到下層。
- job polling 使用 `1800ms` active interval 與 `5000ms` idle interval。

對應驗收：`UI-PREVIEW-001` 至 `UI-PREVIEW-007`、`UI-EXPORT-001` 至 `UI-EXPORT-008`。

### Standalone CAD

```text
demo
  -> choose X/Y/Z axis or section XZ/YZ
  -> import by file input or drop
  -> inspect Loading / Imported / Error
  -> Reset
  -> demo restored, current cameraView retained
```

必要結果：

- Reset 清除 imported model 與 error，重新 fit，但保留目前 camera view。
- failed import 保留原本可檢視的 model，不清空 viewport。
- mobile 順序是 viewport 在前、controls 在後；不得產生整頁 horizontal overflow。

對應驗收：`UI-CAD-001` 至 `UI-CAD-006`。

## 重建完成定義

重建版本只有在以下條件全部具備時才可視為完成：

- route、fixture、entry state 與 acceptance ID 可由文件直接找到。
- visible copy、icon、button order、default、disabled reason 與規格一致。
- loading、empty、error、success、disabled、locked/committed state 均有對應 semantic case。
- Desktop、compact、mobile 的 scroll owner 與 breakpoint 行為一致。
- current gap 沒有被靜默改寫成 normative behavior。
- reference screenshot 只在 target state 確認後寫入 `assets/reference/`。
