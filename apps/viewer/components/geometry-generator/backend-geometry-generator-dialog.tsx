"use client";

import * as React from "react";
import { ArrowLeft, Boxes, Database, Download, Loader2, X } from "lucide-react";

import type {
  GeometryGeneratorDefinition,
  GeometryGeneratorPreview,
} from "@/components/geometry-generator/geometry-generator-contracts";
import { EngineeringPreviewRenderer } from "@/components/geometry-generator/engineering-preview-renderer";
import {
  GeometryGeneratorSaveDialog,
  generatorSaveMetadataIsValid,
  type GeneratorSaveMetadata,
} from "@/components/geometry-generator/geometry-generator-save-dialog";
import type {
  GeometryGeneratorDefineResult,
  GeometryGeneratorMode,
} from "@/components/geometry-generator/geometry-generator-types";
import { ParameterValueEditor } from "@/components/process-flow-parameters/parameter-value-editor";
import { Button } from "@/components/ui/button";
import type {
  EmbeddedGeometry,
  ParameterDefinition,
  RepeatableGroupValue,
} from "@/lib/process-flow/types";
import { isRepeatableGroupValue } from "@/lib/process-flow/parameter-values";
import {
  createGeometry,
  materializeGeneratedGeometry,
  previewGeneratedGeometry,
} from "@/lib/process-flow-api";

