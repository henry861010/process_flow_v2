---
title: Home / Process Flow
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-22
last_verified_commit: 7d49bf0b
source_of_truth:
  - apps/viewer/app/page.tsx
  - apps/viewer/components/home/home-workspace.tsx
  - apps/viewer/components/home/create-instance-dialog.tsx
  - apps/viewer/components/home/home-workspace.test.tsx
  - apps/viewer/components/home/create-instance-dialog.test.tsx
---

# Home / Process Flow

Route: `/`

## Purpose and layout

Home lists stored instances grouped by their process flow template. It loads `GET /api/bootstrap`,
including process-step templates for default recipe initialization. Opening Home or its creation
dialog does not create records; only submitting the dialog writes an instance.

- Header: Workflow icon, `Process Flow`, and matching solid green primary `Create Template` and `Create Instance` buttons.
  `Create Template` links to `/flow-template-editor` immediately left of `Create Instance`.
  There is no onboarding step strip or separate template-selection workspace.
- `Management` links to `/management` from a fixed outline button with a Settings icon at the
  bottom right of the viewport. Reserve bottom page padding so the last content can scroll clear
  of the button. Keep this navigation below modal overlays.
- One full-width section per template, including disabled templates and templates without instances.
  Section headers display template name, version and instance count. Disabled templates have a
  `Disabled` badge; empty sections say `No instances yet`.
- Keep API template order and API instance order within each group. Instances with missing source
  templates appear together in a final `Unavailable template` section.
- Each instance is one full-row native link to `/flow-instance-editor?instanceId=<encoded id>`.
  Display name, version, `Owner: <owner>`, `Revision <revision>` and `Open instance` with ArrowRight.
  Empty owner falls back to `Unassigned`. Avoid repeating template names inside their rows.
- Keep `max-w-7xl`, `24px` vertical padding and horizontal gutters `20px` / `24px` at `640px` /
  `32px` at `1024px`. Sections have borders, `8px` radius, `24px` gaps and no extra shadow.
  Section headers have a muted background and `24px` horizontal padding to align with row text.
  Lists use `8px` padding, subtle row dividers and rows use `16px` padding. Row actions sit below identity below `640px`,
  and at the right on larger screens. All viewports use a single column and document scrolling.
- Typography: page title `20/28px` semibold; section titles `16/24px` semibold; instance names
  `16/24px` medium; metadata, row actions, descriptions and buttons `14/20px`; badges `12/16px`.
  Home versions and revisions use the shared sans font to match surrounding metadata, with tabular
  revision/count numerals. This is a Home-specific override of the default monospace revision rule.
  Count badges include `instance` / `instances` at `640px` and above and show just the count below.
- Header, resource, Retry and Management buttons share `40px` minimum height, `16px` horizontal
  padding and `16px` icons. The header identity icon container is `40px` square. Header actions
  occupy two equal columns below `640px`; longer labels wrap and increase height as needed.
- Long names, versions, owners and generator labels wrap without document-level horizontal overflow.
  Existing colors, fonts, icons, hover and focus tokens apply.

## Create Instance dialog

- `Create Instance` opens a single modal, initially focused on the Template select. Show enabled
  templates only, labelled `<name> · <version>`, with `Choose a template` initially selected.
- Form fields: Template, Name, Version and Owner are required; Description is optional multiline text.
  Version starts at `V0.0.0`; other identity fields are blank. No source-copy or initial-configuration
  selector is offered. Changing templates preserves entered identity information.
- Use a vertically scrollable form inside a viewport-bounded modal with a visible footer. Version
  and Owner share a row at `640px` and above; all fields stack on small screens.
- Dialog inputs/select and footer actions have `40px` minimum height. Labels and values use `14px`
  text, labels have `8px` clearance above controls and form sections have `20px` gaps. The hint uses
  `14/24px`; validation errors retain the compact `12px` size.
- Show: `Each station starts with an active recipe using template defaults. Geometry can be
  configured in the editor.` Missing required recipe parameters do not block instance creation.
