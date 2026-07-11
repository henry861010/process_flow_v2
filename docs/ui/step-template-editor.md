# Process Step Template Editor UI

Route：`/admin/processstepeditor`

## Purpose

建立 immutable V2 `ProcessStepTemplate`。Editor 明確分成 geometry ports 與 process
parameters，不提供 geometry parameter type。

## Entry

- `New` 建立空白 template。
- 點選 library template 會 clone 成 draft，並清空 id。
- 既有 template 不可 update；保存 clone 必須使用新 id。
- Library 支援 search 與 delete。

## Identity

Required fields：

- id
- version
- name
- owner
- category
- program

`program` 是 `process_flow_steps` 下不含副檔名的 module path。

## Geometry Ports

Editor 固定提供：

```text
input  main_geometry   role=primary   required=true
output result_geometry
```

兩個 port id 與 primary role 鎖定。使用者可新增、編輯與刪除 auxiliary input ports，並
設定 name 與 required。

所有 ports 目前使用 `dataType: geometry`。

## Parameter Builder

左側清單控制 parameter order，右側編輯 selected definition。支援：

- id、name、description、required、unit；
- value / control type；
- static options 與 selection mode；
- numeric min / max 與 exclusive flags；
- string length / regex；
- recursive repeat definition；
- item name template、index base、min / max items；
- item parameter definitions。

Parameter ids 在同一 collection 內唯一。Nested item parameters 在各自 sibling
collection 內唯一。

## Save

```http
POST /api/process-step-templates
```

Save 前 UI 驗證 required metadata、identifier format、port invariants、duplicate ids、
validation ranges 與 repeat ranges。API 再執行 strict Pydantic 與 kernel contract
validation。

頁面底部 JSON payload 可用於檢查 exact V2 contract。
