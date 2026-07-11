"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Braces,
  Check,
  CircleDot,
  Copy,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ControlType,
  GeometryInputPort,
  ParameterDefinition,
  ProcessStepTemplate,
  StaticOption,
  ValueType,
} from "@/lib/process-flow/types";
import {
  createProcessStepTemplate,
  deleteProcessStepTemplate,
  listProcessStepTemplates,
} from "@/lib/process-flow-api";
import { clone } from "@/lib/process-flow/utils";
import { cn } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[78px] w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";

const PRIMARY_PORT: GeometryInputPort = {
  portId: "main_geometry",
  name: "Main geometry",
  description: "Complete geometry state consumed by this process step.",
  dataType: "geometry",
  role: "primary",
  required: true,
};

const RESULT_PORT = {
  portId: "result_geometry",
  name: "Result geometry",
  description: "Geometry state produced by this process step.",
  dataType: "geometry" as const,
};

const VALUE_TYPES: Array<{ value: ValueType; label: string }> = [
  { value: "string", label: "String" },
  { value: "integer", label: "Integer" },
  { value: "float", label: "Float" },
  { value: "boolean", label: "Boolean" },
  { value: "materialRef", label: "Material reference" },
  { value: "coordinates", label: "Coordinates" },
  { value: "string[]", label: "String array" },
  { value: "integer[]", label: "Integer array" },
  { value: "float[]", label: "Float array" },
  { value: "materialRef[]", label: "Material reference array" },
  { value: "fieldGroupArray", label: "Repeatable group" },
];

