"use client";

import * as React from "react";
import {
  Boxes,
  CheckCircle2,
  Database,
  Download,
  X,
} from "lucide-react";

import {
  GeometryGeneratorSaveDialog,
  generatorSaveMetadataIsValid,
  type GeneratorSaveMetadata,
} from "@/components/geometry-generator/geometry-generator-save-dialog";
import {
  generatedGeometryDraft,
  geometryGeneration,
  type GeometryGeneratorDefineResult,
  type GeometryGeneratorMode,
} from "@/components/geometry-generator/geometry-generator-types";
import {
  HbmCrossSectionDrawing,
  HbmTopViewDrawing,
} from "@/components/hbm-generator/hbm-engineering-drawings";
import { Button } from "@/components/ui/button";
import {
  buildHbmGeometry,
  DEFAULT_HBM_PARAMETERS,
  MAX_CORE_DIE_COUNT,
  validateHbmParameters,
  type HbmGeneratorParameters,
  type HbmParameterKey,
} from "@/lib/hbm-generator";
import { createGeometry } from "@/lib/process-flow-api";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

type GeneratorNotice = {
  tone: "success" | "neutral";
  message: string;
};

const DEFAULT_SAVE_METADATA: GeneratorSaveMetadata = {
  name: "Generated HBM",
  version: "current",
  owner: "",
  description: "",
};

