---
title: Process Step Template Editor
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-11
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - apps/viewer/components/process-step-template-editor/process-step-template-editor.tsx
  - apps/viewer/lib/process-flow/types.ts
  - apps/viewer/lib/process-flow-api.ts
---

# Process Step Template Editor

Route：`/admin/processstepeditor`

## 目的

建立 immutable `ProcessStepTemplate`。既有 template 只能 clone 成新 ID，不可 update。
Geometry ports與 process parameters是兩套獨立 contract；本頁不得建立 geometry parameter
type。

## Reconstruction entry

1. reset API data 後直接開 `/admin/processstepeditor`，不選 library row。
2. 確認 top bar、library search、fresh identity fields、Geometry Ports、`No parameters` 與 JSON payload。
3. click 一個 library row，確認是 deep clone、source identity 出現、draft id 清空。
4. 依序檢查 auxiliary port、parameter builder、JSON payload 與 immutable save behavior。
5. Review 時若看到 `schema v2` 或 release-like version label，保留現況證據並引用
   `DM-020` / `UI-GAP-VERSION-LABEL-001`；不得把它當成 accepted target。

## 版面配置

| Area | Exact specification |
| --- | --- |
| Main | `min-height:100vh`、column flex、background token。 |
| Top bar | white、bottom border、horizontal `16px`、vertical `12px`、wrap。 |
| Body desktop | `280px minmax(0,1fr)` at `>=1024px`。 |
| Body compact/mobile | one column；library在 editor上方。 |
| Library | white、right border desktop / bottom border mobile。 |
| Editor | own vertical scroll；content max-width `1152px`、padding `20px`、gap `20px`。 |

Top bar 左側依序：36px ghost Back icon（title `Back to flow instances`）、title
`Process Step Template`、`Source: <id>` 或 `New template`。不顯示產品 release 或 schema
generation badge；current implementation 的多餘 badge 記錄為 `UI-GAP-VERSION-LABEL-001`。
右側：`New`、primary `Save Template`。

Validation/success strip只在 message、validation error或duplicate ID存在時render，horizontal
padding `16px`、vertical `8px`。Success emerald；其他目前統一 amber。

## Template library

Search區padding `12px`，input placeholder `Search templates`，左內嵌 `Search` icon。List desktop
最大高度 `calc(100vh - 126px)`、mobile最大高度 `288px`，padding `8px`。

每列顯示 template name、monospace ID、version badge、`<n> inputs` badge。單擊row clone；hover
顯示 `Copy` 與 `Trash2` icon buttons。Active source使用 primary border和 `primary/5` surface。

| Action | Behavior |
| --- | --- |
| Clone row / Copy | deep clone、清空 `id`、選第一個parameter、顯示 source identity。 |
| Delete | native confirm `Delete <name> (<id>)?`；API成功後移除。 |
| Search | case-insensitive比對 name、id、category、program。 |

Delete不是archive；若 API因reference拒絕，保留row並顯示 error。

## Editor sections

每個 section是 white card、radius `6px`、border、small shadow。Header padding `16px 12px`，
body padding `16px`。順序固定：Identity、Geometry Ports、Parameters、JSON payload。

### Identity field 矩陣

Desktop `md` 兩欄；Description跨兩欄。

| Field | Required | Default/validation |
| --- | --- | --- |
| `Template id` | yes | empty；`^[A-Za-z][A-Za-z0-9_.-]*$`、unique。 |
| `Version` | yes | `current`；只是 opaque metadata label。 |
| `Name` | yes | empty。 |
| `Owner` | yes | empty。 |
| `Category` | yes | empty。 |
| `Program` | yes | `process_flow_steps` module path，不含 extension。 |
| `Description` | no | textarea min-height `78px`。 |

### Geometry Ports

Section action `Input Port` 新增 auxiliary input。Port row desktop grid：
`150px 1fr 1fr auto`，mobile一欄，padding `12px`。

