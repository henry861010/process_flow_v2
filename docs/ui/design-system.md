---
title: Design System
status: normative
owner: Process Flow UI
audience:
  - design
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-11
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - apps/viewer/app/globals.css
  - apps/viewer/tailwind.config.ts
  - apps/viewer/components/ui
---

# Design System

本文件固定 Process Flow 現行 UI 的視覺 primitives。除非 screen/component 規格明確
覆寫，所有數值皆為 MUST。

## 色彩 tokens

所有 role color 以 CSS custom property 的 HSL components 儲存，使用時包成
`hsl(var(--token))`。

| Token | HSL components | 用途 |
| --- | --- | --- |
| `--background` | `204 28% 97%` | page/app background |
| `--foreground` | `204 24% 14%` | primary text、dim backdrop base |
| `--card` | `0 0% 100%` | card surface |
| `--card-foreground` | `204 24% 14%` | card text |
| `--popover` | `0 0% 100%` | popover/dialog surface |
| `--popover-foreground` | `204 24% 14%` | popover text |
| `--primary` | `168 76% 25%` | primary command、active icon、graph source |
| `--primary-foreground` | `0 0% 100%` | text on primary |
| `--secondary` | `203 22% 91%` | quiet badge/control |
| `--secondary-foreground` | `204 24% 14%` | text on secondary |
| `--muted` | `202 19% 92%` | subdued header、disabled surface |
| `--muted-foreground` | `204 12% 42%` | metadata、hint |
| `--accent` | `46 88% 55%` | outline-button hover |
| `--accent-foreground` | `203 29% 11%` | text on accent |
| `--destructive` | `0 74% 48%` | error、delete、invalid |
| `--destructive-foreground` | `0 0% 100%` | text on destructive |
| `--border` | `203 17% 82%` | default border |
| `--input` | `203 17% 82%` | input border |
| `--ring` | `190 90% 38%` | keyboard focus |
| `--radius` | `0.5rem` | radius base |

### 語意狀態色

| State | Strong | Soft/border | 使用處 |
| --- | --- | --- | --- |
| Ready/success | `emerald-500 #10b981` | `emerald-50`、`emerald-200` | graph、success strip、active block |
| Incomplete/warning | `amber-500 #f59e0b` | `amber-50`、`amber-200/300` | incomplete graph、validation notice |
| Error | `--destructive` / `#dc2626` graph fallback | `destructive/5`、`destructive/30` | invalid、failed job |
| Neutral | `slate-400 #94a3b8` | `muted-foreground/20..40` | optional、canceled |
| Port input | `cyan-600` | white 2px outline | Process Step target handle |

State MUST 同時有文字或 icon，不可只以顏色傳達。

### Viewer 專用色

| Role | Value |
| --- | --- |
| Viewer page gradient | `linear-gradient(180deg,#f5f8f9 0%,#e7eef1 100%)` |
| Preview viewport | `#f5f8f9` |
| Section plane | `#1aa7d2` at `0.16` opacity |
| Via feature | `#12a8c6` |
| Circuit feature | `#2ea85d` |
| Bump feature | `#d8ad2f` |

`.viewer-surface` MUST 依序疊加：

```css
background:
  linear-gradient(180deg, rgba(255,255,255,.84), rgba(235,241,244,.96)),
  radial-gradient(circle at 20% 0%, rgba(24,168,213,.08), transparent 32%),
  radial-gradient(circle at 90% 12%, rgba(231,190,37,.08), transparent 30%);
```

## 字體排印

Font stack MUST 是：

```text
-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC",
"PingFang TC", "Microsoft JhengHei", "Helvetica Neue", Arial, sans-serif
```

啟用 `liga` 與 `calt`。常用 scale：

| Role | Size / line-height | Weight |
| --- | --- | --- |
| Screen title (`text-xl`) | `20 / 28px` | `600` |
| Dialog title (`text-lg`) | `18 / 28px` | `600` |
| Section/body (`text-sm`) | `14 / 20px` | `400` 或 `500/600` |
| Label/metadata (`text-xs`) | `12 / 16px` | `400/500/600` |
| Compact identity | `10px` 或 `11px` / normal | monospace |

IDs、revision、path、numeric readout MUST 使用 browser monospace stack。Heading 不使用
超過 `20px` 的 display type；本產品不是 marketing surface。

## 間距、尺寸與圓角

基礎 spacing unit 是 `4px`。主要 page padding `20px`，compact panel `12px` 或 `16px`，
control gap `8px`，section gap `16px` 或 `20px`。