export function HbmGeneratorDialog({
  mode = "catalog",
  initialParameters,
  onClose,
  onDefine,
}: {
  mode?: GeometryGeneratorMode;
  initialParameters?: HbmGeneratorParameters;
  onClose: () => void;
  onDefine?: (result: GeometryGeneratorDefineResult) => void;
}) {
  const [parameters, setParameters] = React.useState<HbmGeneratorParameters>(() => ({
    ...(initialParameters ?? DEFAULT_HBM_PARAMETERS),
  }));
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [saveMetadata, setSaveMetadata] =
    React.useState<GeneratorSaveMetadata>(DEFAULT_SAVE_METADATA);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<GeneratorNotice | null>(null);
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const saveDialogOpenRef = React.useRef(saveDialogOpen);
  const savingRef = React.useRef(saving);

  const errors = React.useMemo(() => validateHbmParameters(parameters), [parameters]);
  const valid = Object.keys(errors).length === 0;

  React.useEffect(() => {
    onCloseRef.current = onClose;
    saveDialogOpenRef.current = saveDialogOpen;
    savingRef.current = saving;
  }, [onClose, saveDialogOpen, saving]);

  React.useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !saveDialogOpenRef.current &&
        !savingRef.current
      ) {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, []);

  function updateNumber(key: HbmParameterKey, rawValue: string) {
    setParameters((current) => ({ ...current, [key]: Number(rawValue) }));
    setNotice(null);
  }

  function updateText(key: HbmParameterKey, value: string) {
    setParameters((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function downloadGeometry() {
    if (!valid) return;
    const structure = buildHbmGeometry(parameters);
    const blob = new Blob([`${JSON.stringify(structure, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hbm-geometry.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice({ tone: "neutral", message: "Geometry JSON downloaded." });
  }

  async function saveGeometry() {
    if (!valid || !generatorSaveMetadataIsValid(saveMetadata) || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await createGeometry({
        id: null,
        name: saveMetadata.name.trim(),
        version: saveMetadata.version.trim(),
        owner: saveMetadata.owner.trim(),
        description: saveMetadata.description.trim() || null,
        entityType: "die",
        category: "die.hbm",
        icon: "die.stack",
        structureFormat: "standard",
        structure: buildHbmGeometry(parameters),
        generation: geometryGeneration(
          "hbm",
          1,
          parameters as unknown as Record<string, unknown>,
        ),
      });
      setSaveDialogOpen(false);
      setNotice({
        tone: "success",
        message: `Saved “${saved.name}” to the geometry catalog as ${saved.id}.`,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save geometry.");
    } finally {
      setSaving(false);
    }
  }

  function defineGeometry() {
    if (!valid || !onDefine) return;
    onDefine({
      suggestedFlowInputName: "HBM input",
      geometry: generatedGeometryDraft({
        name: "hbm_generator",
        entityType: "die",
        category: "die.hbm",
        icon: "die.stack",
        structureFormat: "standard",
        structure: buildHbmGeometry(parameters),
        generation: geometryGeneration(
          "hbm",
          1,
          parameters as unknown as Record<string, unknown>,
        ),
      }),
    });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5">
      <div aria-hidden="true" className="absolute inset-0 bg-foreground/45 backdrop-blur-[1px]" />
      <section
        aria-describedby="hbm-generator-description"
        aria-labelledby="hbm-generator-title"
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100vh-24px)] w-[min(1240px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border bg-background shadow-viewport sm:max-h-[calc(100vh-40px)]"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" />
              <h2 id="hbm-generator-title" className="text-lg font-semibold">
                HBM Geometry Generator
              </h2>
            </div>
            <p
              id="hbm-generator-description"
              className="mt-1 text-sm text-muted-foreground"
            >
              Define a centered core-die stack inside a full molding package. All
              dimensions use micrometres.
            </p>
          </div>
          <Button
            aria-label="Close HBM generator"
            size="icon"
            title="Close"
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 px-4 py-5 sm:px-5">
            <section className="grid gap-4 lg:grid-cols-2">
              <DrawingCard
                description="Centered XY footprint with package, core die and derived side molding."
                title="Top View"
              >
                <HbmTopViewDrawing parameters={parameters} />
              </DrawingCard>
              <DrawingCard
                description="Base die, die stack, molding gaps and the derived package height."
                title="Cross Section"
              >
                <HbmCrossSectionDrawing parameters={parameters} />
              </DrawingCard>
            </section>

            <section aria-label="HBM geometry parameters" className="grid gap-4 lg:grid-cols-3">
              <ParameterCard
                description="The package footprint and molding cap above the top core die."
                title="Package"
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <NumberField
                    error={errors.packageX}
                    label="Package X"
                    value={parameters.packageX}
                    onChange={(value) => updateNumber("packageX", value)}
                  />
                  <NumberField
                    error={errors.packageY}
                    label="Package Y"
                    value={parameters.packageY}
                    onChange={(value) => updateNumber("packageY", value)}
                  />
                  <NumberField
                    error={errors.topMoldingThickness}
                    label="Top molding"
                    minimum={0}
                    value={parameters.topMoldingThickness}
                    onChange={(value) => updateNumber("topMoldingThickness", value)}
                  />
                  <TextField
                    error={errors.moldingMaterial}
                    label="Molding material"
                    value={parameters.moldingMaterial}
                    onChange={(value) => updateText("moldingMaterial", value)}
                  />
                </div>
              </ParameterCard>

              <ParameterCard
                description="The base die uses the full package footprint. Its material is shared by every core die."
                title="Base Die"
              >
                <div className="space-y-4">
                  <NumberField
                    error={errors.baseDieThickness}
                    label="Base die thickness"
                    value={parameters.baseDieThickness}
                    onChange={(value) => updateNumber("baseDieThickness", value)}
                  />
                  <TextField
                    error={errors.dieMaterial}
                    label="Die material"
                    value={parameters.dieMaterial}
                    onChange={(value) => updateText("dieMaterial", value)}
                  />
                  <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">Inherited footprint</div>
                    <div className="mt-1 font-mono">
                      {`${formatDimension(parameters.packageX)} × ${formatDimension(parameters.packageY)} µm`}
                    </div>
                  </div>
                </div>
              </ParameterCard>

              <ParameterCard
                description="All core dies share the same size, thickness and die material."
                title="Core Stack"
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <NumberField
                    error={errors.coreDieX}
                    label="Core die X"
                    value={parameters.coreDieX}
                    onChange={(value) => updateNumber("coreDieX", value)}
                  />
                  <NumberField
                    error={errors.coreDieY}
                    label="Core die Y"
                    value={parameters.coreDieY}
                    onChange={(value) => updateNumber("coreDieY", value)}
                  />
                  <NumberField
                    error={errors.coreDieThickness}
                    label="Core die thickness"
                    value={parameters.coreDieThickness}
                    onChange={(value) => updateNumber("coreDieThickness", value)}
                  />
                  <NumberField
                    error={errors.coreDieCount}
                    label="Core die count"
                    maximum={MAX_CORE_DIE_COUNT}
                    minimum={1}
                    step={1}
                    unit={null}
                    value={parameters.coreDieCount}
                    onChange={(value) => updateNumber("coreDieCount", value)}
                  />
                  <NumberField
                    error={errors.coreBaseGap}
                    label="Core–base gap"
                    minimum={0}
                    value={parameters.coreBaseGap}
                    onChange={(value) => updateNumber("coreBaseGap", value)}
                  />
                  <NumberField
                    error={errors.coreCoreGap}
                    label="Core–core gap"
                    minimum={0}
                    value={parameters.coreCoreGap}
                    onChange={(value) => updateNumber("coreCoreGap", value)}
                  />
                </div>
              </ParameterCard>
            </section>

            {notice ? (
              <div
                aria-live="polite"
                className={
                  notice.tone === "success"
                    ? "flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm text-primary"
                    : "flex items-start gap-2 rounded-md border bg-white px-3 py-2 text-sm text-foreground"
                }
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-all">{notice.message}</span>
              </div>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-white px-4 py-3 sm:px-5">
          <p className="text-xs text-muted-foreground">
            {valid
              ? "Root molding fills the package; child die bodies take spatial priority."
              : "Resolve the highlighted parameters before generating geometry."}
          </p>
          {mode === "flowInput" ? (
            <Button className="ml-auto" disabled={!valid} type="button" onClick={defineGeometry}>
              <Boxes />
              Define
            </Button>
          ) : (
            <div className="ml-auto flex gap-2">
              <Button disabled={!valid} type="button" variant="outline" onClick={downloadGeometry}>
                <Download />
                Generate JSON
              </Button>
              <Button
                disabled={!valid}
                type="button"
                onClick={() => {
                  setSaveError(null);
                  setSaveDialogOpen(true);
                }}
              >
                <Database />
                Save to DB
              </Button>
            </div>
          )}
        </footer>
      </section>

      {saveDialogOpen ? (
        <GeometryGeneratorSaveDialog
          generatorLabel="HBM"
          entityType="die"
          category="die.hbm"
          icon="die.stack"
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

function DrawingCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-md border bg-white shadow-sm">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="viewer-surface px-3 py-2">{children}</div>
    </article>
  );
}

function ParameterCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0 rounded-md border bg-white p-4 shadow-sm">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <p className="mb-4 mt-1 min-h-8 text-xs leading-4 text-muted-foreground">
        {description}
      </p>
      {children}
    </fieldset>
  );
}

function NumberField({
  label,
  value,
  error,
  minimum = 0.000001,
  maximum,
  step = "any",
  unit = "µm",
  onChange,
}: {
  label: string;
  value: number;
  error?: string;
  minimum?: number;
  maximum?: number;
  step?: number | "any";
  unit?: string | null;
  onChange: (value: string) => void;
}) {
  const errorId = React.useId();
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium">
      <span>{label}</span>
      <span className="relative">
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          className={`${inputClass} ${unit ? "pr-11" : ""} ${error ? "border-destructive focus:border-destructive focus:ring-destructive/15" : ""}`}
          max={maximum}
          min={minimum}
          step={step}
          type="number"
          value={Number.isFinite(value) ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
        {unit ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </span>
      {error ? (
        <span id={errorId} className="text-[11px] font-normal leading-4 text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function TextField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const errorId = React.useId();
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium">
      <span>{label}</span>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={`${inputClass} ${error ? "border-destructive focus:border-destructive focus:ring-destructive/15" : ""}`}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <span id={errorId} className="text-[11px] font-normal leading-4 text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function formatDimension(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}