| Port | Locked | Editable |
| --- | --- | --- |
| Primary input | `portId=main_geometry`、`role=primary`、`required=true`、`dataType=geometry` | name |
| Auxiliary input | `role=auxiliary`、`dataType=geometry` | portId、name、required、delete |
| Output | exactly one `portId=result_geometry`、`dataType=geometry` | name |

New auxiliary default：`aux_geometry`（去重 suffix）、name `Auxiliary geometry`、required true。
Primary/output右側顯示 `locked` badge；geometry使用 `signal/outline` badge。

### Parameters

Section action `Parameter` 新增 default required string/text parameter。Builder最小高度 `420px`；
desktop `260px minmax(0,1fr)`，`<768px` one column。

左列顯示 name、ID、short value type；selected row是 primary fill。右側header顯示
`parameterDefinitions[index]`，actions依序 Move up、Move down、Delete；沒有selection時中央
顯示 `Select a parameter`。

Definition builder MUST 支援：

- `string`、`integer`、`float`、`boolean`、`materialRef`、`coordinates`；
- `string[]`、`integer[]`、`float[]`、`materialRef[]`；
- recursive `fieldGroupArray`；
- 合法 control 組合、static enum options、selection mode；
- numeric min/max + exclusive flags；string min/max length + regex；
- repeat item name、index base、min/max items、nested definitions。

完整 control matrix見 [Parameter Editor](../components/parameter-editor.md)。`optionSource` 是
enum contract；重複/空/非法 ID、invalid ranges/regex/repeat range都阻止 save。

### JSON payload

Native `<details>`，summary exact copy `JSON payload`。展開後顯示當前 draft的 pretty JSON；
`pre` max-height `384px`、internal scroll、12px monospace。

## Save 與狀態矩陣

| State | Save | Top strip |
| --- | --- | --- |
| Invalid required/ID/port/parameter | disabled | 第一個 validation message，amber。 |
| Draft ID already exists | disabled | `Template ids are immutable. Use a new id for this revision.` |
| Valid new ID | enabled | 無 strip。 |
| Busy | disabled | Save icon變 pulse `CircleDot`。 |
| Success | 因saved ID現已存在而disabled，直到換ID/New | `Saved <id>`，emerald。 |
| API error | disabled只到busy結束 | API/fallback message，現況amber。 |

Save呼叫 `POST /api/process-step-templates`。成功後library按name/ID排序，draft保留saved內容，
source設為saved ID；不做 in-place update。

## 響應式、鍵盤與 ARIA

- `<1024px` library在上、editor在下；library列表限高288px。
- `<768px` identity、port、parameter builder、option row都單欄；document與editor flow可縱向捲動。
- Library secondary buttons目前依 hover opacity顯示；keyboard focus也必須讓它們可見是 target要求。
- Delete uses blocking native confirm；save error不清 draft。
- JSON `<summary>` 可鍵盤展開；所有 native labels須連到control或包覆control。

## 測試 fixture 與 reference 圖片

Fresh capture：reset後進 route，draft為空、library已載入、無 selected parameter。

| Viewport | Asset |
| --- | --- |
| `1440×900` | `../assets/reference/step-template-editor-1440x900.png`（pending：等待 `UI-GAP-VERSION-LABEL-001`） |
| `1024×768` | `../assets/reference/step-template-editor-1024x768.png`（pending） |
| `390×844` | `../assets/reference/step-template-editor-390x844.png`（pending） |

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-PSTE-001` | click library template | deep clone、ID empty、source badge更新，原record不變。 |
| `UI-PSTE-002` | add auxiliary port | primary invariant不變，新port可edit/delete。 |
| `UI-PSTE-003` | add/reorder/delete parameters | array order與selection穩定同步。 |
| `UI-PSTE-004` | create nested repeat + invalid range | Save disabled，第一個明確message可見。 |
| `UI-PSTE-005` | valid unique draft，Save | API新增 immutable record，library排序，success copy正確。 |
| `UI-PSTE-006` | use existing ID | Save disabled，不發 POST。 |
| `UI-PSTE-007` | 390px | controls單欄、沒有整頁horizontal overflow。 |
