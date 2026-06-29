"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  GripVertical,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createProcessStepTemplate,
  deleteProcessStepTemplate,
  listProcessStepTemplates,
} from "@/lib/process-flow-api";
import { cn } from "@/lib/utils";

const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;
const VERSION_RE = /^V\d+\.\d+\.\d+$/;
const PROGRAM_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

type FieldScope = "inputState" | "outputState" | "processParameter";
type ValueType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "materialRef"
  | "geometryRef"
  | "coordinates"
  | "fieldGroupArray"
  | "string[]"
  | "integer[]"
  | "float[]"
  | "materialRef[]";
type ControlType =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "repeater"
  | "coordinateList"
  | null;
type SelectionMode = "single" | "multiple" | null;

type StaticOption = {
  value: string | number;
  name: string;
  description?: string;
};

type OptionSource = {
  type: "static";
  options: StaticOption[];
};

type ValidationRule = {
  regex?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
};

type RepeatDefinition = {
  itemNameTemplate: string;
  indexBase: number;
  minItems?: number;
  maxItems?: number;
  itemFieldDefinitions: FieldDefinition[];
};

type FieldDefinition = {
  id: string;
  name: string;
  description: string;
  scope: FieldScope;
  valueType: ValueType;
  controlType: ControlType;
  selectionMode: SelectionMode;
  unit: string | null;
  optionSource?: OptionSource;
  validation?: ValidationRule;
  repeatDefinition?: RepeatDefinition;
};

type ProcessStepTemplate = {
  id: string;
  version: string;
  name: string;
  category: string;
  program: string;
  description: string;
  owner: string;
  fieldDefinitions: FieldDefinition[];
};

type ValidationErrors = Record<string, string>;

const MAIN_GEOMETRY_FIELD: FieldDefinition = {
  id: "main_geometry",
  name: "main_geometry",
  description: "Complete geometry state consumed by this process step.",
  scope: "inputState",
  valueType: "geometryRef",
  controlType: null,
  selectionMode: null,
  unit: null,
};

const valueTypes: ValueType[] = [
  "string",
  "string[]",
  "integer",
  "integer[]",
  "float",
  "float[]",
  "boolean",
  "materialRef",
  "materialRef[]",
  "geometryRef",
  "coordinates",
  "fieldGroupArray",
];

const childValueTypes: ValueType[] = valueTypes.filter(
  (valueType) =>
    valueType !== "geometryRef" &&
    valueType !== "coordinates" &&
    valueType !== "fieldGroupArray",
);