| Primitive | Exact size |
| --- | --- |
| Default input/select | height `36px`、horizontal padding `12px` |
| Default button | height `36px`、horizontal padding `16px` |
| Small button | height `32px`、horizontal padding `12px` |
| Large button | height `40px`、horizontal padding `20px` |
| Icon button | `36 × 36px` |
| Small icon button | `32 × 32px` |
| Modal page margin | `16px`；Preview 是 mobile `12px`、`sm` 以上 `24px` |
| Default card radius (`rounded-md`) | `6px` |
| Viewer radius (`rounded-lg`) | `8px` |
| Small radius (`rounded-sm`) | `4px` |
| Default border | `1px` |
| Status/settings border | `2px` |
| Viewer shadow | `0 24px 80px rgba(9,22,34,.18)` |

Disabled controls MUST 保留 layout，使用 `opacity: .5` 或 muted surface，並阻止 pointer
events。Interactive target SHOULD 不小於 `32 × 32px`；mobile target target 是 `44px` 的
改善項，但目前 32/36px controls 不得在重建時任意放大而造成 screenshot drift。

## 響應式斷點

採 Tailwind default、mobile-first：

| Name | Min width | 本專案用途 |
| --- | --- | --- |
| `sm` | `640px` | Preview overlay margin、Home padding |
| `md` | `768px` | two-column forms、coordinate/GDS layout、larger title |
| `lg` | `1024px` | Template 三欄、CAD/Preview viewport + right pane |
| `xl` | `1280px` | Template header five/three-column field grids |
| `2xl` | `1536px` | Instance header five-column field grid、container max `1400px` |

`1024 × 768` 在 `lg` 規則內；不可把它當 mobile。每份 screen 文件會說明此邊界的
overflow 及 scroll owner。

## Surface 與捲動責任

| Surface | Background | Scroll owner |
| --- | --- | --- |
| Home | page background | document；table 自己 horizontal scroll |
| Template Editor desktop | white header + graph/palettes | page locked；左右 palette 各自 vertical scroll |
| Template Editor mobile | 同上 | document；palette 240/280px internal scroll |
| Instance Editor | fixed-height app | header fixed；graph pan/zoom，dialog body scroll |
| Step Template Editor desktop | white library + page cards | library 與 editor column 各自 vertical scroll |
| CAD desktop | viewer + 360px pane | right pane vertical scroll |
| Preview desktop | viewer + 340px pane | right pane vertical scroll；footer fixed in panel |

Nested scroll container MUST 使用 `min-height: 0`，避免 flex/grid child 撐破 app shell。

## 圖層順序

| Layer | z-index |
| --- | --- |
| Normal page、graph | `auto/0` |
| Graph port tooltip / terminal preview | `20` |
| Node/geometry modal、Geometry Preview | `50` |
| Collapsed/expanded Export requests | `80` |
| Export job detail popover | `90` |
| Export form portal | `100` |

同級 modal 以 DOM order 決定前後；Export form MUST 高於 Preview 與 jobs panel。

## Icons 使用規則

使用 `lucide-react`，stroke/size 由 shared Button 限為 `16 × 16px`；screen identity 常用
`20 × 20px`。下列 mapping 是 exact copy：

| Action/meaning | Icon |
| --- | --- |
| Back/Home | `ArrowLeft` |
| Flow Template | `Workflow` |
| Flow Instance | `GitBranch` |
| Process Step | `ListChecks` / screen內 `Braces` |
| Save | `Save` |
| Commit/success | `Check` / `CheckCircle2` |
| New/add | `Plus` |
| Delete | `Trash2` |
| Close/clear | `X` |
| Preview/view | `Eye` |
| Import | `FileUp` |
| Export | `Download`、JSON 使用 `FileJson`、CDB 使用 `Database` |
| Section | `Scissors` |
| Reset | `RotateCcw` |

Icon-only button MUST 有 `title` 及可辨識的 `aria-label`；現行只有 `title` 的位置列為
accessibility gap，重建 target 仍需補 `aria-label`，不能依賴 tooltip 作 accessible name。

## 共用 control 狀態

| State | Visual |
| --- | --- |
| Default | white/background surface、1px input border、small shadow |
| Hover | accent background，或 viewer tool 變白 |
| Focus visible | `2px` ring using `--ring`；control 不得移位 |
| Disabled | muted background/text 或 opacity `0.5`，cursor unavailable |
| Destructive | destructive fill 或 red text/border |
| Selected | primary fill；catalog selection另加 `2px primary/20` ring |
