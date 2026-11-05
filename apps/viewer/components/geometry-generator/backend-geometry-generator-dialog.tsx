"use client";

import * as React from "react";
import { ArrowLeft, Boxes, Database, Download, Loader2, X } from "lucide-react";

import type { GeometryGeneratorDefinition } from "./geometry-generator-contracts";
import { toGeneratorEditorValues } from "./geometry-generator-parameters";
import {
  GeometryGeneratorEngineeringPreview,
  GeometryGeneratorParameters,
  GeometryGeneratorValidation,
  geometryGeneratorDefineResult,
  useGeometryGeneratorPreview,
} from "./geometry-generator-editor";
import {
  GeometryGeneratorSaveDialog,
  generatorSaveMetadataIsValid,
  type GeneratorSaveMetadata,
} from "@/components/geometry-generator/geometry-generator-save-dialog";
import type {
  GeometryGeneratorDefineResult,
  GeometryGeneratorMode,
} from "@/components/geometry-generator/geometry-generator-types";
import { Button } from "@/components/ui/button";
import {
  createGeometry,
  materializeGeneratedGeometry,
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
      toGeneratorEditorValues(definition.parameterDefinitions, {
        ...definition.defaultParameters,
        ...initialParameters,
      }),
    [definition, initialParameters],
  );
  const [editorValues, setEditorValues] = React.useState(initialEditorValues);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const generator = useGeometryGeneratorPreview(definition, editorValues);
  const { latestPreview, previewing, canMaterialize, canDefine } = generator;
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

  function defineGeometry() {
    const result = geometryGeneratorDefineResult(definition, latestPreview);
    if (result && onDefine) onDefine(result);
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
    setActionError(null);
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
      setActionError(error instanceof Error ? error.message : "Unable to download geometry.");
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
            <GeometryGeneratorEngineeringPreview preview={generator.preview} previewing={previewing} />
            <GeometryGeneratorValidation preview={latestPreview} error={generator.requestError}
              onRetry={generator.retry} />
            {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
            {notice ? (
              <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary">
                {notice}
              </div>
            ) : null}

            <GeometryGeneratorParameters definition={definition} values={editorValues} errors={latestPreview?.errors}
              onChange={(values) => { setEditorValues(values); setNotice(null); setActionError(null); }} />
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-white px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">
            Geometry and engineering views are generated by {definition.id}@{definition.version}.
          </p>
          {mode === "flowInput" ? (
            <Button className="ml-auto" disabled={!canDefine} type="button" onClick={() => void defineGeometry()}>
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