const scopes: FieldScope[] = ["inputState", "processParameter", "outputState"];

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[78px] w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function ProcessStepTemplateEditor() {
  const [templates, setTemplates] = React.useState<ProcessStepTemplate[]>([]);
  const [hydrated, setHydrated] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [categorySegments, setCategorySegments] = React.useState<string[]>([]);
  const [reviewTemplateId, setReviewTemplateId] = React.useState<string | null>(
    null,
  );
  const [draft, setDraft] = React.useState<ProcessStepTemplate | null>(null);
  const [draftSnapshot, setDraftSnapshot] = React.useState("");
  const [selectedFieldIndex, setSelectedFieldIndex] = React.useState(0);
  const [apiError, setApiError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void refreshTemplates();
  }, []);

  async function refreshTemplates() {
    try {
      setTemplates(await listProcessStepTemplates<ProcessStepTemplate>());
      setApiError(null);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to load templates.");
    } finally {
      setHydrated(true);
    }
  }

  const reviewTemplate = React.useMemo(
    () => templates.find((template) => template.id === reviewTemplateId) ?? null,
    [reviewTemplateId, templates],
  );

  const selectedCategoryPath = categorySegments.join(".");
  const filteredTemplates = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return templates.filter((template) => {
      const matchesSearch =
        query.length === 0 || template.name.toLowerCase().includes(query);
      const matchesCategory =
        selectedCategoryPath.length === 0 ||
        template.category === selectedCategoryPath ||
        template.category.startsWith(`${selectedCategoryPath}.`);
      return matchesSearch && matchesCategory;
    });
  }, [search, selectedCategoryPath, templates]);

  const categorySelectors = React.useMemo(
    () => buildCategorySelectors(templates, categorySegments),
    [categorySegments, templates],
  );

  const draftErrors = React.useMemo(
    () => (draft ? validateTemplateDraft(draft, templates) : {}),
    [draft, templates],
  );
  const draftErrorCount = Object.keys(draftErrors).length;
  const draftIsDirty = draft !== null && stringify(draft) !== draftSnapshot;

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (draft) {
        event.preventDefault();
        requestCloseDraft();
      } else if (reviewTemplateId) {
        setReviewTemplateId(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  function clearFilters() {
    setSearch("");
    setCategorySegments([]);
  }

  function openCreateDraft() {
    const nextDraft: ProcessStepTemplate = {
      id: "",
      version: "V1.0.0",
      name: "",
      category: "",
      program: "",
      description: "",
      owner: "",
      fieldDefinitions: [clone(MAIN_GEOMETRY_FIELD)],
    };
    setReviewTemplateId(null);
    setDraft(nextDraft);
    setDraftSnapshot(stringify(nextDraft));
    setSelectedFieldIndex(0);
  }

  function openDuplicateDraft(template: ProcessStepTemplate) {
    const nextDraft = clone(template);
    nextDraft.id = "";
    setReviewTemplateId(null);
    setDraft(nextDraft);
    setDraftSnapshot(stringify(nextDraft));
    setSelectedFieldIndex(nextDraft.fieldDefinitions.length > 1 ? 1 : 0);
  }

  function requestCloseDraft() {
    if (draftIsDirty) {
      const confirmed = window.confirm("Discard unsaved draft changes?");
      if (!confirmed) {
        return;
      }
    }
    setDraft(null);
    setDraftSnapshot("");
    setSelectedFieldIndex(0);
  }

  async function saveDraft() {
    if (!draft || Object.keys(draftErrors).length > 0) {
      return;
    }
    const normalized = normalizeTemplate(draft);
    await createProcessStepTemplate(normalized);
    await refreshTemplates();
    setDraft(null);
    setDraftSnapshot("");
    setSelectedFieldIndex(0);
    setReviewTemplateId(normalized.id);
  }

  async function deleteTemplate(templateId: string) {
    await deleteProcessStepTemplate(templateId);
    await refreshTemplates();
    setReviewTemplateId(null);
  }

  function exportTemplates() {
    const blob = new Blob([JSON.stringify(templates, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "processStepTemplates.json";
    anchor.click();
    URL.revokeObjectURL(href);
  }

  function updateDraft(updater: (current: ProcessStepTemplate) => ProcessStepTemplate) {
    setDraft((current) => (current ? updater(current) : current));
  }

  function updateSelectedField(nextField: FieldDefinition) {
    updateDraft((current) => {
      const fields = [...current.fieldDefinitions];
      fields[selectedFieldIndex] = nextField;
      return { ...current, fieldDefinitions: fields };
    });
  }

  function addField() {
    updateDraft((current) => {
      const field = createFieldForValueType("string");
      setSelectedFieldIndex(current.fieldDefinitions.length);
      return {
        ...current,
        fieldDefinitions: [...current.fieldDefinitions, field],
      };
    });
  }

  function deleteField(index: number) {
    if (index === 0) {
      return;
    }
    updateDraft((current) => {
      const fields = current.fieldDefinitions.filter((_, fieldIndex) => {
        return fieldIndex !== index;
      });
      setSelectedFieldIndex(Math.max(0, Math.min(index - 1, fields.length - 1)));
      return { ...current, fieldDefinitions: fields };
    });
  }

  function moveField(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (index === 0 || targetIndex <= 0 || !draft) {
      return;
    }
    if (targetIndex >= draft.fieldDefinitions.length) {
      return;
    }
    updateDraft((current) => {
      const fields = [...current.fieldDefinitions];
      const [field] = fields.splice(index, 1);
      fields.splice(targetIndex, 0, field);
      setSelectedFieldIndex(targetIndex);
      return { ...current, fieldDefinitions: fields };
    });
  }

  if (!hydrated) {
    return (
      <main className="flex min-h-screen min-w-[1180px] items-center justify-center bg-background text-sm text-muted-foreground">
        Loading editor...
      </main>
    );
  }

  return (
    <main className="min-h-screen min-w-[1180px] bg-background text-foreground">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-5 px-8 py-6">
        <header className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              Process Step Template Editor
            </h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="signal">{templates.length} templates</Badge>
              <span>API: process-step-templates</span>
            </div>
            {apiError ? (
              <div className="mt-2 text-sm text-destructive">{apiError}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/">
                <ArrowLeft />
                Home
              </Link>
            </Button>
            <Button variant="outline" onClick={exportTemplates}>
              <Download />
              Export
            </Button>
            <Button onClick={openCreateDraft}>
              <Plus />
              Add
            </Button>
          </div>
        </header>

        <section className="rounded-md border bg-white p-4 shadow-sm">
          <div className="grid grid-cols-[minmax(260px,1.2fr)_2fr_auto] items-end gap-3">
            <FormField label="Search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className={cn(inputClass, "pl-9")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Template name"
                />
              </div>
            </FormField>

            <div>
              <div className="mb-2 text-sm font-medium leading-none">Category</div>
              <div className="flex flex-wrap gap-2">
                {categorySelectors.map((selector) => (
                  <select
                    key={selector.level}
                    className="h-9 min-w-[180px] rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                    value={selector.value}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCategorySegments((current) => {
                        const retained = current.slice(0, selector.level);
                        return value ? [...retained, value] : retained;
                      });
                    }}
                  >
                    <option value="">
                      {selector.level === 0 ? "All categories" : "All children"}
                    </option>
                    {selector.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            </div>

            <Button variant="outline" onClick={clearFilters}>
              <X />
              Clear
            </Button>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border bg-white shadow-sm">
          <div className="grid grid-cols-[1.4fr_1fr_130px_1fr_110px] border-b bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <div>Name</div>
            <div>Category</div>
            <div>Version</div>
            <div>Owner</div>
            <div className="text-right">Fields</div>
          </div>

          {templates.length === 0 ? (
            <EmptyState
              title="No templates"
              actionLabel="Add"
              onAction={openCreateDraft}
            />
          ) : filteredTemplates.length === 0 ? (
            <EmptyState
              title="No matching templates"
              actionLabel="Clear filters"
              onAction={clearFilters}
            />
          ) : (
            <div className="divide-y">
              {filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  className="grid w-full grid-cols-[1.4fr_1fr_130px_1fr_110px] items-center px-4 py-3 text-left text-sm transition hover:bg-muted/50 focus:bg-muted/60 focus:outline-none"
                  onClick={() => setReviewTemplateId(template.id)}
                >
                  <div>
                    <div className="font-medium">{template.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {template.id}
                    </div>
                  </div>
                  <div className="text-muted-foreground">{template.category}</div>
                  <div>{template.version}</div>
                  <div className="text-muted-foreground">{template.owner}</div>
                  <div className="text-right font-medium">
                    {template.fieldDefinitions.length}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <SideSheet
        open={reviewTemplate !== null}
        title={reviewTemplate?.name ?? ""}
        subtitle={
          reviewTemplate
            ? `${reviewTemplate.version} / ${reviewTemplate.category}`
            : ""
        }
        onClose={() => setReviewTemplateId(null)}
        widthClassName="w-[80vw] min-w-[960px] max-w-[1180px]"
        headerActions={
          reviewTemplate ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openDuplicateDraft(reviewTemplate)}
              >
                <Copy />
                Duplicate as new
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteTemplate(reviewTemplate.id)}
              >
                <Trash2 />
                Delete
              </Button>
            </>
          ) : null
        }
      >
        {reviewTemplate ? <ReviewTemplate template={reviewTemplate} /> : null}
      </SideSheet>

      <SideSheet
        open={draft !== null}
        title="Create process step template"
        subtitle="Draft"
        onClose={requestCloseDraft}
        widthClassName="w-[80vw] min-w-[1080px] max-w-[1280px]"
        footer={
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm">
              {draftErrorCount > 0 ? (
                <>
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">
                    {draftErrorCount} blocking errors
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Ready to save</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={requestCloseDraft}>
                <X />
                Abort
              </Button>
              <Button disabled={draftErrorCount > 0} onClick={() => void saveDraft()}>
                <Save />
                Save
              </Button>
            </div>
          </div>
        }
      >
        {draft ? (
          <div className="flex flex-col gap-5 pb-3">
            <section className="rounded-md border bg-white p-4">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold">Step metadata</h2>
                <Badge variant="outline">immutable after save</Badge>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <FormField label="id" error={draftErrors["template.id"]}>
                  <input
                    className={inputClass}
                    value={draft.id}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        id: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="version" error={draftErrors["template.version"]}>
                  <input
                    className={inputClass}
                    value={draft.version}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        version: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="owner" error={draftErrors["template.owner"]}>
                  <input
                    className={inputClass}
                    value={draft.owner}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        owner: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="name" error={draftErrors["template.name"]}>
                  <input
                    className={inputClass}
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="category" error={draftErrors["template.category"]}>
                  <input
                    className={inputClass}
                    value={draft.category}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="program" error={draftErrors["template.program"]}>
                  <input
                    className={inputClass}
                    value={draft.program}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        program: event.target.value,
                      }))
                    }
                  />
                </FormField>
                <FormField label="description" className="col-span-3">
                  <textarea
                    className={textareaClass}
                    value={draft.description}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </FormField>
              </div>
            </section>

            <section className="grid min-h-[620px] grid-cols-[330px_1fr] overflow-hidden rounded-md border bg-white">
              <div className="border-r bg-muted/30">
                <div className="flex h-12 items-center justify-between border-b px-3">
                  <h2 className="text-sm font-semibold">Field builder</h2>
                  <Button size="sm" onClick={addField}>
                    <Plus />
                    Add field
                  </Button>
                </div>
                <div className="max-h-[calc(100vh-290px)] overflow-y-auto p-3">
                  <div className="flex flex-col gap-2">
                    {draft.fieldDefinitions.map((field, index) => (
                      <FieldListRow
                        key={`${index}-${field.id || "field"}`}
                        field={field}
                        index={index}
                        selected={selectedFieldIndex === index}
                        locked={index === 0}
                        hasErrors={hasErrorsForPath(draftErrors, `fields.${index}`)}
                        canMoveUp={index > 1}
                        canMoveDown={
                          index > 0 && index < draft.fieldDefinitions.length - 1
                        }
                        onSelect={() => setSelectedFieldIndex(index)}
                        onDelete={() => deleteField(index)}
                        onMoveUp={() => moveField(index, -1)}
                        onMoveDown={() => moveField(index, 1)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="max-h-[calc(100vh-238px)] overflow-y-auto p-4">
                {draft.fieldDefinitions[selectedFieldIndex] ? (
                  <FieldEditor
                    field={draft.fieldDefinitions[selectedFieldIndex]}
                    path={`fields.${selectedFieldIndex}`}
                    errors={draftErrors}
                    locked={selectedFieldIndex === 0}
                    isChild={false}
                    onChange={updateSelectedField}
                  />
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </SideSheet>
    </main>
  );
}

function SideSheet({
  open,
  title,
  subtitle,
  children,
  footer,
  headerActions,
  widthClassName,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  widthClassName?: string;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close overlay"
        className="absolute inset-0 cursor-default bg-foreground/35"
        onClick={onClose}
      />
      <section
        className={cn(
          "relative z-10 flex h-full flex-col border-l bg-background shadow-viewport",
          widthClassName,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-[72px] items-center justify-between gap-4 border-b bg-white px-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{title}</h2>
            {subtitle ? (
              <div className="mt-1 truncate text-sm text-muted-foreground">
                {subtitle}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerActions}
            <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer ? (
          <footer className="border-t bg-white px-5 py-3">{footer}</footer>
        ) : null}
      </section>
    </div>
  );
}

function ReviewTemplate({ template }: { template: ProcessStepTemplate }) {
  const grouped = groupFieldsByScope(template.fieldDefinitions);

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-md border bg-white p-4">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Metadata
        </h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <ReviewItem label="id" value={template.id} />
          <ReviewItem label="name" value={template.name} />
          <ReviewItem label="category" value={template.category} />
          <ReviewItem label="program" value={template.program} />
          <ReviewItem label="version" value={template.version} />
          <ReviewItem label="owner" value={template.owner} />
          <ReviewItem label="description" value={template.description || "-"} wide />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Field definitions
          </h3>
          <Badge variant="outline">{template.fieldDefinitions.length} fields</Badge>
        </div>

        {scopes.map((scope) => (
          <div key={scope} className="rounded-md border bg-white">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h4 className="font-medium">{scope}</h4>
              <Badge variant="secondary">{grouped[scope].length}</Badge>
            </div>
            {grouped[scope].length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">No fields</div>
            ) : (
              <div className="divide-y">
                {grouped[scope].map((field) => (
                  <ReviewField key={field.id} field={field} />
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function ReviewItem({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2")}>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="break-words rounded-md border bg-muted/30 px-3 py-2">
        {value}
      </div>
    </div>
  );
}

function ReviewField({ field }: { field: FieldDefinition }) {
  const isSystem = field.id === "main_geometry";
  const repeat = field.repeatDefinition;

  return (
    <div className={cn("px-4 py-3", isSystem && "bg-muted/30 text-muted-foreground")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium">{field.name}</div>
            {isSystem ? <Badge variant="outline">system</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{field.id}</div>
          {field.description ? (
            <p className="mt-2 text-sm text-muted-foreground">{field.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Badge variant="signal">{field.valueType}</Badge>
          <Badge variant="secondary">{field.controlType ?? "null"}</Badge>
          <Badge variant="outline">{field.selectionMode ?? "null"}</Badge>
          <Badge variant="outline">{field.unit ?? "unit:null"}</Badge>
        </div>
      </div>

      {usesOptions(field) && field.optionSource ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {field.optionSource.options.map((option) => (
            <Badge key={`${field.id}-${option.value}`} variant="outline">
              {option.name}: {String(option.value)}
            </Badge>
          ))}
        </div>
      ) : null}

      {repeat ? (
        <div className="mt-4 rounded-md border bg-white">
          <div className="grid grid-cols-4 gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
            <span>Template: {repeat.itemNameTemplate}</span>
            <span>Index base: {repeat.indexBase}</span>
            <span>Min: {repeat.minItems ?? "-"}</span>
            <span>Max: {repeat.maxItems ?? "-"}</span>
          </div>
          <div className="divide-y">
            {repeat.itemFieldDefinitions.map((child) => (
              <div
                key={child.id}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{child.name}</span>
                  <span className="ml-2 text-muted-foreground">{child.id}</span>
                </div>
                <div className="flex gap-2">
                  <Badge variant="signal">{child.valueType}</Badge>
                  <Badge variant="secondary">{child.controlType ?? "null"}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FieldListRow({
  field,
  index,
  selected,
  locked,
  hasErrors,
  canMoveUp,
  canMoveDown,
  onSelect,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  field: FieldDefinition;
  index: number;
  selected: boolean;
  locked: boolean;
  hasErrors: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div
      className={cn(
        "group rounded-md border bg-white p-2 text-left shadow-sm transition",
        selected && "border-ring ring-2 ring-ring/15",
        locked && "bg-muted/40 text-muted-foreground",
        hasErrors && "border-destructive/70",
      )}
    >
      <button
        className={cn(
          "grid w-full grid-cols-[20px_1fr] items-start gap-2 text-left",
          locked ? "cursor-default" : "cursor-pointer",
        )}
        onClick={onSelect}
      >
        <GripVertical className="mt-1 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-medium">
              {field.name || "Untitled field"}
            </div>
            {index === 0 ? <Badge variant="outline">system</Badge> : null}
            {hasErrors ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            ) : null}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {field.id || "empty_id"}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge variant="signal">{field.valueType}</Badge>
            <Badge variant="secondary">{field.controlType ?? "null"}</Badge>
          </div>
        </div>
      </button>
      {!locked ? (
        <div className="mt-2 flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Move up"
            disabled={!canMoveUp}
            onClick={onMoveUp}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Move down"
            disabled={!canMoveDown}
            onClick={onMoveDown}
          >
            <ChevronDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete field"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FieldEditor({
  field,
  path,
  errors,
  locked,
  isChild,
  onChange,
}: {
  field: FieldDefinition;
  path: string;
  errors: ValidationErrors;
  locked: boolean;
  isChild: boolean;
  onChange: (field: FieldDefinition) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {locked ? (
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          main_geometry is a locked system field.
        </div>
      ) : null}

      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="basic">Basic</TabsTrigger>
          <TabsTrigger value="type">Type</TabsTrigger>
          <TabsTrigger value="options" disabled={!usesOptions(field)}>
            Options
          </TabsTrigger>
          <TabsTrigger
            value="validation"
            disabled={!showsValidationSection(field)}
          >
            Validation
          </TabsTrigger>
          <TabsTrigger value="repeater" disabled={field.valueType !== "fieldGroupArray"}>
            Repeater
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <BasicSection
            field={field}
            path={path}
            errors={errors}
            locked={locked}
            onChange={onChange}
          />
        </TabsContent>

        <TabsContent value="type">
          <TypeSection
            field={field}
            path={path}
            errors={errors}
            locked={locked}
            isChild={isChild}
            onChange={onChange}
          />
        </TabsContent>

        <TabsContent value="options">
          {usesOptions(field) ? (
            <OptionsSection
              field={field}
              path={path}
              errors={errors}
              locked={locked}
              onChange={onChange}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="validation">
          {showsValidationSection(field) ? (
            <ValidationSection
              field={field}
              path={path}
              errors={errors}
              locked={locked}
              onChange={onChange}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="repeater">
          {field.valueType === "fieldGroupArray" ? (
            <RepeaterSection
              field={field}
              path={path}
              errors={errors}
              locked={locked}
              onChange={onChange}
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BasicSection({
  field,
  path,
  errors,
  locked,
  onChange,
}: {
  field: FieldDefinition;
  path: string;
  errors: ValidationErrors;
  locked: boolean;
  onChange: (field: FieldDefinition) => void;
}) {
  return (
    <SectionPanel>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="id" error={errors[`${path}.id`]}>
          <input
            className={inputClass}
            disabled={locked}
            value={field.id}
            onChange={(event) => onChange({ ...field, id: event.target.value })}
          />
        </FormField>
        <FormField label="name" error={errors[`${path}.name`]}>
          <input
            className={inputClass}
            disabled={locked}
            value={field.name}
            onChange={(event) => onChange({ ...field, name: event.target.value })}
          />
        </FormField>
        <FormField label="scope" error={errors[`${path}.scope`]}>
          <select
            className={selectClass}
            disabled={locked}
            value={field.scope}
            onChange={(event) =>
              onChange({ ...field, scope: event.target.value as FieldScope })
            }
          >
            {scopes.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="unit" error={errors[`${path}.unit`]}>
          <input
            className={inputClass}
            disabled={locked}
            placeholder="null"
            value={field.unit ?? ""}
            onChange={(event) =>
              onChange({
                ...field,
                unit:
                  event.target.value.trim() === ""
                    ? null
                    : event.target.value,
              })
            }
          />
        </FormField>
        <FormField label="description" className="col-span-2">
          <textarea
            className={textareaClass}
            disabled={locked}
            value={field.description}
            onChange={(event) =>
              onChange({ ...field, description: event.target.value })
            }
          />
        </FormField>
      </div>
    </SectionPanel>
  );
}

function TypeSection({
  field,
  path,
  errors,
  locked,
  isChild,
  onChange,
}: {
  field: FieldDefinition;
  path: string;
  errors: ValidationErrors;
  locked: boolean;
  isChild: boolean;
  onChange: (field: FieldDefinition) => void;
}) {
  const controls = legalControlsForValueType(field.valueType);
  const selectableValueTypes = isChild ? childValueTypes : valueTypes;

  function changeValueType(nextValueType: ValueType) {
    if (locked) {
      return;
    }
    onChange(migrateFieldValueType(field, nextValueType));
  }

  function changeControlType(nextControlType: ControlType) {
    if (locked) {
      return;
    }
    const next = applyControlType(field, nextControlType);
    onChange(next);
  }

  return (
    <SectionPanel>
      <div className="grid grid-cols-3 gap-4">
        <FormField label="valueType" error={errors[`${path}.valueType`]}>
          <select
            className={selectClass}
            disabled={locked}
            value={field.valueType}
            onChange={(event) => changeValueType(event.target.value as ValueType)}
          >
            {selectableValueTypes.map((valueType) => (
              <option key={valueType} value={valueType}>
                {valueType}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="controlType" error={errors[`${path}.controlType`]}>
          <select
            className={selectClass}
            disabled={locked || controls.length <= 1}
            value={field.controlType ?? "null"}
            onChange={(event) =>
              changeControlType(
                event.target.value === "null"
                  ? null
                  : (event.target.value as ControlType),
              )
            }
          >
            {controls.map((controlType) => (
              <option key={controlType ?? "null"} value={controlType ?? "null"}>
                {controlType ?? "null"}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="selectionMode" error={errors[`${path}.selectionMode`]}>
          <input
            className={inputClass}
            disabled
            value={field.selectionMode ?? "null"}
          />
        </FormField>
      </div>
    </SectionPanel>
  );
}

function OptionsSection({
  field,
  path,
  errors,
  locked,
  onChange,
}: {
  field: FieldDefinition;
  path: string;
  errors: ValidationErrors;
  locked: boolean;
  onChange: (field: FieldDefinition) => void;
}) {
  const optionSource = field.optionSource ?? { type: "static", options: [] };
  const options = optionSource.options;
  const numeric = isNumericValueType(field.valueType);
  const integer = isIntegerValueType(field.valueType);

  function updateOptions(nextOptions: StaticOption[]) {
    onChange({
      ...field,
      optionSource: {
        type: "static",
        options: nextOptions,
      },
    });
  }

  function updateOption(index: number, nextOption: StaticOption) {
    const nextOptions = [...options];
    nextOptions[index] = nextOption;
    updateOptions(nextOptions);
  }

  function moveOption(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= options.length) {
      return;
    }
    const nextOptions = [...options];
    const [option] = nextOptions.splice(index, 1);
    nextOptions.splice(targetIndex, 0, option);
    updateOptions(nextOptions);
  }

  return (
    <SectionPanel>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Static options</div>
          {errors[`${path}.optionSource`] ? (
            <div className="mt-1 text-xs text-destructive">
              {errors[`${path}.optionSource`]}
            </div>
          ) : null}
        </div>
        <Button
          size="sm"
          disabled={locked}
          onClick={() =>
            updateOptions([
              ...options,
              { value: numeric ? 0 : "", name: "", description: "" },
            ])
          }
        >
          <Plus />
          Add option
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {options.map((option, index) => (
          <div
            key={index}
            className="grid grid-cols-[1fr_1fr_1.4fr_auto] items-start gap-2 rounded-md border bg-muted/20 p-2"
          >
            <FormField
              label="value"
              error={errors[`${path}.options.${index}.value`]}
            >
              <input
                className={inputClass}
                disabled={locked}
                type={numeric ? "number" : "text"}
                step={integer ? 1 : "any"}
                value={String(option.value)}
                onChange={(event) =>
                  updateOption(index, {
                    ...option,
                    value: numeric
                      ? parseNumberish(event.target.value)
                      : event.target.value,
                  })
                }
              />
            </FormField>
            <FormField label="name" error={errors[`${path}.options.${index}.name`]}>
              <input
                className={inputClass}
                disabled={locked}
                value={option.name}
                onChange={(event) =>
                  updateOption(index, { ...option, name: event.target.value })
                }
              />
            </FormField>
            <FormField label="description">
              <input
                className={inputClass}
                disabled={locked}
                value={option.description ?? ""}
                onChange={(event) =>
                  updateOption(index, {
                    ...option,
                    description: event.target.value,
                  })
                }
              />
            </FormField>
            <div className="mt-6 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                title="Move up"
                disabled={locked || index === 0}
                onClick={() => moveOption(index, -1)}
              >
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Move down"
                disabled={locked || index === options.length - 1}
                onClick={() => moveOption(index, 1)}
              >
                <ChevronDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Delete option"
                disabled={locked}
                onClick={() =>
                  updateOptions(options.filter((_, optionIndex) => optionIndex !== index))
                }
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}

function ValidationSection({
  field,
  path,
  errors,
  locked,
  onChange,
}: {
  field: FieldDefinition;
  path: string;
  errors: ValidationErrors;
  locked: boolean;
  onChange: (field: FieldDefinition) => void;
}) {
  const validation = field.validation ?? {};

  function setValidationValue(
    key: keyof ValidationRule,
    value: string | boolean,
  ) {
    const next = { ...validation };
    if (typeof value === "boolean") {
      if (value) {
        next[key] = value as never;
      } else {
        delete next[key];
      }
    } else if (value.trim() === "") {
      delete next[key];
    } else if (key === "regex") {
      next[key] = value as never;
    } else {
      next[key] = Number(value) as never;
    }
    onChange({
      ...field,
      validation: Object.keys(next).length > 0 ? next : undefined,
    });
  }

  if (isStringLikeValueType(field.valueType)) {
    return (
      <SectionPanel>
        <div className="grid grid-cols-3 gap-4">
          <FormField label="regex" error={errors[`${path}.validation.regex`]}>
            <input
              className={inputClass}
              disabled={locked}
              value={validation.regex ?? ""}
              onChange={(event) => setValidationValue("regex", event.target.value)}
            />
          </FormField>
          <FormField
            label="minLength"
            error={errors[`${path}.validation.minLength`]}
          >
            <input
              className={inputClass}
              disabled={locked}
              type="number"
              step={1}
              value={validation.minLength ?? ""}
              onChange={(event) =>
                setValidationValue("minLength", event.target.value)
              }
            />
          </FormField>
          <FormField
            label="maxLength"
            error={errors[`${path}.validation.maxLength`]}
          >
            <input
              className={inputClass}
              disabled={locked}
              type="number"
              step={1}
              value={validation.maxLength ?? ""}
              onChange={(event) =>
                setValidationValue("maxLength", event.target.value)
              }
            />
          </FormField>
        </div>
      </SectionPanel>
    );
  }

  return (
    <SectionPanel>
      <div className="grid grid-cols-4 gap-4">
        <FormField label="min" error={errors[`${path}.validation.min`]}>
          <input
            className={inputClass}
            disabled={locked}
            type="number"
            step={isIntegerValueType(field.valueType) ? 1 : "any"}
            value={validation.min ?? ""}
            onChange={(event) => setValidationValue("min", event.target.value)}
          />
        </FormField>
        <FormField label="max" error={errors[`${path}.validation.max`]}>
          <input
            className={inputClass}
            disabled={locked}
            type="number"
            step={isIntegerValueType(field.valueType) ? 1 : "any"}
            value={validation.max ?? ""}
            onChange={(event) => setValidationValue("max", event.target.value)}
          />
        </FormField>
        <FormField label="exclusiveMin">
          <label className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm">
            <input
              disabled={locked}
              type="checkbox"
              checked={validation.exclusiveMin ?? false}
              onChange={(event) =>
                setValidationValue("exclusiveMin", event.target.checked)
              }
            />
            true
          </label>
        </FormField>
        <FormField label="exclusiveMax">
          <label className="flex h-9 items-center gap-2 rounded-md border bg-white px-3 text-sm">
            <input
              disabled={locked}
              type="checkbox"
              checked={validation.exclusiveMax ?? false}
              onChange={(event) =>
                setValidationValue("exclusiveMax", event.target.checked)
              }
            />
            true
          </label>
        </FormField>
      </div>
    </SectionPanel>
  );
}

function RepeaterSection({
  field,
  path,
  errors,
  locked,
  onChange,
}: {
  field: FieldDefinition;
  path: string;
  errors: ValidationErrors;
  locked: boolean;
  onChange: (field: FieldDefinition) => void;
}) {
  const repeat = field.repeatDefinition ?? createRepeatDefinition();
  const [editingChildIndex, setEditingChildIndex] = React.useState<number | null>(
    repeat.itemFieldDefinitions.length > 0 ? 0 : null,
  );
  const [showChildDraft, setShowChildDraft] = React.useState(false);
  const [childDraft, setChildDraft] = React.useState<FieldDefinition>(() =>
    createFieldForValueType("string"),
  );

  React.useEffect(() => {
    if (
      editingChildIndex !== null &&
      editingChildIndex >= repeat.itemFieldDefinitions.length
    ) {
      setEditingChildIndex(repeat.itemFieldDefinitions.length > 0 ? 0 : null);
    }
  }, [editingChildIndex, repeat.itemFieldDefinitions.length]);

  const childDraftErrors = validateStandaloneChildField(
    childDraft,
    repeat.itemFieldDefinitions,
    "newChild",
  );
  const canAppendChild = Object.keys(childDraftErrors).length === 0;

  function updateRepeat(nextRepeat: RepeatDefinition) {
    onChange({ ...field, repeatDefinition: nextRepeat });
  }

  function updateRepeatNumber(
    key: "indexBase" | "minItems" | "maxItems",
    raw: string,
  ) {
    const nextRepeat = { ...repeat };
    if (raw.trim() === "") {
      delete nextRepeat[key];
    } else {
      nextRepeat[key] = Number(raw);
    }
    updateRepeat(nextRepeat);
  }

  function updateChild(index: number, nextChild: FieldDefinition) {
    const children = [...repeat.itemFieldDefinitions];
    children[index] = nextChild;
    updateRepeat({ ...repeat, itemFieldDefinitions: children });
  }

  function deleteChild(index: number) {
    const children = repeat.itemFieldDefinitions.filter((_, childIndex) => {
      return childIndex !== index;
    });
    updateRepeat({ ...repeat, itemFieldDefinitions: children });
    setEditingChildIndex(children.length > 0 ? Math.min(index, children.length - 1) : null);
  }

  function moveChild(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= repeat.itemFieldDefinitions.length) {
      return;
    }
    const children = [...repeat.itemFieldDefinitions];
    const [child] = children.splice(index, 1);
    children.splice(targetIndex, 0, child);
    updateRepeat({ ...repeat, itemFieldDefinitions: children });
    setEditingChildIndex(targetIndex);
  }

  function appendChild() {
    if (!canAppendChild) {
      return;
    }
    updateRepeat({
      ...repeat,
      itemFieldDefinitions: [...repeat.itemFieldDefinitions, normalizeField(childDraft)],
    });
    setEditingChildIndex(repeat.itemFieldDefinitions.length);
    setShowChildDraft(false);
    setChildDraft(createFieldForValueType("string"));
  }

  const editingChild =
    editingChildIndex !== null
      ? repeat.itemFieldDefinitions[editingChildIndex]
      : undefined;

  return (
    <SectionPanel>
      <div className="grid grid-cols-4 gap-4">
        <FormField
          label="itemNameTemplate"
          error={errors[`${path}.repeatDefinition.itemNameTemplate`]}
          className="col-span-2"
        >
          <input
            className={inputClass}
            disabled={locked}
            value={repeat.itemNameTemplate}
            onChange={(event) =>
              updateRepeat({ ...repeat, itemNameTemplate: event.target.value })
            }
          />
        </FormField>
        <FormField
          label="indexBase"
          error={errors[`${path}.repeatDefinition.indexBase`]}
        >
          <input
            className={inputClass}
            disabled={locked}
            type="number"
            step={1}
            value={repeat.indexBase ?? ""}
            onChange={(event) => updateRepeatNumber("indexBase", event.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField
            label="minItems"
            error={errors[`${path}.repeatDefinition.minItems`]}
          >
            <input
              className={inputClass}
              disabled={locked}
              type="number"
              step={1}
              value={repeat.minItems ?? ""}
              onChange={(event) => updateRepeatNumber("minItems", event.target.value)}
            />
          </FormField>
          <FormField
            label="maxItems"
            error={errors[`${path}.repeatDefinition.maxItems`]}
          >
            <input
              className={inputClass}
              disabled={locked}
              type="number"
              step={1}
              value={repeat.maxItems ?? ""}
              onChange={(event) => updateRepeatNumber("maxItems", event.target.value)}
            />
          </FormField>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[300px_1fr] gap-4">
        <div className="rounded-md border bg-muted/20">
          <div className="flex h-11 items-center justify-between border-b px-3">
            <div className="text-sm font-medium">Child fields</div>
            <Button
              size="sm"
              disabled={locked}
              onClick={() => {
                setShowChildDraft(true);
                setEditingChildIndex(null);
              }}
            >
              <Plus />
              Add child
            </Button>
          </div>
          {errors[`${path}.repeatDefinition.itemFieldDefinitions`] ? (
            <div className="border-b px-3 py-2 text-xs text-destructive">
              {errors[`${path}.repeatDefinition.itemFieldDefinitions`]}
            </div>
          ) : null}
          <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto p-2">
            {repeat.itemFieldDefinitions.map((child, index) => {
              const childPath = `${path}.children.${index}`;
              const hasErrors = hasErrorsForPath(errors, childPath);
              return (
                <div
                  key={`${index}-${child.id || "child"}`}
                  className={cn(
                    "rounded-md border bg-white p-2",
                    editingChildIndex === index && "border-ring ring-2 ring-ring/15",
                    hasErrors && "border-destructive/70",
                  )}
                >
                  <button
                    className="grid w-full grid-cols-[18px_1fr] gap-2 text-left"
                    onClick={() => {
                      setEditingChildIndex(index);
                      setShowChildDraft(false);
                    }}
                  >
                    <GripVertical className="mt-1 h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {child.name || "Untitled child"}
                        </span>
                        {hasErrors ? (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        ) : null}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {child.id || "empty_id"}
                      </div>
                    </div>
                  </button>
                  <div className="mt-2 flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Move up"
                      disabled={locked || index === 0}
                      onClick={() => moveChild(index, -1)}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Move down"
                      disabled={locked || index === repeat.itemFieldDefinitions.length - 1}
                      onClick={() => moveChild(index, 1)}
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Delete child"
                      disabled={locked}
                      onClick={() => deleteChild(index)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 rounded-md border bg-white p-3">
          {showChildDraft ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">New child field</h3>
                <Button size="sm" disabled={!canAppendChild} onClick={appendChild}>
                  <Plus />
                  Append child
                </Button>
              </div>
              <FieldEditor
                field={childDraft}
                path="newChild"
                errors={childDraftErrors}
                locked={locked}
                isChild
                onChange={setChildDraft}
              />
            </div>
          ) : editingChild ? (
            <FieldEditor
              field={editingChild}
              path={`${path}.children.${editingChildIndex}`}
              errors={errors}
              locked={locked}
              isChild
              onChange={(nextChild) =>
                editingChildIndex !== null
                  ? updateChild(editingChildIndex, nextChild)
                  : undefined
              }
            />
          ) : (
            <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
              No child field selected
            </div>
          )}
        </div>
      </div>
    </SectionPanel>
  );
}

function FormField({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <div className="mb-2 flex min-h-[16px] items-center justify-between gap-2">
        <span className="text-sm font-medium leading-none">{label}</span>
      </div>
      {children}
      {error ? <div className="mt-1 text-xs text-destructive">{error}</div> : null}
    </label>
  );
}

function SectionPanel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border bg-white p-4 shadow-sm">{children}</div>;
}

function EmptyState({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-4 py-10">
      <div className="text-sm text-muted-foreground">{title}</div>
      <Button variant="outline" onClick={onAction}>
        {actionLabel === "Add" ? <Plus /> : <X />}
        {actionLabel}
      </Button>
    </div>
  );
}

function buildCategorySelectors(
  templates: ProcessStepTemplate[],
  selectedSegments: string[],
) {
  const selectors: Array<{ level: number; options: string[]; value: string }> = [];
  let prefix: string[] = [];

  for (let level = 0; level < selectedSegments.length + 1; level += 1) {
    const options = getChildSegments(templates, prefix);
    if (options.length === 0) {
      break;
    }
    const value = selectedSegments[level] ?? "";
    selectors.push({ level, options, value });
    if (!value) {
      break;
    }
    prefix = [...prefix, value];
  }

  if (selectors.length === 0) {
    selectors.push({ level: 0, options: [], value: "" });
  }

  return selectors;
}

function getChildSegments(templates: ProcessStepTemplate[], prefix: string[]) {
  const children = new Set<string>();
  templates.forEach((template) => {
    const segments = template.category.split(".").filter(Boolean);
    const matchesPrefix = prefix.every((segment, index) => {
      return segments[index] === segment;
    });
    if (matchesPrefix && segments[prefix.length]) {
      children.add(segments[prefix.length]);
    }
  });
  return Array.from(children).sort((a, b) => a.localeCompare(b));
}

function groupFieldsByScope(fields: FieldDefinition[]) {
  return fields.reduce<Record<FieldScope, FieldDefinition[]>>(
    (groups, field) => {
      groups[field.scope].push(field);
      return groups;
    },
    { inputState: [], processParameter: [], outputState: [] },
  );
}

function createFieldForValueType(valueType: ValueType): FieldDefinition {
  const controlType = defaultControlForValueType(valueType);
  const field: FieldDefinition = {
    id: "",
    name: "",
    description: "",
    scope: "processParameter",
    valueType,
    controlType,
    selectionMode: selectionModeFor(valueType, controlType),
    unit: null,
  };

  if (usesOptions(field)) {
    field.optionSource = { type: "static", options: [] };
  }
  if (valueType === "fieldGroupArray") {
    field.repeatDefinition = createRepeatDefinition();
  }
  return field;
}

function createRepeatDefinition(): RepeatDefinition {
  return {
    itemNameTemplate: "Item {{index}}",
    indexBase: 1,
    itemFieldDefinitions: [],
  };
}

function migrateFieldValueType(
  field: FieldDefinition,
  nextValueType: ValueType,
): FieldDefinition {
  const currentControlIsLegal =
    legalControlsForValueType(nextValueType).includes(field.controlType);
  const controlType = currentControlIsLegal
    ? field.controlType
    : defaultControlForValueType(nextValueType);
  const next: FieldDefinition = {
    id: field.id,
    name: field.name,
    description: field.description,
    scope: field.scope,
    valueType: nextValueType,
    controlType,
    selectionMode: selectionModeFor(nextValueType, controlType),
    unit: null,
  };

  if (usesOptions(next)) {
    next.optionSource =
      field.optionSource &&
      optionSourceMatchesValueType(nextValueType, field.optionSource)
        ? clone(field.optionSource)
        : { type: "static", options: [] };
  }

  const migratedValidation = migrateValidationRule(
    field.valueType,
    nextValueType,
    field.validation,
  );
  if (migratedValidation) {
    next.validation = migratedValidation;
  }

  if (nextValueType === "fieldGroupArray") {
    next.repeatDefinition =
      field.valueType === "fieldGroupArray" && field.repeatDefinition
        ? clone(field.repeatDefinition)
        : createRepeatDefinition();
  }

  return next;
}

function defaultControlForValueType(valueType: ValueType): ControlType {
  switch (valueType) {
    case "string":
    case "materialRef":
      return "text";
    case "integer":
    case "float":
      return "number";
    case "boolean":
      return "checkbox";
    case "geometryRef":
      return null;
    case "coordinates":
      return "coordinateList";
    case "fieldGroupArray":
      return "repeater";
    default:
      return "select";
  }
}

function legalControlsForValueType(valueType: ValueType): ControlType[] {
  switch (valueType) {
    case "string":
      return ["text", "select", "checkbox"];
    case "string[]":
      return ["select", "checkbox"];
    case "integer":
      return ["number", "select"];
    case "integer[]":
      return ["select", "checkbox"];
    case "float":
      return ["number", "select"];
    case "float[]":
      return ["select", "checkbox"];
    case "boolean":
      return ["checkbox"];
    case "materialRef":
      return ["text", "select"];
    case "materialRef[]":
      return ["select", "checkbox"];
    case "geometryRef":
      return [null];
    case "coordinates":
      return ["coordinateList"];
    case "fieldGroupArray":
      return ["repeater"];
  }
}

function selectionModeFor(
  valueType: ValueType,
  controlType: ControlType,
): SelectionMode {
  if (controlType !== "select" && !(controlType === "checkbox" && valueType !== "boolean")) {
    return null;
  }
  return isArrayValueType(valueType) ? "multiple" : "single";
}

function applyControlType(field: FieldDefinition, controlType: ControlType) {
  const next: FieldDefinition = {
    ...field,
    controlType,
    selectionMode: selectionModeFor(field.valueType, controlType),
  };
  if (usesOptions(next)) {
    next.optionSource = next.optionSource ?? { type: "static", options: [] };
  } else {
    delete next.optionSource;
  }
  return next;
}

function usesOptions(field: Pick<FieldDefinition, "controlType" | "valueType">) {
  return (
    field.controlType === "select" ||
    (field.controlType === "checkbox" && field.valueType !== "boolean")
  );
}

function showsValidationSection(field: FieldDefinition) {
  return isStringLikeValueType(field.valueType) || isNumericValueType(field.valueType);
}

function isArrayValueType(valueType: ValueType) {
  return valueType.endsWith("[]");
}

function isStringLikeValueType(valueType: ValueType) {
  return valueType === "string" || valueType === "materialRef";
}

function isNumericValueType(valueType: ValueType) {
  return (
    valueType === "integer" ||
    valueType === "integer[]" ||
    valueType === "float" ||
    valueType === "float[]"
  );
}

function isIntegerValueType(valueType: ValueType) {
  return valueType === "integer" || valueType === "integer[]";
}

function optionValueShouldBeString(valueType: ValueType) {
  return (
    valueType === "string" ||
    valueType === "string[]" ||
    valueType === "materialRef" ||
    valueType === "materialRef[]"
  );
}

function optionSourceMatchesValueType(
  valueType: ValueType,
  optionSource: OptionSource,
) {
  return optionSource.options.every((option) =>
    optionValueMatchesValueType(valueType, option.value),
  );
}

function optionValueMatchesValueType(
  valueType: ValueType,
  value: string | number,
) {
  if (optionValueShouldBeString(valueType)) {
    return typeof value === "string";
  }
  if (isNumericValueType(valueType)) {
    return (
      typeof value === "number" &&
      !Number.isNaN(value) &&
      (!isIntegerValueType(valueType) || Number.isInteger(value))
    );
  }
  return false;
}

function migrateValidationRule(
  currentValueType: ValueType,
  nextValueType: ValueType,
  validation: ValidationRule | undefined,
) {
  if (!validation) {
    return undefined;
  }

  const next: ValidationRule = {};

  if (
    isStringLikeValueType(currentValueType) &&
    isStringLikeValueType(nextValueType)
  ) {
    if (validation.regex !== undefined) {
      next.regex = validation.regex;
    }
    if (validation.minLength !== undefined) {
      next.minLength = validation.minLength;
    }
    if (validation.maxLength !== undefined) {
      next.maxLength = validation.maxLength;
    }
  } else if (
    isNumericValueType(currentValueType) &&
    isNumericValueType(nextValueType)
  ) {
    if (
      validation.min !== undefined &&
      (!isIntegerValueType(nextValueType) || Number.isInteger(validation.min))
    ) {
      next.min = validation.min;
    }
    if (
      validation.max !== undefined &&
      (!isIntegerValueType(nextValueType) || Number.isInteger(validation.max))
    ) {
      next.max = validation.max;
    }
    if (validation.exclusiveMin !== undefined) {
      next.exclusiveMin = validation.exclusiveMin;
    }
    if (validation.exclusiveMax !== undefined) {
      next.exclusiveMax = validation.exclusiveMax;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function parseNumberish(raw: string) {
  if (raw.trim() === "") {
    return "";
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? "" : parsed;
}

function validateTemplateDraft(
  draft: ProcessStepTemplate,
  existingTemplates: ProcessStepTemplate[],
) {
  const errors: ValidationErrors = {};

  if (!draft.id.trim()) {
    errors["template.id"] = "Required.";
  } else if (!SNAKE_CASE_RE.test(draft.id)) {
    errors["template.id"] = "Use snake_case starting with a lowercase letter.";
  } else if (existingTemplates.some((template) => template.id === draft.id)) {
    errors["template.id"] = "Template id must be unique.";
  }

  if (!draft.version.trim()) {
    errors["template.version"] = "Required.";
  } else if (!VERSION_RE.test(draft.version)) {
    errors["template.version"] = "Use Vx.y.z format.";
  }

  if (!draft.name.trim()) {
    errors["template.name"] = "Required.";
  }
  if (!draft.category.trim()) {
    errors["template.category"] = "Required.";
  }
  const programError = validateProgramPath(draft.program);
  if (programError) {
    errors["template.program"] = programError;
  }
  if (!draft.owner.trim()) {
    errors["template.owner"] = "Required.";
  }

  const mainGeometry = draft.fieldDefinitions[0];
  if (!mainGeometry || !isLockedMainGeometry(mainGeometry)) {
    errors["fields.0.id"] = "Locked main_geometry field is required.";
  }

  const topLevelIds = new Map<string, number[]>();
  draft.fieldDefinitions.forEach((field, index) => {
    if (field.id) {
      topLevelIds.set(field.id, [...(topLevelIds.get(field.id) ?? []), index]);
    }
  });

  draft.fieldDefinitions.forEach((field, index) => {
    validateFieldDefinition(field, {
      path: `fields.${index}`,
      errors,
      isChild: false,
    });
    if (field.id && (topLevelIds.get(field.id)?.length ?? 0) > 1) {
      errors[`fields.${index}.id`] = "Field id must be unique in this template.";
    }
  });

  return errors;
}

function validateProgramPath(program: string) {
  if (!program.trim()) {
    return "Required.";
  }
  if (program !== program.trim()) {
    return "Use a relative path without leading or trailing spaces.";
  }
  if (
    program.startsWith("/") ||
    program.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(program)
  ) {
    return "Use an extensionless process step module path, for example layer/molding.";
  }
  if (/\.[A-Za-z0-9]+$/.test(program)) {
    return "Do not include a file extension.";
  }

  const segments = program.split("/");
  if (
    segments.some((segment) => {
      return (
        segment === "" ||
        segment === ".." ||
        !PROGRAM_SEGMENT_RE.test(segment)
      );
    })
  ) {
    return "Use path segments with letters, numbers, _, or -.";
  }
  return "";
}

function validateStandaloneChildField(
  field: FieldDefinition,
  siblings: FieldDefinition[],
  path: string,
) {
  const errors: ValidationErrors = {};
  validateFieldDefinition(field, { path, errors, isChild: true });
  if (field.id && siblings.some((sibling) => sibling.id === field.id)) {
    errors[`${path}.id`] = "Child field id must be unique in this repeater.";
  }
  return errors;
}

function validateFieldDefinition({
  id,
  name,
  scope,
  valueType,
  controlType,
  selectionMode,
  unit,
  optionSource,
  validation,
  repeatDefinition,
}: FieldDefinition, {
  path,
  errors,
  isChild,
}: {
  path: string;
  errors: ValidationErrors;
  isChild: boolean;
}) {
  if (!id.trim()) {
    errors[`${path}.id`] = "Required.";
  } else if (!SNAKE_CASE_RE.test(id)) {
    errors[`${path}.id`] = "Use snake_case starting with a lowercase letter.";
  }

  if (!name.trim()) {
    errors[`${path}.name`] = "Required.";
  }

  if (!scopes.includes(scope)) {
    errors[`${path}.scope`] = "Invalid scope.";
  }

  if (unit !== null && typeof unit !== "string") {
    errors[`${path}.unit`] = "Unit must be a string or null.";
  }

  if (
    isChild &&
    (valueType === "geometryRef" ||
      valueType === "coordinates" ||
      valueType === "fieldGroupArray")
  ) {
    errors[`${path}.valueType`] =
      "Repeater child fields cannot use geometryRef, coordinates, or fieldGroupArray.";
  }

  if (!isLegalCombination(valueType, controlType, selectionMode)) {
    errors[`${path}.controlType`] =
      "Illegal valueType, controlType, selectionMode combination.";
  }

  const field = {
    id,
    name,
    scope,
    valueType,
    controlType,
    selectionMode,
    unit,
    optionSource,
    validation,
    repeatDefinition,
    description: "",
  };

  if (usesOptions(field)) {
    if (!optionSource || optionSource.type !== "static") {
      errors[`${path}.optionSource`] = "Static optionSource is required.";
    } else if (optionSource.options.length === 0) {
      errors[`${path}.optionSource`] = "At least one option is required.";
    } else {
      validateOptions(valueType, optionSource.options, path, errors);
    }
  } else if (optionSource) {
    errors[`${path}.optionSource`] = "This control cannot use options.";
  }

  validateValidationRule(valueType, validation, path, errors);

  if (valueType === "fieldGroupArray") {
    if (!repeatDefinition) {
      errors[`${path}.repeatDefinition.itemNameTemplate`] =
        "Repeat definition is required.";
    } else {
      validateRepeatDefinition(repeatDefinition, path, errors);
    }
  } else if (repeatDefinition) {
    errors[`${path}.repeatDefinition.itemNameTemplate`] =
      "Only fieldGroupArray can use repeatDefinition.";
  }
}

function validateOptions(
  valueType: ValueType,
  options: StaticOption[],
  path: string,
  errors: ValidationErrors,
) {
  const seen = new Set<string>();
  options.forEach((option, index) => {
    const valuePath = `${path}.options.${index}.value`;
    const namePath = `${path}.options.${index}.name`;
    if (!option.name.trim()) {
      errors[namePath] = "Required.";
    }

    if (optionValueShouldBeString(valueType)) {
      if (typeof option.value !== "string" || option.value.trim() === "") {
        errors[valuePath] = "Value must be a non-empty string.";
      }
    } else if (isNumericValueType(valueType)) {
      if (typeof option.value !== "number" || Number.isNaN(option.value)) {
        errors[valuePath] = "Value must be a number.";
      } else if (isIntegerValueType(valueType) && !Number.isInteger(option.value)) {
        errors[valuePath] = "Integer option cannot use decimals.";
      }
    }

    const fingerprint = `${typeof option.value}:${String(option.value)}`;
    if (seen.has(fingerprint)) {
      errors[valuePath] = "Option values must be unique.";
    }
    seen.add(fingerprint);
  });
}

function validateValidationRule(
  valueType: ValueType,
  validation: ValidationRule | undefined,
  path: string,
  errors: ValidationErrors,
) {
  if (!validation) {
    return;
  }

  if (isStringLikeValueType(valueType)) {
    if (
      validation.minLength !== undefined &&
      (!Number.isInteger(validation.minLength) || validation.minLength < 0)
    ) {
      errors[`${path}.validation.minLength`] = "Use a non-negative integer.";
    }
    if (
      validation.maxLength !== undefined &&
      (!Number.isInteger(validation.maxLength) || validation.maxLength < 0)
    ) {
      errors[`${path}.validation.maxLength`] = "Use a non-negative integer.";
    }
    if (
      validation.minLength !== undefined &&
      validation.maxLength !== undefined &&
      validation.minLength > validation.maxLength
    ) {
      errors[`${path}.validation.maxLength`] = "maxLength must be >= minLength.";
    }
    return;
  }

  if (isNumericValueType(valueType)) {
    (["min", "max"] as const).forEach((key) => {
      const value = validation[key];
      if (value !== undefined && (typeof value !== "number" || Number.isNaN(value))) {
        errors[`${path}.validation.${key}`] = "Use a valid number.";
      } else if (
        value !== undefined &&
        isIntegerValueType(valueType) &&
        !Number.isInteger(value)
      ) {
        errors[`${path}.validation.${key}`] = "Integer validation cannot use decimals.";
      }
    });
    if (
      validation.min !== undefined &&
      validation.max !== undefined &&
      validation.min > validation.max
    ) {
      errors[`${path}.validation.max`] = "max must be >= min.";
    }
    return;
  }

  errors[`${path}.validation`] = "This value type cannot use validation.";
}

function validateRepeatDefinition(
  repeat: RepeatDefinition,
  path: string,
  errors: ValidationErrors,
) {
  const repeatPath = `${path}.repeatDefinition`;
  if (!repeat.itemNameTemplate.trim()) {
    errors[`${repeatPath}.itemNameTemplate`] = "Required.";
  } else if (!repeat.itemNameTemplate.includes("{{index}}")) {
    errors[`${repeatPath}.itemNameTemplate`] = "Must include {{index}}.";
  }

  if (!isPositiveInteger(repeat.indexBase)) {
    errors[`${repeatPath}.indexBase`] = "Use a positive integer.";
  }

  if (repeat.minItems !== undefined && !isPositiveInteger(repeat.minItems)) {
    errors[`${repeatPath}.minItems`] = "Use a positive integer.";
  }
  if (repeat.maxItems !== undefined && !isPositiveInteger(repeat.maxItems)) {
    errors[`${repeatPath}.maxItems`] = "Use a positive integer.";
  }
  if (
    repeat.minItems !== undefined &&
    repeat.maxItems !== undefined &&
    repeat.minItems > repeat.maxItems
  ) {
    errors[`${repeatPath}.maxItems`] = "maxItems must be >= minItems.";
  }

  if (repeat.itemFieldDefinitions.length === 0) {
    errors[`${repeatPath}.itemFieldDefinitions`] =
      "At least one child field is required.";
  }

  const childIds = new Map<string, number[]>();
  repeat.itemFieldDefinitions.forEach((child, index) => {
    if (child.id) {
      childIds.set(child.id, [...(childIds.get(child.id) ?? []), index]);
    }
  });

  repeat.itemFieldDefinitions.forEach((child, index) => {
    const childPath = `${path}.children.${index}`;
    validateFieldDefinition(child, { path: childPath, errors, isChild: true });
    if (child.id && (childIds.get(child.id)?.length ?? 0) > 1) {
      errors[`${childPath}.id`] = "Child field id must be unique in this repeater.";
    }
  });
}

function isLegalCombination(
  valueType: ValueType,
  controlType: ControlType,
  selectionMode: SelectionMode,
) {
  if (!legalControlsForValueType(valueType).includes(controlType)) {
    return false;
  }
  return selectionModeFor(valueType, controlType) === selectionMode;
}

function isPositiveInteger(value: number | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isLockedMainGeometry(field: FieldDefinition) {
  return (
    field.id === "main_geometry" &&
    field.name === "main_geometry" &&
    field.scope === "inputState" &&
    field.valueType === "geometryRef" &&
    field.controlType === null &&
    field.selectionMode === null &&
    field.unit === null
  );
}

function normalizeTemplate(template: ProcessStepTemplate): ProcessStepTemplate {
  return {
    ...template,
    id: template.id.trim(),
    version: template.version.trim(),
    name: template.name.trim(),
    category: template.category.trim(),
    program: template.program.trim(),
    description: template.description ?? "",
    owner: template.owner.trim(),
    fieldDefinitions: template.fieldDefinitions.map(normalizeField),
  };
}

function normalizeField(field: FieldDefinition): FieldDefinition {
  const next: FieldDefinition = {
    id: field.id.trim(),
    name: field.name.trim(),
    description: field.description ?? "",
    scope: field.scope,
    valueType: field.valueType,
    controlType: field.controlType,
    selectionMode: field.selectionMode,
    unit: field.unit ?? null,
  };

  if (usesOptions(field) && field.optionSource) {
    next.optionSource = {
      type: "static",
      options: field.optionSource.options.map((option) => ({
        value: option.value,
        name: option.name.trim(),
        ...(option.description ? { description: option.description } : {}),
      })),
    };
  }

  if (
    field.validation &&
    Object.keys(field.validation).length > 0 &&
    showsValidationSection(field)
  ) {
    next.validation = field.validation;
  }

  if (field.valueType === "fieldGroupArray" && field.repeatDefinition) {
    next.repeatDefinition = {
      ...field.repeatDefinition,
      itemFieldDefinitions:
        field.repeatDefinition.itemFieldDefinitions.map(normalizeField),
    };
  }

  return next;
}

function hasErrorsForPath(errors: ValidationErrors, path: string) {
  return Object.keys(errors).some((errorPath) => errorPath.startsWith(path));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stringify(value: unknown) {
  return JSON.stringify(value);
}
