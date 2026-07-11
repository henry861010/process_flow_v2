---
title: Category Library
status: normative
owner: Process Flow UI
audience:
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-11
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - apps/viewer/components/category-library/category-library-browser.tsx
  - apps/viewer/lib/category-library.ts
---

# Category Library

## 目的

`CategoryLibraryBrowser<T extends {category:string}>` 是 Geometry、Process Step與Geometry
picker共用的 category drill-down + search shell。它不決定 item card外觀。

## Category 語意

- `category` 以 `.` 分段、trim、移除empty；空值歸到 `uncategorized`。
- Breadcrumb display以 ` / ` 表示，但data path仍是segments array。
- Folder與direct items只取當前prefix；folders用 locale name排序，items保留input order。
- 若level沒有direct items且只有一個folder，自動一路drill-down，直到有items或多folder。
- Folder count包含該descendant下所有records。

Search非category-scoped：query trim + lowercase，對screen傳入的search text做 substring比對；
search active時隱藏breadcrumb/folders，item renderer收到 `showCategoryPath=true`。

## 版面配置

Root column gap `12px`。Search label高度36px、white、border、radius6、shadow、padding x12；
`Search` icon 16px，input flex fill，placeholder由screen傳入。

Breadcrumb：`nav[aria-label="Category path"]`、12px、gap4、單行overflow hidden。
`Root`與每段都是button；每段max-width112px、truncate。separator `/` 是 `aria-hidden`。

Folder row：height40px、full width、white card、padding x12；左 `Folder` 16px + name，右 count
secondary badge + `ChevronRight`。Items的list layout由caller決定，default column gap8。

Empty block：dashed border、muted/30、padding `16px 32px`、centered 14px muted text。

## 狀態矩陣

| State | Render |
| --- | --- |
| `items=[]` | `emptyLabel`；不renderbreadcrumb。 |
| Search + matches | all matching items，顯示每張category path。 |
| Search + no matches | `noSearchResultsLabel`。 |
| Browse + folders/items | breadcrumb + folders + direct items。 |
| Browse + empty path | `noCategoryItemsLabel`。 |
| Path因items更新失效 | auto-resolved level；screen仍應同步path避免舊breadcrumb反覆。 |

## 鍵盤、focus 與 ARIA

- Search使用label wrapping input；其 accessible name SHOULD 由 placeholder外再提供 explicit label
  或 `aria-label`（現行只有placeholder是gap）。
- Breadcrumb/folder都是native buttons，Enter/Space可用，focus ring遵循design system。
- Count badge不需要獨立focus。
- Item accessibility由`renderItem` caller負責；drag-only Geometry card是已知gap。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-LIB-001` | root只有一條folder chain | 自動前進到第一個有items/branches的level。 |
| `UI-LIB-002` | type mixed-case query | 全catalog case-insensitive filter且category path顯示。 |
| `UI-LIB-003` | click Root/segment | path正確截斷，folders/items更新。 |
| `UI-LIB-004` | empty、no match、empty category | 三種caller copy不混用。 |
