# Process Step Template Editor UI Design

## Route

`/admin/processstepeditor`

## Purpose

The Process Step Template Editor is an admin tool for registering, reviewing, duplicating, and deleting immutable `ProcessStepTemplate` snapshots.

It is intended for developers and process owners who define process step programs and field definitions.

## Technology

- React
- TypeScript
- Next.js
- shadcn/ui
- Tailwind CSS
- lucide-react icons

## Data Source

The page reads and writes through FastAPI.

| Action | API |
| --- | --- |
| List | `GET /api/process-step-templates?search=&category=` |
| Detail | `GET /api/process-step-templates/{id}` |
| Create | `POST /api/process-step-templates` |
| Delete | `DELETE /api/process-step-templates/{id}` |

Templates are immutable. The editor does not update an existing template id. To change a template, duplicate it, assign a new id, and save a new snapshot.

Delete removes only the process step template record. Existing flow templates may still reference the deleted id and will show missing-step status in UI.

## Export

Export downloads the loaded `ProcessStepTemplate[]` as JSON.

Export behavior:

- Filename: `processStepTemplates.json`.
- MIME type: `application/json;charset=utf-8`.
- JSON is 2-space pretty printed.
- Existing field order is preserved.

Export is a local browser download and does not call the backend.

## Template Shape

```json
{
  "id": "step_tpl_molding_1_0_0",
  "version": "V1.0.0",
  "name": "molding",
  "category": "layer",
  "program": "layer/molding",
  "description": "",
  "owner": "process-flow",
  "fieldDefinitions": [
    {
      "id": "main_geometry",
      "name": "main_geometry",
      "description": "Complete geometry state consumed by this process step.",
      "scope": "inputState",
      "valueType": "geometryRef",
      "controlType": null,
      "selectionMode": null,
      "unit": null
    }
  ]
}
```

`program` is an extensionless Python process step module path resolved under `process_flow_steps`, for example `layer/molding` or `bump/bga_bump_formation`.

## Required System Field

Every process step template must contain the locked geometry input:

```json
{
  "id": "main_geometry",
  "name": "main_geometry",
  "description": "Complete geometry state consumed by this process step.",
  "scope": "inputState",
  "valueType": "geometryRef",
  "controlType": null,
  "selectionMode": null,
  "unit": null
}
```

`main_geometry` is shown as a disabled block. It cannot be deleted, reordered, or edited.

## Page Layout

The main page is the template registry.

Top controls:

- Search input.
- Category selector.
- Clear filters.
- Home button.
- Export button.
- Add button.

Result list:

- One row per process step template.
- Displays `name`, `category`, `version`, `owner`, and field count.
- Clicking a row opens review overlay.

## Filtering

Search matches `name` case-insensitively.

Category filtering uses path prefix matching:

- `category === selectedPath`
- `category.startsWith(selectedPath + ".")`

Category segment selectors are built from existing template categories and sorted alphabetically.

## Review Overlay

The review overlay shows a saved immutable template.

Header:

- Template name.
- Version.
- Category.
- Actions: Duplicate as new, Delete, Close.

Body:

- Metadata.
- Field definitions grouped by `scope`.
- `fieldGroupArray` repeat definitions and child fields.

Delete asks for confirmation and then calls `DELETE /api/process-step-templates/{id}`.

## Edit Overlay

The edit overlay is used only for new drafts.

Draft sources:

- Add: starts with only locked `main_geometry`.
- Duplicate as new: copies an existing template and clears `id`.

Footer actions:

- Save: validates and calls `POST /api/process-step-templates`.
- Abort: discards the draft.

After successful Save, the editor reloads the list and opens the saved template review overlay.

## Metadata Rules

`id`:

- Required.
- Must match `^[a-z][a-z0-9_]*$`.
- Must be unique in the backend.

`version`:

- Required.
- Must match `V1.0.0` style: `^V\\d+\\.\\d+\\.\\d+$`.

`name`:

- Required.

`category`:

- Required.
- Saved as the exact category path string entered by the user.

`program`:

- Required.
- Extensionless Python module path under `process_flow_steps`.
- May not be absolute.
- May not contain `..`, empty path segments, or a file extension.
- Path segments may contain letters, numbers, `_`, and `-`.
- Hyphenated path segments are normalized by the Python resolver when importing modules.

`owner`:

- Required.

`description`:

- Optional; saved as `""` when empty.

## Field Builder

The field builder has a field list and selected field editor.

Field list:

- `main_geometry` is always first and locked.
- User-created fields can be ordered.
- User-created fields can be deleted.

Supported field definition authoring:

- Static option sources.
- Scalar values such as string, number, boolean, integer, and material references.
- `geometryRef` fields.
- `fieldGroupArray` repeat groups.

Unsupported authoring:

- External catalog references.
- Material database picker.
- Direct process program execution.

## Validation

Save is enabled only when:

- Metadata rules pass.
- `main_geometry` is present.
- Field ids are unique within the template.
- Required field definition properties match the data model.
- Static option values are valid for their value type.

Server-side validation also rejects duplicate template ids and templates without `main_geometry`.