export function BackendGeometryGeneratorDialog({
  definition,
  mode = "catalog",
  presentation = "dialog",
  initialParameters,
  onClose,
  onDefine,
}: {
  definition: GeometryGeneratorDefinition;
  mode?: GeometryGeneratorMode;
  presentation?: "dialog" | "page";
  initialParameters?: Record<string, unknown>;
  onClose: () => void;
  onDefine?: (result: GeometryGeneratorDefineResult) => void;
}) {
  const initialEditorValues = React.useMemo(
    () =>
      toEditorValues(definition.parameterDefinitions, {
        ...definition.defaultParameters,
        ...initialParameters,
      }),
    [definition, initialParameters],
  );
  const [editorValues, setEditorValues] = React.useState(initialEditorValues);
  const [preview, setPreview] = React.useState<GeometryGeneratorPreview | null>(null);
  const [previewKey, setPreviewKey] = React.useState<string | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [saveMetadata, setSaveMetadata] = React.useState<GeneratorSaveMetadata>({
    name: `Generated ${definition.label.replace(/\s+generator$/i, "")}`,
    vendor: "",
    type1: "",
    type2: "",
    owner: "",
    description: "",
  });
  const parameters = React.useMemo(
    () => fromEditorValues(definition.parameterDefinitions, editorValues),
    [definition.parameterDefinitions, editorValues],
  );
  const parametersKey = React.useMemo(() => JSON.stringify(parameters), [parameters]);
  const latestPreview = previewKey === parametersKey ? preview : null;
  const canMaterialize =
    latestPreview?.valid === true && typeof latestPreview.previewToken === "string";

  React.useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      setRequestError(null);
      previewGeneratedGeometry(
        definition.id,
        definition.version,
        parameters,
        controller.signal,
      )
        .then((result) => {
          setPreview(result);
          setPreviewKey(parametersKey);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setRequestError(
            error instanceof Error ? error.message : "Unable to generate preview.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false);
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [definition.id, definition.version, parameters, parametersKey]);

  React.useEffect(() => {
    if (presentation !== "dialog") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [presentation]);

  async function resolveMaterializedGeometry() {
    if (!canMaterialize || !latestPreview?.previewToken) {
      throw new Error("Wait for a valid preview before generating geometry.");
    }
    const materialized = await materializeGeneratedGeometry(latestPreview.previewToken);
    if (materialized.geometryHash !== latestPreview.geometryHash) {
      throw new Error("Preview geometry changed before materialization.");
    }
    return materialized.geometryEntityJson;
  }

  async function defineGeometry() {
    if (!onDefine || !canMaterialize) return;
    setRequestError(null);
    try {
      const entity = await resolveMaterializedGeometry();
      onDefine({
        suggestedFlowInputName: `${definition.label.replace(/\s+generator$/i, "")} input`,
        geometry: embeddedGeometryFromEntity(entity),
      });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unable to define geometry.");
    }
  }

  async function saveGeometry() {
    if (!canMaterialize || !generatorSaveMetadataIsValid(saveMetadata) || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const entity = await resolveMaterializedGeometry();
      const saved = await createGeometry({
        ...entity,
        id: null,
        name: saveMetadata.name.trim(),
        vendor: saveMetadata.vendor.trim() || null,
        type1: saveMetadata.type1.trim() || null,
        type2: saveMetadata.type2.trim() || null,
        owner: saveMetadata.owner.trim(),
        description: saveMetadata.description.trim() || null,
      });
      setSaveDialogOpen(false);
      setNotice(`Saved “${saved.name}” to the geometry catalog as ${saved.id}.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save geometry.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadGeometry() {
    setRequestError(null);
    try {
      const entity = await resolveMaterializedGeometry();
      const blob = new Blob([`${JSON.stringify(entity.structure, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${definition.id}-geometry.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unable to download geometry.");
    }
  }

  return (
    <div
      className={
        presentation === "dialog"
          ? "fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5"
          : "flex min-h-screen justify-center bg-muted/20"
      }
    >
      {presentation === "dialog" ? (
        <div aria-hidden="true" className="absolute inset-0 bg-foreground/45 backdrop-blur-[1px]" />
      ) : null}
      <section
        aria-label={`${definition.label} dialog`}
        aria-modal={presentation === "dialog" ? true : undefined}
        className={
          presentation === "dialog"
            ? "relative z-10 flex max-h-[calc(100vh-24px)] w-[min(1240px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border bg-background shadow-viewport sm:max-h-[calc(100vh-40px)]"
            : "flex min-h-screen w-full flex-col bg-background md:w-[70%] md:border-x"
        }
        role={presentation === "dialog" ? "dialog" : undefined}
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">{definition.label}</h2>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>
          </div>
          {presentation === "dialog" ? (
            <Button
              aria-label="Close generator"
              size="icon"
              title="Close"
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              <X />
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              <ArrowLeft />Home
            </Button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 px-4 py-5 sm:px-5">
            {preview?.engineeringPreview ? (
              <section className="grid gap-4 lg:grid-cols-2">
                {preview.engineeringPreview.views.map((view) => (
                  <EngineeringPreviewRenderer
                    key={view.id}
                    view={view}
                    unit={preview.engineeringPreview!.unit}
                  />
                ))}
              </section>
            ) : (
              <div className="grid min-h-56 place-items-center rounded-md border border-dashed bg-muted/10 text-sm text-muted-foreground">
                {previewing ? "Generating engineering preview…" : "Enter valid parameters to preview geometry."}
              </div>
            )}

            {requestError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {requestError}
              </div>
            ) : null}
            {latestPreview && !latestPreview.valid ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
                <div className="font-medium">Resolve the generator parameters:</div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {Object.entries(latestPreview.errors).map(([field, message]) => (
                    <li key={field}>
                      <span className="font-mono text-xs">{field}</span>: {message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {notice ? (
              <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary">
                {notice}
              </div>
            ) : null}

            <section aria-label="Geometry generator parameters">
              <ParameterValueEditor
                definitions={definition.parameterDefinitions}
                groups={definition.parameterGroups}
                values={editorValues}
                errors={latestPreview?.errors}
                onChange={(values) => {
                  setEditorValues(values);
                  setNotice(null);
                }}
              />
            </section>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-white px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">
            Geometry and engineering views are generated by {definition.id}@{definition.version}.
          </p>
          {mode === "flowInput" ? (
            <Button className="ml-auto" disabled={!canMaterialize} type="button" onClick={() => void defineGeometry()}>
              <Boxes />
              Define
            </Button>
          ) : (
            <div className="ml-auto flex gap-2">
              <Button disabled={!canMaterialize} type="button" variant="outline" onClick={() => void downloadGeometry()}>
                <Download />
                Generate JSON
              </Button>
              <Button disabled={!canMaterialize} type="button" onClick={() => setSaveDialogOpen(true)}>
                <Database />
                Save to DB
              </Button>
            </div>
          )}
        </footer>
      </section>

      {saveDialogOpen ? (
        <GeometryGeneratorSaveDialog
          generatorLabel={definition.label.replace(/\s+generator$/i, "")}
          entityType={definition.entityType}
          category={definition.category ?? ""}
          icon={definition.icon ?? "geometry"}
          error={saveError}
          metadata={saveMetadata}
          saving={saving}
          onChange={(patch) => {
            setSaveMetadata((current) => ({ ...current, ...patch }));
            setSaveError(null);
          }}
          onClose={() => {
            if (!saving) setSaveDialogOpen(false);
          }}
          onSubmit={saveGeometry}
        />
      ) : null}
    </div>
  );
}

function embeddedGeometryFromEntity(
  entity: EmbeddedGeometry & { id?: string | null },
): EmbeddedGeometry {
  const { id: _id, ...geometry } = entity;
  return {
    ...geometry,
    owner: geometry.owner ?? null,
    description: geometry.description ?? null,
  };
}

function toEditorValues(
  definitions: ParameterDefinition[],
  parameters: Record<string, unknown>,
) {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      toEditorValue(definition, parameters[definition.id]),
    ]),
  );
}

function toEditorValue(definition: ParameterDefinition, value: unknown): unknown {
  if (definition.valueType !== "fieldGroupArray" || !definition.repeatDefinition) {
    return value;
  }
  const items = Array.isArray(value) ? value : [];
  return {
    items: items.map((item, offset) => {
      const record = isRecord(item) ? item : {};
      const index = definition.repeatDefinition!.indexBase + offset;
      return {
        itemId:
          typeof record.id === "string"
            ? record.id
            : `${definition.id}-${String(index).padStart(2, "0")}`,
        index,
        values: Object.fromEntries(
          definition.repeatDefinition!.itemParameterDefinitions.map((child) => [
            child.id,
            toEditorValue(child, record[child.id]),
          ]),
        ),
      };
    }),
  } satisfies RepeatableGroupValue;
}

function fromEditorValues(
  definitions: ParameterDefinition[],
  values: Record<string, unknown>,
) {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      fromEditorValue(definition, values[definition.id]),
    ]),
  );
}

function fromEditorValue(definition: ParameterDefinition, value: unknown): unknown {
  if (definition.valueType !== "fieldGroupArray" || !definition.repeatDefinition) {
    return value;
  }
  if (!isRepeatableGroupValue(value)) return [];
  return value.items.map((item) => ({
    id: item.itemId,
    ...Object.fromEntries(
      definition.repeatDefinition!.itemParameterDefinitions.map((child) => [
        child.id,
        fromEditorValue(child, item.values[child.id]),
      ]),
    ),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