export function ProcessStepTemplateEditor() {
  const [templates, setTemplates] = React.useState<ProcessStepTemplate[]>([]);
  const [draft, setDraft] = React.useState<ProcessStepTemplate>(newTemplate());
  const [selectedParameterIndex, setSelectedParameterIndex] = React.useState<number | null>(
    null,
  );
  const [search, setSearch] = React.useState("");
  const [sourceTemplateId, setSourceTemplateId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<
    { kind: "error" | "success"; text: string } | null
  >(null);

  React.useEffect(() => {
    let active = true;
    listProcessStepTemplates<ProcessStepTemplate>()
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch((error) => {
        if (active) {
          setMessage({
            kind: "error",
            text: error instanceof Error ? error.message : "Unable to load templates.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredTemplates = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((template) =>
      [template.name, template.id, template.category, template.program]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [search, templates]);

  const validationMessage = React.useMemo(() => validateTemplate(draft), [draft]);
  const idAlreadyExists = templates.some((template) => template.id === draft.id);
  const canSave = !busy && !validationMessage && !idAlreadyExists;
  const selectedParameter =
    selectedParameterIndex == null
      ? null
      : draft.parameterDefinitions[selectedParameterIndex] ?? null;

  function updateDraft(patch: Partial<ProcessStepTemplate>) {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
  }

  function startNew() {
    setDraft(newTemplate());
    setSelectedParameterIndex(null);
    setSourceTemplateId(null);
    setMessage(null);
  }

  function cloneTemplate(template: ProcessStepTemplate) {
    const next = clone(template);
    next.id = "";
    setDraft(next);
    setSelectedParameterIndex(next.parameterDefinitions.length > 0 ? 0 : null);
    setSourceTemplateId(template.id);
    setMessage(null);
  }

  async function removeTemplate(template: ProcessStepTemplate) {
    if (!window.confirm(`Delete ${template.name} (${template.id})?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteProcessStepTemplate(template.id);
      setTemplates((items) => items.filter((item) => item.id !== template.id));
      if (sourceTemplateId === template.id) setSourceTemplateId(null);
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Unable to delete template.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (!canSave) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await createProcessStepTemplate<ProcessStepTemplate>(draft);
      setTemplates((items) => [...items, saved].sort(templateSort));
      setDraft(clone(saved));
      setSourceTemplateId(saved.id);
      setMessage({ kind: "success", text: `Saved ${saved.id}` });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Unable to save template.",
      });
    } finally {
      setBusy(false);
    }
  }

  function addAuxiliaryPort() {
    const used = new Set(draft.inputPorts.map((port) => port.portId));
    const portId = nextId("aux_geometry", used);
    updateDraft({
      inputPorts: [
        ...draft.inputPorts,
        {
          portId,
          name: "Auxiliary geometry",
          description: "",
          dataType: "geometry",
          role: "auxiliary",
          required: true,
        },
      ],
    });
  }

  function updateInputPort(index: number, patch: Partial<GeometryInputPort>) {
    updateDraft({
      inputPorts: draft.inputPorts.map((port, portIndex) =>
        portIndex === index ? { ...port, ...patch } : port,
      ),
    });
  }

  function removeInputPort(index: number) {
    updateDraft({ inputPorts: draft.inputPorts.filter((_, itemIndex) => itemIndex !== index) });
  }

  function addParameter() {
    const used = new Set(draft.parameterDefinitions.map((parameter) => parameter.id));
    const parameter = newParameter(nextId("parameter", used));
    const next = [...draft.parameterDefinitions, parameter];
    updateDraft({ parameterDefinitions: next });
    setSelectedParameterIndex(next.length - 1);
  }

  function updateParameter(index: number, parameter: ParameterDefinition) {
    updateDraft({
      parameterDefinitions: draft.parameterDefinitions.map((item, itemIndex) =>
        itemIndex === index ? parameter : item,
      ),
    });
  }

  function removeParameter(index: number) {
    const next = draft.parameterDefinitions.filter((_, itemIndex) => itemIndex !== index);
    updateDraft({ parameterDefinitions: next });
    setSelectedParameterIndex((current) => {
      if (current == null) return null;
      if (next.length === 0) return null;
      return Math.min(current > index ? current - 1 : current, next.length - 1);
    });
  }

  function moveParameter(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.parameterDefinitions.length) return;
    const next = [...draft.parameterDefinitions];
    [next[index], next[target]] = [next[target], next[index]];
    updateDraft({ parameterDefinitions: next });
    setSelectedParameterIndex(target);
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon" title="Back to flow instances">
            <Link href="/">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">Process Step Template</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">schema v2</Badge>
              {sourceTemplateId ? <span>Source: {sourceTemplateId}</span> : <span>New template</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={startNew} disabled={busy}>
            <Plus />
            New
          </Button>
          <Button onClick={saveTemplate} disabled={!canSave}>
            {busy ? <CircleDot className="animate-pulse" /> : <Save />}
            Save Template
          </Button>
        </div>
      </header>

      {message || validationMessage || idAlreadyExists ? (
        <div
          className={cn(
            "border-b px-4 py-2 text-sm",
            message?.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900",
          )}
        >
          {message?.text ??
            (idAlreadyExists
              ? "Template ids are immutable. Use a new id for this revision."
              : validationMessage)}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="min-h-0 border-r bg-white max-lg:border-b max-lg:border-r-0">
          <div className="border-b p-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className={cn(inputClass, "pl-9")}
                value={search}
                placeholder="Search templates"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className="max-h-[calc(100vh-126px)] overflow-y-auto p-2 max-lg:max-h-72">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className={cn(
                  "group mb-1 flex items-start gap-2 rounded-md border px-3 py-2",
                  sourceTemplateId === template.id && "border-primary bg-primary/5",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  title={`Clone ${template.name}`}
                  onClick={() => cloneTemplate(template)}
                >
                  <div className="truncate text-sm font-medium">{template.name}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {template.id}
                  </div>
                  <div className="mt-1 flex gap-1">
                    <Badge variant="outline">{template.version}</Badge>
                    <Badge variant="outline">{template.inputPorts.length} inputs</Badge>
                  </div>
                </button>
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Clone template"
                    onClick={() => cloneTemplate(template)}
                  >
                    <Copy />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Delete template"
                    disabled={busy}
                    onClick={() => void removeTemplate(template)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="min-w-0 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-5">
            <EditorSection title="Identity" icon={<Braces />}>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Template id" required>
                  <input
                    className={inputClass}
                    value={draft.id}
                    onChange={(event) => updateDraft({ id: event.target.value })}
                  />
                </FormField>
                <FormField label="Version" required>
                  <input
                    className={inputClass}
                    value={draft.version}
                    onChange={(event) => updateDraft({ version: event.target.value })}
                  />
                </FormField>
                <FormField label="Name" required>
                  <input
                    className={inputClass}
                    value={draft.name}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                  />
                </FormField>
                <FormField label="Owner" required>
                  <input
                    className={inputClass}
                    value={draft.owner}
                    onChange={(event) => updateDraft({ owner: event.target.value })}
                  />
                </FormField>
                <FormField label="Category" required>
                  <input
                    className={inputClass}
                    value={draft.category}
                    onChange={(event) => updateDraft({ category: event.target.value })}
                  />
                </FormField>
                <FormField label="Program" required>
                  <input
                    className={inputClass}
                    value={draft.program}
                    onChange={(event) => updateDraft({ program: event.target.value })}
                  />
                </FormField>
                <div className="md:col-span-2">
                  <FormField label="Description">
                    <textarea
                      className={textareaClass}
                      value={draft.description}
                      onChange={(event) => updateDraft({ description: event.target.value })}
                    />
                  </FormField>
                </div>
              </div>
            </EditorSection>

            <EditorSection
              title="Geometry Ports"
              icon={<CircleDot />}
              action={
                <Button variant="outline" size="sm" onClick={addAuxiliaryPort}>
                  <Plus />
                  Input Port
                </Button>
              }
            >
              <div className="divide-y rounded-md border">
                {draft.inputPorts.map((port, index) => (
                  <PortEditor
                    key={`${port.portId}:${index}`}
                    port={port}
                    locked={index === 0}
                    onChange={(patch) => updateInputPort(index, patch)}
                    onDelete={index === 0 ? undefined : () => removeInputPort(index)}
                  />
                ))}
                <div className="grid grid-cols-[150px_1fr_1fr_auto] items-end gap-3 p-3 max-md:grid-cols-1">
                  <div>
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Output</div>
                    <Badge variant="signal">geometry</Badge>
                  </div>
                  <FormField label="Port id">
                    <input className={inputClass} value={RESULT_PORT.portId} disabled />
                  </FormField>
                  <FormField label="Name">
                    <input
                      className={inputClass}
                      value={draft.outputPorts[0]?.name ?? RESULT_PORT.name}
                      onChange={(event) =>
                        updateDraft({
                          outputPorts: [
                            {
                              ...(draft.outputPorts[0] ?? RESULT_PORT),
                              name: event.target.value,
                            },
                          ],
                        })
                      }
                    />
                  </FormField>
                  <Badge variant="outline">locked</Badge>
                </div>
              </div>
            </EditorSection>

            <EditorSection
              title="Parameters"
              icon={<Braces />}
              action={
                <Button size="sm" onClick={addParameter}>
                  <Plus />
                  Parameter
                </Button>
              }
            >
              <div className="grid min-h-[420px] grid-cols-[260px_minmax(0,1fr)] overflow-hidden rounded-md border max-md:grid-cols-1">
                <div className="border-r bg-muted/20 p-2 max-md:border-b max-md:border-r-0">
                  {draft.parameterDefinitions.map((parameter, index) => (
                    <button
                      key={`${parameter.id}:${index}`}
                      type="button"
                      className={cn(
                        "mb-1 flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left",
                        selectedParameterIndex === index
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-white",
                      )}
                      onClick={() => setSelectedParameterIndex(index)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {parameter.name || "Untitled parameter"}
                        </span>
                        <span className="block truncate font-mono text-[10px] opacity-75">
                          {parameter.id || "missing id"}
                        </span>
                      </span>
                      <Badge variant={selectedParameterIndex === index ? "secondary" : "outline"}>
                        {shortValueType(parameter.valueType)}
                      </Badge>
                    </button>
                  ))}
                  {draft.parameterDefinitions.length === 0 ? (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No parameters
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 p-4">
                  {selectedParameter && selectedParameterIndex != null ? (
                    <>
                      <div className="mb-4 flex items-center justify-between gap-2 border-b pb-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">
                            {selectedParameter.name || "Untitled parameter"}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            parameterDefinitions[{selectedParameterIndex}]
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Move up"
                            disabled={selectedParameterIndex === 0}
                            onClick={() => moveParameter(selectedParameterIndex, -1)}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Move down"
                            disabled={selectedParameterIndex === draft.parameterDefinitions.length - 1}
                            onClick={() => moveParameter(selectedParameterIndex, 1)}
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete parameter"
                            onClick={() => removeParameter(selectedParameterIndex)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                      <ParameterDefinitionEditor
                        definition={selectedParameter}
                        onChange={(parameter) =>
                          updateParameter(selectedParameterIndex, parameter)
                        }
                      />
                    </>
                  ) : (
                    <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
                      Select a parameter
                    </div>
                  )}
                </div>
              </div>
            </EditorSection>

            <details className="rounded-md border bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                JSON payload
              </summary>
              <pre className="max-h-96 overflow-auto border-t bg-muted/30 p-4 text-xs">
                {JSON.stringify(draft, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      </div>
    </main>
  );
}

function PortEditor({
  port,
  locked,
  onChange,
  onDelete,
}: {
  port: GeometryInputPort;
  locked: boolean;
  onChange: (patch: Partial<GeometryInputPort>) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="grid grid-cols-[150px_1fr_1fr_auto] items-end gap-3 p-3 max-md:grid-cols-1">
      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          {port.role === "primary" ? "Primary input" : "Auxiliary input"}
        </div>
        <Badge variant={port.role === "primary" ? "signal" : "outline"}>geometry</Badge>
      </div>
      <FormField label="Port id">
        <input
          className={inputClass}
          value={port.portId}
          disabled={locked}
          onChange={(event) => onChange({ portId: event.target.value })}
        />
      </FormField>
      <FormField label="Name">
        <input
          className={inputClass}
          value={port.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </FormField>
      <div className="flex h-9 items-center gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={port.required}
            disabled={locked}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          Required
        </label>
        {onDelete ? (
          <Button variant="ghost" size="icon" title="Delete input port" onClick={onDelete}>
            <Trash2 />
          </Button>
        ) : (
          <Badge variant="outline">locked</Badge>
        )}
      </div>
    </div>
  );
}

function ParameterDefinitionEditor({
  definition,
  onChange,
  depth = 0,
}: {
  definition: ParameterDefinition;
  onChange: (definition: ParameterDefinition) => void;
  depth?: number;
}) {
  const controlOptions = compatibleControls(definition.valueType);
  const usesOptions =
    definition.controlType === "select" ||
    (definition.controlType === "checkbox" && definition.valueType !== "boolean");
  const isNumeric = ["integer", "float", "integer[]", "float[]"].includes(
    definition.valueType,
  );
  const isString = ["string", "materialRef", "string[]", "materialRef[]"].includes(
    definition.valueType,
  );

  function patch(next: Partial<ParameterDefinition>) {
    onChange({ ...definition, ...next });
  }

  function changeValueType(valueType: ValueType) {
    const controlType = defaultControl(valueType);
    patch({
      valueType,
      controlType,
      selectionMode: valueType.endsWith("[]") ? "multiple" : null,
      optionSource: undefined,
      repeatDefinition:
        valueType === "fieldGroupArray"
          ? {
              itemNameTemplate: "Item {{index}}",
              indexBase: 1,
              minItems: 0,
              itemParameterDefinitions: [],
            }
          : undefined,
    });
  }

  function setControlType(controlType: ControlType) {
    patch({
      controlType,
      optionSource:
        controlType === "select" ||
        (controlType === "checkbox" && definition.valueType !== "boolean")
          ? definition.optionSource ?? { type: "static", options: [] }
          : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField label="Parameter id" required>
          <input
            className={inputClass}
            value={definition.id}
            onChange={(event) => patch({ id: event.target.value })}
          />
        </FormField>
        <FormField label="Name" required>
          <input
            className={inputClass}
            value={definition.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </FormField>
        <FormField label="Value type" required>
          <select
            className={selectClass}
            value={definition.valueType}
            onChange={(event) => changeValueType(event.target.value as ValueType)}
          >
            {VALUE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Control">
          <select
            className={selectClass}
            value={definition.controlType ?? ""}
            onChange={(event) => setControlType((event.target.value || null) as ControlType)}
          >
            <option value="">None</option>
            {controlOptions.map((control) => (
              <option key={control} value={control}>
                {controlLabel(control)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Unit">
          <input
            className={inputClass}
            value={definition.unit ?? ""}
            onChange={(event) => patch({ unit: event.target.value || null })}
          />
        </FormField>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={definition.required !== false}
              onChange={(event) => patch({ required: event.target.checked })}
            />
            Required
          </label>
        </div>
        <div className="md:col-span-2">
          <FormField label="Description">
            <textarea
              className={textareaClass}
              value={definition.description ?? ""}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </FormField>
        </div>
      </div>

      {usesOptions ? (
        <OptionEditor
          options={definition.optionSource?.options ?? []}
          multiple={definition.valueType.endsWith("[]")}
          selectionMode={definition.selectionMode}
          onSelectionModeChange={(selectionMode) => patch({ selectionMode })}
          onChange={(options) => patch({ optionSource: { type: "static", options } })}
        />
      ) : null}

      {isNumeric || isString ? (
        <section className="border-t pt-4">
          <div className="mb-3 text-sm font-semibold">Validation</div>
          <div className="grid gap-4 md:grid-cols-2">
            {isNumeric ? (
              <>
                <NumericRule
                  label="Minimum"
                  value={definition.validation?.min}
                  exclusive={definition.validation?.exclusiveMin}
                  onChange={(value, exclusive) =>
                    patch({
                      validation: cleanValidation({
                        ...definition.validation,
                        min: value,
                        exclusiveMin: exclusive,
                      }),
                    })
                  }
                />
                <NumericRule
                  label="Maximum"
                  value={definition.validation?.max}
                  exclusive={definition.validation?.exclusiveMax}
                  onChange={(value, exclusive) =>
                    patch({
                      validation: cleanValidation({
                        ...definition.validation,
                        max: value,
                        exclusiveMax: exclusive,
                      }),
                    })
                  }
                />
              </>
            ) : null}
            {isString ? (
              <>
                <FormField label="Minimum length">
                  <OptionalNumberInput
                    integer
                    value={definition.validation?.minLength}
                    onChange={(minLength) =>
                      patch({
                        validation: cleanValidation({
                          ...definition.validation,
                          minLength,
                        }),
                      })
                    }
                  />
                </FormField>
                <FormField label="Maximum length">
                  <OptionalNumberInput
                    integer
                    value={definition.validation?.maxLength}
                    onChange={(maxLength) =>
                      patch({
                        validation: cleanValidation({
                          ...definition.validation,
                          maxLength,
                        }),
                      })
                    }
                  />
                </FormField>
                <div className="md:col-span-2">
                  <FormField label="Regular expression">
                    <input
                      className={inputClass}
                      value={definition.validation?.regex ?? ""}
                      onChange={(event) =>
                        patch({
                          validation: cleanValidation({
                            ...definition.validation,
                            regex: event.target.value || undefined,
                          }),
                        })
                      }
                    />
                  </FormField>
                </div>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {definition.valueType === "fieldGroupArray" && definition.repeatDefinition ? (
        <RepeatDefinitionEditor
          definition={definition}
          depth={depth}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

function RepeatDefinitionEditor({
  definition,
  depth,
  onChange,
}: {
  definition: ParameterDefinition;
  depth: number;
  onChange: (definition: ParameterDefinition) => void;
}) {
  const repeat = definition.repeatDefinition!;

  function patchRepeat(patch: Partial<typeof repeat>) {
    onChange({
      ...definition,
      repeatDefinition: { ...repeat, ...patch },
    });
  }

  function addChild() {
    const used = new Set(repeat.itemParameterDefinitions.map((item) => item.id));
    patchRepeat({
      itemParameterDefinitions: [
        ...repeat.itemParameterDefinitions,
        newParameter(nextId("item_parameter", used)),
      ],
    });
  }

  return (
    <section className="border-t pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Repeat definition</div>
        <Button variant="outline" size="sm" onClick={addChild}>
          <Plus />
          Item Parameter
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <FormField label="Item name template">
          <input
            className={inputClass}
            value={repeat.itemNameTemplate}
            onChange={(event) => patchRepeat({ itemNameTemplate: event.target.value })}
          />
        </FormField>
        <FormField label="Index base">
          <OptionalNumberInput
            integer
            value={repeat.indexBase}
            onChange={(indexBase) => patchRepeat({ indexBase: indexBase ?? 0 })}
          />
        </FormField>
        <FormField label="Minimum items">
          <OptionalNumberInput
            integer
            value={repeat.minItems}
            onChange={(minItems) => patchRepeat({ minItems })}
          />
        </FormField>
        <FormField label="Maximum items">
          <OptionalNumberInput
            integer
            value={repeat.maxItems}
            onChange={(maxItems) => patchRepeat({ maxItems })}
          />
        </FormField>
      </div>
      <div className="mt-4 divide-y border-y">
        {repeat.itemParameterDefinitions.map((child, index) => (
          <details key={`${child.id}:${index}`} className="group" open={index === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-3">
              <div className="min-w-0">
                <span className="text-sm font-medium">{child.name || "Untitled item parameter"}</span>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  {child.id || "missing id"}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="Delete item parameter"
                onClick={(event) => {
                  event.preventDefault();
                  patchRepeat({
                    itemParameterDefinitions: repeat.itemParameterDefinitions.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  });
                }}
              >
                <Trash2 />
              </Button>
            </summary>
            <div className="border-t bg-muted/10 px-3 py-4">
              <ParameterDefinitionEditor
                definition={child}
                depth={depth + 1}
                onChange={(nextChild) =>
                  patchRepeat({
                    itemParameterDefinitions: repeat.itemParameterDefinitions.map(
                      (item, itemIndex) => (itemIndex === index ? nextChild : item),
                    ),
                  })
                }
              />
            </div>
          </details>
        ))}
        {repeat.itemParameterDefinitions.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No item parameters
          </div>
        ) : null}
      </div>
      {depth >= 2 ? (
        <div className="mt-3 text-xs text-muted-foreground">Nested repeat depth: {depth + 1}</div>
      ) : null}
    </section>
  );
}

function OptionEditor({
  options,
  multiple,
  selectionMode,
  onSelectionModeChange,
  onChange,
}: {
  options: StaticOption[];
  multiple: boolean;
  selectionMode?: "single" | "multiple" | null;
  onSelectionModeChange: (value: "single" | "multiple") => void;
  onChange: (options: StaticOption[]) => void;
}) {
  return (
    <section className="border-t pt-4">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="text-sm font-semibold">Static options</div>
        <div className="flex items-center gap-2">
          <select
            className={cn(selectClass, "w-32")}
            value={multiple ? "multiple" : selectionMode ?? "single"}
            disabled={multiple}
            onChange={(event) =>
              onSelectionModeChange(event.target.value as "single" | "multiple")
            }
          >
            <option value="single">Single</option>
            <option value="multiple">Multiple</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([...options, { value: `option_${options.length + 1}`, name: "Option" }])
            }
          >
            <Plus />
            Option
          </Button>
        </div>
      </div>
      <div className="divide-y rounded-md border">
        {options.map((option, index) => (
          <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 p-2 max-sm:grid-cols-1">
            <input
              className={inputClass}
              value={String(option.value)}
              onChange={(event) =>
                onChange(
                  options.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
            <input
              className={inputClass}
              value={option.name}
              onChange={(event) =>
                onChange(
                  options.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
            <Button
              variant="ghost"
              size="icon"
              title="Delete option"
              onClick={() => onChange(options.filter((_, itemIndex) => itemIndex !== index))}
            >
              <X />
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function NumericRule({
  label,
  value,
  exclusive,
  onChange,
}: {
  label: string;
  value?: number;
  exclusive?: boolean;
  onChange: (value: number | undefined, exclusive: boolean | undefined) => void;
}) {
  return (
    <div>
      <FormField label={label}>
        <OptionalNumberInput
          value={value}
          onChange={(next) => onChange(next, next == null ? undefined : exclusive ?? false)}
        />
      </FormField>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={exclusive === true}
          disabled={value == null}
          onChange={(event) => onChange(value, event.target.checked)}
        />
        Exclusive
      </label>
    </div>
  );
}

function OptionalNumberInput({
  value,
  integer = false,
  onChange,
}: {
  value?: number;
  integer?: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <input
      className={inputClass}
      type="number"
      step={integer ? 1 : "any"}
      value={value ?? ""}
      onChange={(event) =>
        onChange(
          event.target.value === ""
            ? undefined
            : integer
              ? Number.parseInt(event.target.value, 10)
              : Number.parseFloat(event.target.value),
        )
      }
    />
  );
}

function EditorSection({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border bg-white shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-primary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          {title}
        </h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <div className="mb-2 text-sm font-medium leading-none">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </div>
      {children}
    </label>
  );
}

function newTemplate(): ProcessStepTemplate {
  return {
    schemaVersion: 2,
    id: "",
    version: "V2.0.0",
    name: "",
    category: "",
    program: "",
    description: "",
    owner: "",
    inputPorts: [clone(PRIMARY_PORT)],
    outputPorts: [clone(RESULT_PORT)],
    parameterDefinitions: [],
  };
}

function newParameter(id: string): ParameterDefinition {
  return {
    id,
    name: "New parameter",
    description: "",
    valueType: "string",
    controlType: "text",
    selectionMode: null,
    required: true,
    unit: null,
  };
}

function validateTemplate(template: ProcessStepTemplate) {
  const requiredIdentity: Array<[string, string]> = [
    ["Template id", template.id],
    ["Version", template.version],
    ["Name", template.name],
    ["Category", template.category],
    ["Program", template.program],
    ["Owner", template.owner],
  ];
  const missing = requiredIdentity.find(([, value]) => !value.trim());
  if (missing) return `${missing[0]} is required.`;
  if (!validIdentifier(template.id)) return "Template id contains unsupported characters.";
  if (
    template.inputPorts.length === 0 ||
    template.inputPorts[0].portId !== "main_geometry" ||
    template.inputPorts[0].role !== "primary" ||
    !template.inputPorts[0].required
  ) {
    return "The required primary main_geometry input port is missing.";
  }
  if (
    template.outputPorts.length !== 1 ||
    template.outputPorts[0].portId !== "result_geometry"
  ) {
    return "The result_geometry output port is invalid.";
  }
  const portError = validateIds(
    template.inputPorts.map((port) => port.portId),
    "Input port",
  );
  if (portError) return portError;
  if (template.inputPorts.some((port) => !port.name.trim())) return "Every input port needs a name.";
  const parameterError = validateParameters(template.parameterDefinitions, "Parameter");
  return parameterError;
}

function validateParameters(definitions: ParameterDefinition[], label: string): string | null {
  const idError = validateIds(
    definitions.map((definition) => definition.id),
    label,
  );
  if (idError) return idError;
  for (const definition of definitions) {
    if (!definition.name.trim()) return `${label} ${definition.id} needs a name.`;
    if (definition.validation?.min != null && definition.validation?.max != null) {
      if (definition.validation.min > definition.validation.max) {
        return `${label} ${definition.id} has an invalid numeric range.`;
      }
    }
    if (
      definition.validation?.minLength != null &&
      definition.validation.minLength < 0
    ) {
      return `${label} ${definition.id} has a negative minimum length.`;
    }
    if (
      definition.validation?.maxLength != null &&
      definition.validation.maxLength < 0
    ) {
      return `${label} ${definition.id} has a negative maximum length.`;
    }
    if (
      definition.validation?.minLength != null &&
      definition.validation?.maxLength != null &&
      definition.validation.minLength > definition.validation.maxLength
    ) {
      return `${label} ${definition.id} has an invalid length range.`;
    }
    if (definition.validation?.regex) {
      try {
        new RegExp(definition.validation.regex);
      } catch {
        return `${label} ${definition.id} has an invalid regular expression.`;
      }
    }
    if (definition.valueType === "fieldGroupArray") {
      const repeat = definition.repeatDefinition;
      if (!repeat) return `${label} ${definition.id} needs a repeat definition.`;
      if (repeat.minItems != null && repeat.minItems < 0) {
        return `${label} ${definition.id} has a negative minimum item count.`;
      }
      if (repeat.maxItems != null && repeat.maxItems < 0) {
        return `${label} ${definition.id} has a negative maximum item count.`;
      }
      if (
        repeat.minItems != null &&
        repeat.maxItems != null &&
        repeat.minItems > repeat.maxItems
      ) {
        return `${label} ${definition.id} has an invalid item range.`;
      }
      const childError = validateParameters(
        repeat.itemParameterDefinitions,
        `Item parameter in ${definition.id}`,
      );
      if (childError) return childError;
    }
  }
  return null;
}

function validateIds(ids: string[], label: string) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id.trim()) return `${label} id is required.`;
    if (!validIdentifier(id)) return `${label} id ${id} contains unsupported characters.`;
    if (seen.has(id)) return `${label} id ${id} is duplicated.`;
    seen.add(id);
  }
  return null;
}

function validIdentifier(value: string) {
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value);
}

function compatibleControls(valueType: ValueType): Exclude<ControlType, null>[] {
  if (valueType === "coordinates") return ["coordinateList"];
  if (valueType === "fieldGroupArray") return ["repeater"];
  if (valueType === "boolean") return ["checkbox", "select"];
  if (valueType === "integer" || valueType === "float") return ["number", "select"];
  if (valueType.endsWith("[]")) return ["text", "select", "checkbox"];
  return ["text", "select"];
}

function defaultControl(valueType: ValueType): ControlType {
  if (valueType === "coordinates") return "coordinateList";
  if (valueType === "fieldGroupArray") return "repeater";
  if (valueType === "boolean") return "checkbox";
  if (valueType === "integer" || valueType === "float") return "number";
  return "text";
}

function controlLabel(control: Exclude<ControlType, null>) {
  const labels: Record<Exclude<ControlType, null>, string> = {
    text: "Text",
    number: "Number",
    checkbox: "Checkbox",
    select: "Select",
    repeater: "Repeater",
    coordinateList: "Coordinate list",
  };
  return labels[control];
}

function cleanValidation(
  validation: ParameterDefinition["validation"],
): ParameterDefinition["validation"] {
  if (!validation) return undefined;
  const entries = Object.entries(validation).filter(([, value]) => value !== undefined && value !== "");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function shortValueType(valueType: ValueType) {
  if (valueType === "fieldGroupArray") return "group[]";
  if (valueType === "materialRef") return "material";
  if (valueType === "materialRef[]") return "material[]";
  return valueType;
}

function nextId(base: string, used: Set<string>) {
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function templateSort(left: ProcessStepTemplate, right: ProcessStepTemplate) {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}