- Resolve initial configuration with `configurationFromInstance(template, processStepTemplates)`:
  existing flow defaults, legacy step-default fallback and PnP empty placements behavior apply.
  Submit it via existing `POST /api/process-flow-instances` `initialConfiguration`.
- Each station receives one server-created `Initial recipe`, set active, with server-owned ID and
  timestamp. Geometry bindings remain empty. No schema, API or global creation-default changes.
- Trim identity values before submission. Blank/whitespace required fields display inline errors
  and focus the first invalid field. API failure keeps all values, shows a focused alert and allows retry.
- Footer actions, in order: `Cancel`, primary `Create`, and outline `Create & Edit`. Both creation
  actions use the same template defaults. `Create` closes the dialog and shows the new instance in
  its Home group immediately; `Create & Edit` opens `/flow-instance-editor?instanceId=<encoded server id>`.
  Enter submits as `Create` by default.
- Submit only once while pending; disable fields and all close/footer actions. Show `Creating…`
  on the selected creation button. Failure retains values and allows either creation action to retry.
- Escape, outside click, close and Cancel dismiss an idle dialog without writing. Trap keyboard focus,
  lock background scrolling, and restore focus to the header button. Reopening resets the form.
- Legacy editor `?templateId=` entry behavior is preserved; Home alone opts into default recipes.

## Resource tools

`Build reusable resources` stays expanded below all groups, separated by a top border, `32px`
margin and `24px` top padding. Description is `Create catalog geometry for use in instances.`

Outline links with the shared Home button sizing and `12px` gaps retain this order:

1. Bootstrap generators placed on `home`, in API order, labelled `Create <display name>` →
   `/geometry-generator?generatorId=<encoded id>`.
2. `Geometry` → `/geometry-editor`.

Management, Create Template and Geometry remain usable during loading and failures. Known
generator tools remain visible during retries.

## Loading, error and empty states

- Initial loading: one labelled skeleton list (`Loading templates and instances`); no empty messages
  or counts. Creation is disabled until templates load. Skeleton pulse respects reduced motion.
- Initial failure: shared `Unable to load workspace` alert, API message and `Retry`; the list says
  `Templates and instances could not be loaded. Use Retry above to try again.`
- Retry: disable Retry and show `Retrying…`. Preserve already loaded groups, counts and resources;
  refresh failure adds `Showing previously loaded content.` Success clears the error. The list
  exposes `aria-busy` throughout loading.
- If no enabled templates exist after loading, disable Create Instance and associate the explanation
  `No templates available for new instances. Create a template or enable one in Management.`
- Successful empty data says `No templates or instances yet.` Orphan-only data still shows its group.

## Acceptance

- `UI-HOME-001`: all templates, empty sections, disabled histories and missing-template instances are
  grouped correctly; only enabled templates can be chosen for creation.
- `UI-HOME-002`: each instance has one accessible link with encoded ID and required metadata;
  group and row API order are retained.
- `UI-HOME-003`: original resource links, placement filtering, ordering and Management remain available.
- `UI-HOME-004`: loading, error, retry, stale content and empty states remain distinct.
- `UI-HOME-005`: single-column sections at `1440×900`, `1024×768`, `390×844`; no horizontal overflow
  with long text; modal content and footer remain usable on small screens.
- `UI-HOME-006`: row keyboard activation, dialog focus trapping/return, visible focus rings, decorative
  icon semantics and reduced-motion skeleton behavior.
- `UI-HOME-007`: dialog validation, cancellation, error retention, duplicate-submit protection,
  Create returning to the updated Home list, and Create & Edit navigation; every station persists
  an active default recipe and geometry stays unbound.

## References

- [Current typography and spacing — desktop](../evidence/home-typography/home-desktop.jpg)
- [Current typography and spacing — mobile](../evidence/home-typography/home-mobile.jpg)

Earlier grouped-layout references:

- [Desktop](../assets/reference/home-1440x900.png)
- [Compact](../assets/reference/home-1024x768.png)
- [Mobile](../assets/reference/home-390x844.png)
- [Verification evidence](../evidence/home-redesign/README.md)
