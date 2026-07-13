"use client";

import * as React from "react";
import {
  CheckCircle2,
  Database,
  Download,
  Layers3,
  Loader2,
  Save,
  WandSparkles,
  X,
} from "lucide-react";

import {
  DramCrossSectionDrawing,
  DramTopViewDrawing,
} from "@/components/dram-generator/dram-engineering-drawings";
import { Button } from "@/components/ui/button";
import {
  buildDramGeometry,
  DEFAULT_DRAM_PARAMETERS,
  dramLayerErrorKey,
  MAX_DRAM_BUILDUP_LAYER_COUNT,
  MAX_DRAM_CORE_DIE_COUNT,
  resizeBuildupLayers,
  validateDramParameters,
  type DramBuildupLayer,
  type DramGeneratorParameters,
  type DramParameterErrors,
  type DramScalarParameterKey,
  type DramStackSide,
} from "@/lib/dram-generator";
import { createGeometry } from "@/lib/process-flow-api";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[82px] w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

type SaveMetadata = {
  name: string;
  version: string;
  owner: string;
  description: string;
};

type GeneratorNotice = {
  tone: "success" | "neutral";
  message: string;
};

type BulkValues = Record<DramStackSide, { thickness: number; density: number }>;

const DEFAULT_SAVE_METADATA: SaveMetadata = {
  name: "Generated DRAM",
  version: "current",
  owner: "",
  description: "",
};

