"use client";

import * as React from "react";

import { EngineeringPreviewRenderer } from "./engineering-preview-renderer";
import { engineeringPreviewAspectRatioLimit } from "./engineering-preview-transform";
import type { GeometryGeneratorDefinition, GeometryGeneratorPreview } from "./geometry-generator-contracts";
import { fromGeneratorEditorValues, visibleGeneratorParameters } from "./geometry-generator-parameters";
import type { GeometryGeneratorDefineResult } from "./geometry-generator-types";
import { ParameterValueEditor } from "@/components/process-flow-parameters/parameter-value-editor";
import { previewGeneratedGeometry } from "@/lib/process-flow-api";

/** Shared by catalog authoring and the transactional flow input editor. */
export function useGeometryGeneratorPreview(
  definition: GeometryGeneratorDefinition | null,
  editorValues: Record<string, unknown>,
) {
  const parameters = React.useMemo(
    () => definition ? fromGeneratorEditorValues(definition.parameterDefinitions, editorValues) : {},
    [definition, editorValues],
  );
  const [retryCount, setRetryCount] = React.useState(0);
  const sourceKey = definition ? JSON.stringify([definition.id, definition.version]) : null;
  const requestKey = JSON.stringify([sourceKey, parameters, retryCount]);
  const [response, setResponse] = React.useState<{
    sourceKey: string; requestKey: string; preview: GeometryGeneratorPreview;
  } | null>(null);
  const [failure, setFailure] = React.useState<{ requestKey: string; message: string } | null>(null);
  const requestError = failure?.requestKey === requestKey ? failure.message : null;
  const preview = response?.sourceKey === sourceKey ? response!.preview : null;
  const latestPreview = response?.requestKey === requestKey && !requestError ? response.preview : null;
  const previewing = definition !== null && !latestPreview && !requestError;

  React.useEffect(() => {
    if (!definition || !sourceKey) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      previewGeneratedGeometry(definition.id, definition.version, parameters, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setResponse({ sourceKey, requestKey, preview: result });
          setFailure(null);
        })
        .catch((error) => {
          if (!controller.signal.aborted) setFailure({ requestKey,
            message: error instanceof Error ? error.message : "Unable to generate preview." });
        });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [definition, sourceKey, requestKey, parameters, retryCount]);

  return {
    preview, latestPreview, previewing, requestError,
    retry: () => { setFailure(null); setRetryCount((value) => value + 1); },
    canDefine: latestPreview?.valid === true && latestPreview.geometryEntityJson != null,
    canMaterialize: latestPreview?.valid === true && typeof latestPreview.previewToken === "string",
  };
}

export function geometryGeneratorDefineResult(
  definition: GeometryGeneratorDefinition,
  preview: GeometryGeneratorPreview | null,
): GeometryGeneratorDefineResult | null {
  if (!preview?.valid || !preview.geometryEntityJson) return null;
  const { id: _id, ...geometry } = preview.geometryEntityJson;
  return {
    binding: { kind: "generator", generatorId: definition.id, generatorVersion: definition.version,
      parameters: structuredClone(preview.normalizedParameters) },
    suggestedFlowInputName: `${definition.label.replace(/\s+generator$/i, "")} input`,
    geometry: { ...geometry, owner: geometry.owner ?? null, description: geometry.description ?? null },
  };
}

/** The same editing body is used by the generator page and flow input dialog. */
export function GeometryGeneratorEditorContent({ definition, values, generator, onChange, feedback, children }: {
  definition: GeometryGeneratorDefinition;
  values: Record<string, unknown>;
  generator: ReturnType<typeof useGeometryGeneratorPreview>;
  onChange: (values: Record<string, unknown>) => void;
  feedback?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-5">
      <GeometryGeneratorEngineeringPreview key={`${definition.id}@${definition.version}`}
        preview={generator.preview} previewing={generator.previewing} />
      <GeometryGeneratorValidation preview={generator.latestPreview} error={generator.requestError}
        onRetry={generator.retry} />
      {feedback}
      <GeometryGeneratorParameters definition={definition} values={values} errors={generator.latestPreview?.errors}
        onChange={onChange} />
      {children}
    </div>
  );
}

export function GeometryGeneratorParameters({ definition, values, errors, onChange }: {
  definition: GeometryGeneratorDefinition;
  values: Record<string, unknown>;
  errors?: Record<string, string>;
  onChange: (values: Record<string, unknown>) => void;
}) {
  return (
    <section aria-label="Geometry generator parameters" className="min-w-0">
      <ParameterValueEditor definitions={visibleGeneratorParameters(definition.parameterDefinitions, values)}
        groups={definition.parameterGroups} values={values} errors={errors} onChange={onChange} />
    </section>
  );
}

export function GeometryGeneratorEngineeringPreview({ preview, previewing }: {
  preview: GeometryGeneratorPreview | null; previewing: boolean;
}) {
  const [originalAspect, setOriginalAspect] = React.useState(false);
  return preview?.engineeringPreview ? (
    <section aria-label="Engineering preview" aria-busy={previewing} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {previewing ? <span role="status" className="text-xs text-muted-foreground">Updating preview…</span> : null}
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input checked={originalAspect} className="h-4 w-4 rounded border-input accent-primary" type="checkbox"
            onChange={(event) => setOriginalAspect(event.target.checked)} />
          Show original aspect ratio
        </label>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {preview.engineeringPreview.views.map((view) => (
          <EngineeringPreviewRenderer key={view.id} view={view} unit={preview.engineeringPreview!.unit}
            maxRenderedAspectRatio={engineeringPreviewAspectRatioLimit(view.id, originalAspect)} />
        ))}
      </div>
    </section>
  ) : (
    <div role="status" className="grid min-h-56 place-items-center rounded-md border border-dashed bg-muted/10 p-4 text-center text-sm text-muted-foreground">
      {previewing ? "Generating engineering preview…" : "Enter valid parameters to preview geometry."}
    </div>
  );
}

export function GeometryGeneratorValidation({ preview, error, onRetry }: {
  preview: GeometryGeneratorPreview | null; error: string | null; onRetry: () => void;
}) {
  return <>
    {error ? (
      <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {error}
        <button type="button" className="ml-3 rounded-sm font-medium underline focus-visible:outline focus-visible:outline-2"
          onClick={onRetry}>Retry preview</button>
      </div>
    ) : null}
    {preview && !preview.valid ? (
      <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
        <div className="font-medium">Resolve the generator parameters:</div>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {Object.entries(preview.errors).map(([field, message]) => (
            <li key={field}><span className="break-words font-mono text-xs">{field}</span>: {message}</li>
          ))}
        </ul>
      </div>
    ) : null}
  </>;
}