export function DramGeneratorDialog({ onClose }: { onClose: () => void }) {
  const [parameters, setParameters] = React.useState<DramGeneratorParameters>(() => ({
    ...DEFAULT_DRAM_PARAMETERS,
    topBuildupLayers: DEFAULT_DRAM_PARAMETERS.topBuildupLayers.map((layer) => ({
      ...layer,
    })),
    bottomBuildupLayers: DEFAULT_DRAM_PARAMETERS.bottomBuildupLayers.map((layer) => ({
      ...layer,
    })),
  }));
  const [bulkValues, setBulkValues] = React.useState<BulkValues>({
    top: { thickness: 20, density: 50 },
    bottom: { thickness: 20, density: 50 },
  });
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [saveMetadata, setSaveMetadata] =
    React.useState<SaveMetadata>(DEFAULT_SAVE_METADATA);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<GeneratorNotice | null>(null);
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const saveDialogOpenRef = React.useRef(saveDialogOpen);
  const savingRef = React.useRef(saving);

  const errors = React.useMemo(() => validateDramParameters(parameters), [parameters]);
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

  function updateNumber(key: DramScalarParameterKey, rawValue: string) {
    setParameters((current) => ({ ...current, [key]: Number(rawValue) }));
    setNotice(null);
  }

  function updateText(key: DramScalarParameterKey, value: string) {
    setParameters((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function updateLayer(
    side: DramStackSide,
    index: number,
    field: "thickness" | "density",
    rawValue: string,
  ) {
    const key = side === "top" ? "topBuildupLayers" : "bottomBuildupLayers";
    setParameters((current) => ({
      ...current,
      [key]: current[key].map((layer, layerIndex) =>
        layerIndex === index ? { ...layer, [field]: Number(rawValue) } : layer,
      ),
    }));
    setNotice(null);
  }

  function updateLayerCount(side: DramStackSide, rawValue: string) {
    const count = Number(rawValue);
    const key = side === "top" ? "topBuildupLayers" : "bottomBuildupLayers";
    setParameters((current) => ({
      ...current,
      [key]: resizeBuildupLayers(current[key], side, count),
    }));
    setNotice(null);
  }

  function applyBulkValue(side: DramStackSide, field: "thickness" | "density") {
    const key = side === "top" ? "topBuildupLayers" : "bottomBuildupLayers";
    const value = bulkValues[side][field];
    setParameters((current) => ({
      ...current,
      [key]: current[key].map((layer, index) =>
        field === "density" && (index + 1) % 2 !== 0
          ? layer
          : { ...layer, [field]: value },
      ),
    }));
    setNotice(null);
  }

  function downloadGeometry() {
    if (!valid) return;
    const structure = buildDramGeometry(parameters);
    const blob = new Blob([`${JSON.stringify(structure, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dram-geometry.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice({ tone: "neutral", message: "Geometry JSON downloaded." });
  }

  async function saveGeometry() {
    if (!valid || !metadataIsValid(saveMetadata) || saving) return;
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
        category: "die.dram",
        icon: "die.stack",
        structureFormat: "standard",
        structure: buildDramGeometry(parameters),
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

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5">
      <div aria-hidden="true" className="absolute inset-0 bg-foreground/45 backdrop-blur-[1px]" />
      <section
        aria-describedby="dram-generator-description"
        aria-labelledby="dram-generator-title"
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100vh-24px)] w-[min(1320px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border bg-background shadow-viewport sm:max-h-[calc(100vh-40px)]"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Layers3 className="h-5 w-5 text-primary" />
              <h2 id="dram-generator-title" className="text-lg font-semibold">
                DRAM Geometry Generator
              </h2>
            </div>
            <p
              id="dram-generator-description"
              className="mt-1 text-sm text-muted-foreground"
            >
              Define a centered molded die stack over an odd-layer SBT buildup.
              All dimensions use micrometres.
            </p>
          </div>
          <Button
            aria-label="Close DRAM generator"
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
                description="Centered package, SBT and core-die footprints with derived side molding."
                title="Top View"
              >
                <DramTopViewDrawing parameters={parameters} />
              </DrawingCard>
              <DrawingCard
                description="Molded die stack, solder masks, core layer and independent buildup stacks."
                title="Cross Section"
              >
                <DramCrossSectionDrawing parameters={parameters} />
              </DrawingCard>
            </section>

            <section
              aria-label="DRAM geometry parameters"
              className="grid gap-4 lg:grid-cols-3"
            >
              <ParameterCard
                description="The package and SBT share this footprint; molding surrounds the centered dies."
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
                description="All core dies share size, thickness and material; one molding gap applies below and between dies."
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
                    maximum={MAX_DRAM_CORE_DIE_COUNT}
                    minimum={1}
                    step={1}
                    unit={null}
                    value={parameters.coreDieCount}
                    onChange={(value) => updateNumber("coreDieCount", value)}
                  />
                  <NumberField
                    error={errors.dieGapThickness}
                    label="Molding die gap"
                    minimum={0}
                    value={parameters.dieGapThickness}
                    onChange={(value) => updateNumber("dieGapThickness", value)}
                  />
                  <TextField
                    error={errors.dieMaterial}
                    label="Die material"
                    value={parameters.dieMaterial}
                    onChange={(value) => updateText("dieMaterial", value)}
                  />
                </div>
              </ParameterCard>

              <ParameterCard
                description="Solder masks share one material; top and bottom buildup share dielectric and conductive materials."
                title="SBT Structure & Materials"
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <NumberField
                    error={errors.topSolderMaskThickness}
                    label="Top solder mask"
                    value={parameters.topSolderMaskThickness}
                    onChange={(value) => updateNumber("topSolderMaskThickness", value)}
                  />
                  <NumberField
                    error={errors.bottomSolderMaskThickness}
                    label="Bottom solder mask"
                    value={parameters.bottomSolderMaskThickness}
                    onChange={(value) => updateNumber("bottomSolderMaskThickness", value)}
                  />
                  <NumberField
                    error={errors.sbtCoreLayerThickness}
                    label="Core layer thickness"
                    value={parameters.sbtCoreLayerThickness}
                    onChange={(value) => updateNumber("sbtCoreLayerThickness", value)}
                  />
                  <TextField
                    error={errors.solderMaskMaterial}
                    label="Solder mask material"
                    value={parameters.solderMaskMaterial}
                    onChange={(value) => updateText("solderMaskMaterial", value)}
                  />
                  <TextField
                    error={errors.sbtCoreMaterial}
                    label="Core layer material"
                    value={parameters.sbtCoreMaterial}
                    onChange={(value) => updateText("sbtCoreMaterial", value)}
                  />
                  <TextField
                    error={errors.buildupDielectricMaterial}
                    label="Dielectric material"
                    value={parameters.buildupDielectricMaterial}
                    onChange={(value) => updateText("buildupDielectricMaterial", value)}
                  />
                  <TextField
                    error={errors.buildupConductiveMaterial}
                    label="Conductive material"
                    value={parameters.buildupConductiveMaterial}
                    onChange={(value) => updateText("buildupConductiveMaterial", value)}
                  />
                </div>
              </ParameterCard>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              {(["top", "bottom"] as const).map((side) => {
                const layers =
                  side === "top"
                    ? parameters.topBuildupLayers
                    : parameters.bottomBuildupLayers;
                return (
                  <BuildupStackCard
                    bulkValues={bulkValues[side]}
                    errors={errors}
                    key={side}
                    layers={layers}
                    side={side}
                    onApplyBulk={(field) => applyBulkValue(side, field)}
                    onBulkChange={(field, value) =>
                      setBulkValues((current) => ({
                        ...current,
                        [side]: { ...current[side], [field]: Number(value) },
                      }))
                    }
                    onLayerChange={(index, field, value) =>
                      updateLayer(side, index, field, value)
                    }
                    onLayerCountChange={(value) => updateLayerCount(side, value)}
                  />
                );
              })}
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
              ? "Even buildup layers contain a full-layer circuit envelope with independently configured density."
              : "Resolve the highlighted parameters before generating geometry."}
          </p>
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
        </footer>
      </section>

      {saveDialogOpen ? (
        <DramSaveDialog
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

function BuildupStackCard({
  side,
  layers,
  errors,
  bulkValues,
  onLayerCountChange,
  onLayerChange,
  onBulkChange,
  onApplyBulk,
}: {
  side: DramStackSide;
  layers: DramBuildupLayer[];
  errors: DramParameterErrors;
  bulkValues: { thickness: number; density: number };
  onLayerCountChange: (value: string) => void;
  onLayerChange: (
    index: number,
    field: "thickness" | "density",
    value: string,
  ) => void;
  onBulkChange: (field: "thickness" | "density", value: string) => void;
  onApplyBulk: (field: "thickness" | "density") => void;
}) {
  const label = side === "top" ? "Top" : "Bottom";
  const countError = errors[`${side}BuildupLayers`];
  const thicknessBulkValid = Number.isFinite(bulkValues.thickness) && bulkValues.thickness > 0;
  const densityBulkValid =
    Number.isFinite(bulkValues.density) &&
    bulkValues.density >= 0 &&
    bulkValues.density <= 100;

  return (
    <fieldset className="min-w-0 rounded-md border bg-white p-4 shadow-sm">
      <legend className="px-1 text-sm font-semibold">{label} Buildup Stack</legend>
      <p className="mb-4 mt-1 text-xs leading-4 text-muted-foreground">
        Layer 1 starts at the core layer and counts outward. Odd layers are dielectric;
        even layers add a circuit density envelope.
      </p>

      <div className="grid gap-3 md:grid-cols-[minmax(150px,0.65fr)_minmax(0,1.35fr)]">
        <NumberField
          error={countError}
          label={`${label} layer count`}
          maximum={MAX_DRAM_BUILDUP_LAYER_COUNT}
          minimum={1}
          step={2}
          unit={null}
          value={layers.length}
          onChange={onLayerCountChange}
        />
        <div className="grid gap-2 rounded-md border border-dashed bg-muted/20 p-2.5 sm:grid-cols-2">
          <BulkApplyField
            buttonLabel="Set all thicknesses"
            maximum={undefined}
            minimum={0.000001}
            unit="µm"
            valid={thicknessBulkValid}
            value={bulkValues.thickness}
            onApply={() => onApplyBulk("thickness")}
            onChange={(value) => onBulkChange("thickness", value)}
          />
          <BulkApplyField
            buttonLabel="Set all circuit densities"
            maximum={100}
            minimum={0}
            unit="%"
            valid={densityBulkValid}
            value={bulkValues.density}
            onApply={() => onApplyBulk("density")}
            onChange={(value) => onBulkChange("density", value)}
          />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-md border">
        <div className="hidden grid-cols-[minmax(118px,0.7fr)_minmax(120px,1fr)_minmax(140px,1fr)] gap-3 border-b bg-muted/45 px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground sm:grid">
          <span>Layer / type</span>
          <span>Thickness</span>
          <span>Circuit density</span>
        </div>
        <div className="divide-y">
          {layers.map((layer, index) => {
            const layerNumber = index + 1;
            const hasCircuit = layerNumber % 2 === 0;
            return (
              <div
                className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(118px,0.7fr)_minmax(120px,1fr)_minmax(140px,1fr)] sm:items-start"
                key={layer.id}
              >
                <div className="pt-1">
                  <div className="text-xs font-semibold">{`Layer ${layerNumber}`}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {hasCircuit ? "Dielectric + circuit" : "Dielectric only"}
                  </div>
                </div>
                <NumberField
                  error={errors[dramLayerErrorKey(side, index, "thickness")]}
                  label={`${label} layer ${layerNumber} thickness`}
                  value={layer.thickness}
                  visuallyCompact
                  onChange={(value) => onLayerChange(index, "thickness", value)}
                />
                {hasCircuit ? (
                  <NumberField
                    error={errors[dramLayerErrorKey(side, index, "density")]}
                    label={`${label} layer ${layerNumber} circuit density`}
                    maximum={100}
                    minimum={0}
                    unit="%"
                    value={layer.density}
                    visuallyCompact
                    onChange={(value) => onLayerChange(index, "density", value)}
                  />
                ) : (
                  <div className="hidden min-h-9 items-center text-xs text-muted-foreground sm:flex">
                    —
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

function BulkApplyField({
  value,
  unit,
  minimum,
  maximum,
  valid,
  buttonLabel,
  onChange,
  onApply,
}: {
  value: number;
  unit: string;
  minimum: number;
  maximum?: number;
  valid: boolean;
  buttonLabel: string;
  onChange: (value: string) => void;
  onApply: () => void;
}) {
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-[11px] font-medium">
        <span>{buttonLabel.replace("Set all ", "All ")}</span>
        <span className="relative">
          <input
            aria-invalid={!valid}
            className={`${inputClass} pr-9`}
            max={maximum}
            min={minimum}
            step="any"
            type="number"
            value={Number.isFinite(value) ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] font-normal text-muted-foreground">
            {unit}
          </span>
        </span>
      </label>
      <Button
        className="w-full"
        disabled={!valid}
        size="sm"
        type="button"
        variant="outline"
        onClick={onApply}
      >
        <WandSparkles />
        {buttonLabel}
      </Button>
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
  visuallyCompact = false,
  onChange,
}: {
  label: string;
  value: number;
  error?: string;
  minimum?: number;
  maximum?: number;
  step?: number | "any";
  unit?: string | null;
  visuallyCompact?: boolean;
  onChange: (value: string) => void;
}) {
  const errorId = React.useId();
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium">
      <span className={visuallyCompact ? "sr-only" : undefined}>{label}</span>
      <span className="relative">
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          aria-label={visuallyCompact ? label : undefined}
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

function DramSaveDialog({
  metadata,
  error,
  saving,
  onChange,
  onClose,
  onSubmit,
}: {
  metadata: SaveMetadata;
  error: string | null;
  saving: boolean;
  onChange: (patch: Partial<SaveMetadata>) => void;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const savingRef = React.useRef(saving);
  const valid = metadataIsValid(metadata);

  React.useEffect(() => {
    onCloseRef.current = onClose;
    savingRef.current = saving;
  }, [onClose, saving]);

  React.useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      previousFocus.current?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/45"
        onClick={saving ? undefined : onClose}
      />
      <form
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
        role="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !saving) void onSubmit();
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Save className="h-5 w-5 text-primary" />
              <h2 id={titleId} className="text-lg font-semibold">
                Save DRAM Geometry
              </h2>
            </div>
            <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
              Add catalog metadata before saving this immutable geometry snapshot.
            </p>
          </div>
          <Button
            aria-label="Close save dialog"
            disabled={saving}
            size="icon"
            title="Close"
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              <span>Name</span>
              <input
                autoFocus
                className={inputClass}
                disabled={saving}
                required
                value={metadata.name}
                onChange={(event) => onChange({ name: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              <span>Version</span>
              <input
                className={inputClass}
                disabled={saving}
                required
                value={metadata.version}
                onChange={(event) => onChange({ version: event.target.value })}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
              <span>Owner</span>
              <input
                className={inputClass}
                disabled={saving}
                required
                value={metadata.owner}
                onChange={(event) => onChange({ owner: event.target.value })}
              />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            <span>Description</span>
            <textarea
              className={textareaClass}
              disabled={saving}
              value={metadata.description}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </label>

          <div className="grid gap-2 rounded-md border bg-muted/20 px-3 py-3 text-xs sm:grid-cols-3">
            <MetadataConstant label="Entity type" value="die" />
            <MetadataConstant label="Category" value="die.dram" />
            <MetadataConstant label="Icon" value="die.stack" />
          </div>

          {error ? (
            <p
              aria-live="polite"
              className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t bg-white px-5 py-3">
          <Button disabled={saving} type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || saving} type="submit">
            {saving ? <Loader2 className="animate-spin" /> : <Database />}
            Save to DB
          </Button>
        </footer>
      </form>
    </div>
  );
}

function MetadataConstant({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-foreground">{value}</div>
    </div>
  );
}

function metadataIsValid(metadata: SaveMetadata) {
  return Boolean(
    metadata.name.trim() && metadata.version.trim() && metadata.owner.trim(),
  );
}
