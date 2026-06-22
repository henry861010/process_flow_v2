"use client";

import * as React from "react";
import {
  ChevronDown,
  Download,
  Eye,
  FileJson,
  FlipHorizontal2,
  Loader2,
  Scissors,
  X,
} from "lucide-react";

import {
  requestGeometryPreview,
  requestGeometryPreviewStep,
  type GeometryEntityDownload,
  type GeometryPreviewRequest,
} from "@/components/geometry-preview/geometry-preview-client";
import {
  GeometryFeatureOverlay,
  extractPreviewFeatures,
  formatDensityPercent,
  formatFeatureKind,
  summarizeFeatures,
  type FeatureOverlayMode,
  type FeatureOverlaySettings,
  type PreviewFeature,
} from "@/components/geometry-preview/geometry-feature-overlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DEMO_BOUNDS,
  disposeModel,
  formatLength,
  formatNumber,
  loadCadBlob,
  type BoundsTuple,
  type LoadedCadModel,
} from "@/components/viewer/model-loader";
import {
  type CameraViewMode,
  type SectionPlaneMode,
  ViewerScene,
} from "@/components/viewer/viewer-scene";
import { cn } from "@/lib/utils";

export type GeometryPreviewContext = {
  previewId: string;
  sourceLabel: string;
  slotLabel: string;
  sourceKind: "geometryRef" | "stepOutput";
  request: GeometryPreviewRequest;
};

type PanelState =
  | { status: "loading" }
  | {
      status: "ready";
      geometryEntityJson: GeometryEntityDownload;
      glbBlob: Blob;
    }
  | { status: "error"; message: string };

type StepExportRequest = {
  controller: AbortController;
  promise: Promise<Blob>;
};

const DEFAULT_FEATURE_DENSITY_SCALE = 0.4;
const DEFAULT_FEATURE_GLYPH_SIZE_SCALE = 1;
const DEFAULT_FEATURE_OPACITY = 0.6;
const DEFAULT_FEATURE_MAX_INSTANCES = 10000;

export function GeometryPreviewPanel({
  preview,
  onClose,
}: {
  preview: GeometryPreviewContext;
  onClose: () => void;
}) {
  const [state, setState] = React.useState<PanelState>({ status: "loading" });
  const [stepError, setStepError] = React.useState<string | null>(null);
  const stepExportRef = React.useRef<StepExportRequest | null>(null);
  const stepBlobRef = React.useRef<Blob | null>(null);
  const stepDownloadInFlightRef = React.useRef(false);
  const mountedRef = React.useRef(true);

  const abortStepExport = React.useCallback(() => {
    const current = stepExportRef.current;
    if (!current) return;
    current.controller.abort();
    stepExportRef.current = null;
  }, []);

  const startStepExport = React.useCallback((geometryStructure: unknown) => {
    if (stepBlobRef.current) {
      return Promise.resolve(stepBlobRef.current);
    }

    const current = stepExportRef.current;
    if (current) return current.promise;

    const controller = new AbortController();
    const requestState: StepExportRequest = {
      controller,
      promise: Promise.resolve(new Blob()),
    };
    const promise = requestGeometryPreviewStep(
      { geometryStructure },
      controller.signal,
    )
      .then((response) => {
        const stepBlob = base64ToBlob(response.stepBase64, "application/step");
        stepBlobRef.current = stepBlob;
        return stepBlob;
      })
      .catch((error) => {
        if (stepExportRef.current === requestState) {
          stepExportRef.current = null;
        }
        throw error;
      });

    requestState.promise = promise;
    stepExportRef.current = requestState;
    return promise;
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  React.useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortStepExport();
    };
  }, [abortStepExport]);

  React.useEffect(() => {
    const controller = new AbortController();
    abortStepExport();
    stepBlobRef.current = null;
    setStepError(null);
    setState({ status: "loading" });

    requestGeometryPreview(preview.request, controller.signal)
      .then((response) => {
        setState({
          status: "ready",
          geometryEntityJson: response.geometryEntityJson,
          glbBlob: base64ToBlob(response.glbBase64, "model/gltf-binary"),
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to generate geometry preview.",
        });
      });

    return () => {
      controller.abort();
      abortStepExport();
    };
  }, [abortStepExport, preview]);

  React.useEffect(() => {
    if (state.status !== "ready") return;
    const promise = startStepExport(state.geometryEntityJson.structure);
    void promise.catch(() => undefined);
  }, [startStepExport, state]);

  const ready = state.status === "ready";

  function saveJson() {
    if (state.status !== "ready") return;
    downloadBlob(
      new Blob([JSON.stringify(state.geometryEntityJson, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      `geometry-preview-${preview.previewId}.json`,
    );
  }

  function saveGlb() {
    if (state.status !== "ready") return;
    downloadBlob(state.glbBlob, `geometry-preview-${preview.previewId}.glb`);
  }

  async function saveStep() {
    if (state.status !== "ready") return;
    if (stepDownloadInFlightRef.current) return;

    if (stepBlobRef.current) {
      downloadBlob(stepBlobRef.current, `geometry-preview-${preview.previewId}.step`);
      return;
    }

    stepDownloadInFlightRef.current = true;
    setStepError(null);
    try {
      const stepBlob = await startStepExport(state.geometryEntityJson.structure);
      if (!mountedRef.current) return;
      downloadBlob(stepBlob, `geometry-preview-${preview.previewId}.step`);
    } catch (error) {
      if (!mountedRef.current || isAbortError(error)) return;
      setStepError(
        error instanceof Error
          ? error.message
          : "Unable to generate STEP export.",
      );
    } finally {
      stepDownloadInFlightRef.current = false;
    }
  }

  return (
    <div className="fixed inset-0 z-50 p-3 sm:p-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 cursor-default bg-foreground/45"
        onClick={onClose}
      />
      <section
        className="relative z-10 flex h-full flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b bg-white px-4 py-3 md:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">Geometry Preview</h2>
              <Badge variant={state.status === "error" ? "outline" : "signal"}>
                {state.status === "loading"
                  ? "Loading"
                  : state.status === "ready"
                    ? "Ready"
                    : "Error"}
              </Badge>
              <Badge variant="secondary">
                {preview.sourceKind === "geometryRef"
                  ? "Initial geometry"
                  : "Step output"}
              </Badge>
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {preview.sourceLabel} {"->"} {preview.slotLabel}
            </div>
          </div>
          <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1">
          {state.status === "loading" ? (
            <PreviewMessage icon={<Loader2 className="animate-spin" />}>
              Generating geometry preview...
            </PreviewMessage>
          ) : state.status === "error" ? (
            <PreviewMessage icon={<Scissors />}>{state.message}</PreviewMessage>
          ) : (
            <PreviewCadWorkbench
              glbBlob={state.glbBlob}
              fileName={`geometry-preview-${preview.previewId}.glb`}
              geometryStructure={state.geometryEntityJson.structure}
            />
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-white px-4 py-3">
          {stepError ? (
            <span className="mr-auto min-w-0 flex-1 truncate text-sm text-destructive">
              {stepError}
            </span>
          ) : null}
          <Button variant="outline" disabled={!ready} onClick={saveJson}>
            <FileJson />
            Save JSON
          </Button>
          <Button variant="outline" disabled={!ready} onClick={saveGlb}>
            <Download />
            Save GLB
          </Button>
          <Button disabled={!ready} onClick={saveStep}>
            <Download />
            Save STEP AP242
          </Button>
        </footer>
      </section>
    </div>
  );
}

function PreviewCadWorkbench({
  glbBlob,
  fileName,
  geometryStructure,
}: {
  glbBlob: Blob;
  fileName: string;
  geometryStructure: unknown;
}) {
  const activeModelRef = React.useRef<LoadedCadModel | null>(null);
  const [model, setModel] = React.useState<LoadedCadModel | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [sectionEnabled, setSectionEnabled] = React.useState(false);
  const [sectionSettingsExpanded, setSectionSettingsExpanded] =
    React.useState(false);
  const [sectionPlane, setSectionPlane] =
    React.useState<SectionPlaneMode>("xz");
  const [sectionPosition, setSectionPosition] = React.useState(0);
  const [sectionFlip, setSectionFlip] = React.useState(false);
  const [cameraResetKey, setCameraResetKey] = React.useState(0);
  const [cameraView, setCameraView] = React.useState<CameraViewMode>("iso");
  const [featureOverlayEnabled, setFeatureOverlayEnabled] =
    React.useState(true);
  const [featureSettingsExpanded, setFeatureSettingsExpanded] =
    React.useState(false);
  const [showBumps, setShowBumps] = React.useState(true);
  const [showVias, setShowVias] = React.useState(true);
  const [showCircuits, setShowCircuits] = React.useState(true);
  const [featureMode, setFeatureMode] =
    React.useState<FeatureOverlayMode>("auto");
  const [featureDensityScale, setFeatureDensityScale] = React.useState(
    DEFAULT_FEATURE_DENSITY_SCALE,
  );
  const [featureGlyphSizeScale, setFeatureGlyphSizeScale] = React.useState(
    DEFAULT_FEATURE_GLYPH_SIZE_SCALE,
  );
  const [featureOpacity, setFeatureOpacity] = React.useState(
    DEFAULT_FEATURE_OPACITY,
  );
  const [featureMaxInstances, setFeatureMaxInstances] = React.useState(
    DEFAULT_FEATURE_MAX_INSTANCES,
  );
  const [selectedFeatureId, setSelectedFeatureId] = React.useState<string | null>(
    null,
  );
  const [hoveredFeatureId, setHoveredFeatureId] = React.useState<string | null>(
    null,
  );

  const modelBounds = model?.stats.bounds ?? DEMO_BOUNDS;
  const modelKey = model?.id ?? "loading";
  const features = React.useMemo(
    () => extractPreviewFeatures(geometryStructure),
    [geometryStructure],
  );
  const bounds = React.useMemo(
    () => mergeFeatureBounds(modelBounds, features),
    [features, modelBounds],
  );
  const range = getSectionRange(bounds, sectionPlane);
  const rangeStep = Math.max((range.max - range.min) / 400, 0.001);
  const featureSummary = React.useMemo(
    () => summarizeFeatures(features),
    [features],
  );
  const selectedFeature = React.useMemo(
    () => featureById(features, selectedFeatureId),
    [features, selectedFeatureId],
  );
  const featureSettings = React.useMemo<FeatureOverlaySettings>(
    () => ({
      enabled: featureOverlayEnabled,
      showBumps,
      showVias,
      showCircuits,
      mode: featureMode,
      densityScale: featureDensityScale,
      glyphSizeScale: featureGlyphSizeScale,
      opacity: featureOpacity,
      maxInstances: featureMaxInstances,
    }),
    [
      featureDensityScale,
      featureGlyphSizeScale,
      featureMaxInstances,
      featureMode,
      featureOpacity,
      featureOverlayEnabled,
      showBumps,
      showCircuits,
      showVias,
    ],
  );

  React.useEffect(() => {
    let disposed = false;
    setLoadError(null);
    loadCadBlob(glbBlob, {
      fileName,
      fileKind: "glb",
      fileSize: glbBlob.size,
      id: `${fileName}-${glbBlob.size}-${Date.now()}`,
    })
      .then((loaded) => {
        if (disposed) {
          disposeModel(loaded.object);
          return;
        }
        setModel((current) => {
          if (current) disposeModel(current.object);
          return loaded;
        });
        setCameraResetKey((value) => value + 1);
      })
      .catch((error) => {
        if (!disposed) {
          setLoadError(
            error instanceof Error ? error.message : "Unable to load preview GLB.",
          );
        }
      });

    return () => {
      disposed = true;
    };
  }, [fileName, glbBlob]);

  React.useEffect(() => {
    activeModelRef.current = model;
  }, [model]);

  React.useEffect(() => {
    return () => {
      if (activeModelRef.current) {
        disposeModel(activeModelRef.current.object);
      }
    };
  }, []);

  React.useEffect(() => {
    setSectionPosition(getSectionCenter(bounds, sectionPlane));
  }, [bounds, modelKey, sectionPlane]);

  React.useEffect(() => {
    if (selectedFeatureId && !features.some((feature) => feature.id === selectedFeatureId)) {
      setSelectedFeatureId(null);
    }
  }, [features, selectedFeatureId]);

  function moveCameraTo(view: CameraViewMode) {
    setCameraView(view);
    setCameraResetKey((value) => value + 1);
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="relative min-h-[420px] overflow-hidden bg-[#f5f8f9] p-3">
        <div className="viewer-surface relative h-full min-h-[400px] overflow-hidden rounded-md border shadow-viewport">
          <ViewerScene
            model={model}
            bounds={bounds}
            sectionEnabled={sectionEnabled}
            sectionPlane={sectionPlane}
            sectionPosition={sectionPosition}
            sectionFlip={sectionFlip}
            showGrid
            showAxes
            cameraResetKey={cameraResetKey}
            cameraView={cameraView}
          >
            <GeometryFeatureOverlay
              features={features}
              bounds={bounds}
              settings={featureSettings}
              selectedFeatureId={selectedFeatureId}
              hoveredFeatureId={hoveredFeatureId}
              interactive
              onSelectFeature={setSelectedFeatureId}
              onHoverFeature={setHoveredFeatureId}
            />
          </ViewerScene>

          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
            <Badge variant="signal" className="gap-1">
              <Scissors className="h-3.5 w-3.5" />
              {sectionEnabled ? sectionPlane.toUpperCase() : "Full"}
            </Badge>
            {featureSummary.total > 0 && featureOverlayEnabled ? (
              <Badge variant="secondary">
                {formatNumber(featureSummary.total)} features
              </Badge>
            ) : null}
          </div>

          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white/86 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            <span>
              Bounds {formatLength(bounds.size[0])} x {formatLength(bounds.size[1])}{" "}
              x {formatLength(bounds.size[2])}
            </span>
          </div>
        </div>
      </section>

      <aside className="min-h-0 overflow-y-auto border-t bg-white/92 p-4 lg:border-l lg:border-t-0">
        <div className="space-y-4">
          <SettingsPanelBlock
            icon={<Eye />}
            title="Axis view"
            summary={formatAxisView(cameraView)}
          >
            <div className="grid grid-cols-4 gap-2">
              {(["iso", "x", "y", "z"] as CameraViewMode[]).map((view) => (
                <Button
                  key={view}
                  type="button"
                  variant={cameraView === view ? "default" : "outline"}
                  size="sm"
                  title={view === "iso" ? "Isometric view" : `View from +${view.toUpperCase()}`}
                  onClick={() => moveCameraTo(view)}
                >
                  {view === "iso" ? "ISO" : view.toUpperCase()}
                </Button>
              ))}
            </div>
          </SettingsPanelBlock>

          <ExpandableSettingsBlock
            icon={<Scissors />}
            title="Section"
            summary={formatSectionSummary({
              enabled: sectionEnabled,
              plane: sectionPlane,
              position: sectionPosition,
            })}
            expanded={sectionSettingsExpanded}
            active={sectionEnabled}
            onExpandedChange={setSectionSettingsExpanded}
          >
            <ControlRow label="Enabled">
              <Switch
                checked={sectionEnabled}
                onCheckedChange={setSectionEnabled}
                aria-label="Toggle section"
              />
            </ControlRow>
            <div className="space-y-2">
              <Label>Plane</Label>
              <Tabs
                value={sectionPlane}
                onValueChange={(value) =>
                  setSectionPlane(value as SectionPlaneMode)
                }
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="xz">XZ</TabsTrigger>
                  <TabsTrigger value="yz">YZ</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Position</Label>
                <span className="rounded bg-muted px-2 py-1 font-mono text-xs">
                  {formatLength(sectionPosition)}
                </span>
              </div>
              <Slider
                value={[clamp(sectionPosition, range.min, range.max)]}
                min={range.min}
                max={range.max}
                step={rangeStep}
                disabled={!sectionEnabled}
                onValueChange={([value]) => setSectionPosition(value)}
              />
              <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
                <span>{formatLength(range.min)}</span>
                <span>{formatLength(range.max)}</span>
              </div>
            </div>
            <ControlRow label="Flip side">
              <Button
                type="button"
                variant={sectionFlip ? "default" : "outline"}
                size="icon-sm"
                title="Flip clipped side"
                onClick={() => setSectionFlip((value) => !value)}
                disabled={!sectionEnabled}
              >
                <FlipHorizontal2 />
              </Button>
            </ControlRow>
          </ExpandableSettingsBlock>

          <ExpandableSettingsBlock
            icon={<Eye />}
            title="Bump/Via/Circuit View Setting"
            summary={formatFeatureSummaryLine(featureSummary)}
            expanded={featureSettingsExpanded}
            active={featureOverlayEnabled && featureSummary.total > 0}
            onExpandedChange={setFeatureSettingsExpanded}
          >
            <ControlRow label="Enabled">
              <Switch
                checked={featureOverlayEnabled}
                disabled={featureSummary.total === 0}
                onCheckedChange={setFeatureOverlayEnabled}
                aria-label="Toggle Bump/Via/Circuit view"
              />
            </ControlRow>
            <ControlRow label="Bumps">
              <Switch
                checked={showBumps}
                disabled={!featureOverlayEnabled || featureSummary.bumps === 0}
                onCheckedChange={setShowBumps}
                aria-label="Toggle bumps"
              />
            </ControlRow>
            <ControlRow label="Vias">
              <Switch
                checked={showVias}
                disabled={!featureOverlayEnabled || featureSummary.vias === 0}
                onCheckedChange={setShowVias}
                aria-label="Toggle vias"
              />
            </ControlRow>
            <ControlRow label="Circuits">
              <Switch
                checked={showCircuits}
                disabled={!featureOverlayEnabled || featureSummary.circuits === 0}
                onCheckedChange={setShowCircuits}
                aria-label="Toggle circuits"
              />
            </ControlRow>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Tabs
                value={featureMode}
                onValueChange={(value) =>
                  setFeatureMode(value as FeatureOverlayMode)
                }
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="auto" disabled={!featureOverlayEnabled}>
                    Auto
                  </TabsTrigger>
                  <TabsTrigger value="summary" disabled={!featureOverlayEnabled}>
                    Summary
                  </TabsTrigger>
                  <TabsTrigger value="detail" disabled={!featureOverlayEnabled}>
                    Detail
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <SliderControl
              label="Density scale"
              value={featureDensityScale}
              display={`${featureDensityScale.toFixed(2)}x`}
              min={0.25}
              max={2}
              step={0.05}
              disabled={!featureOverlayEnabled}
              onChange={setFeatureDensityScale}
            />
            <SliderControl
              label="Glyph size"
              value={featureGlyphSizeScale}
              display={`${featureGlyphSizeScale.toFixed(2)}x`}
              min={0.5}
              max={3}
              step={0.05}
              disabled={!featureOverlayEnabled}
              onChange={setFeatureGlyphSizeScale}
            />
            <SliderControl
              label="Opacity"
              value={featureOpacity}
              display={`${Math.round(featureOpacity * 100)}%`}
              min={0.15}
              max={0.85}
              step={0.01}
              disabled={!featureOverlayEnabled}
              onChange={setFeatureOpacity}
            />
            <div className="space-y-2">
              <Label>Max instances</Label>
              <div className="grid grid-cols-3 gap-2">
                {[500, 2000, 10000].map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={featureMaxInstances === value ? "default" : "outline"}
                    size="sm"
                    disabled={!featureOverlayEnabled}
                    onClick={() => setFeatureMaxInstances(value)}
                  >
                    {formatNumber(value)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="border-t pt-3">
              <InfoTable
                rows={[
                  ["Total", formatNumber(featureSummary.total)],
                  ["Bumps", formatNumber(featureSummary.bumps)],
                  ["Vias", formatNumber(featureSummary.vias)],
                  ["Circuits", formatNumber(featureSummary.circuits)],
                  [
                    "Density",
                    formatDensityRange(
                      featureSummary.densityMin,
                      featureSummary.densityMax,
                    ),
                  ],
                ]}
              />
            </div>
            <div className="border-t pt-3">
              {selectedFeature ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium">
                      {formatFeatureKind(selectedFeature.type)}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedFeatureId(null)}
                    >
                      Clear
                    </Button>
                  </div>
                  <InfoTable
                    rows={[
                      ["Material", selectedFeature.material],
                      [
                        "Density",
                        `${formatDensityPercent(selectedFeature.density)} (${formatRawDensity(
                          selectedFeature.density,
                        )})`,
                      ],
                      ["Direction", selectedFeature.direction ?? "n/a"],
                      ["Container", selectedFeature.containerPath],
                      ["Bounds", formatFeatureBounds(selectedFeature)],
                    ]}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {featureSummary.total === 0
                    ? "No density features"
                    : "Select a feature envelope"}
                </p>
              )}
            </div>
          </ExpandableSettingsBlock>
          {loadError ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {loadError}
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function PreviewMessage({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground [&_svg]:h-6 [&_svg]:w-6 [&_svg]:text-primary">
        {icon}
        <div>{children}</div>
      </div>
    </div>
  );
}

function SettingsPanelBlock({
  icon,
  title,
  summary,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border-2 border-emerald-500 bg-white shadow-sm">
      <div className="flex items-center gap-3 bg-muted/40 px-3 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-primary text-primary-foreground shadow-sm [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {summary}
          </span>
        </span>
      </div>
      <div className="px-3 py-3">{children}</div>
    </div>
  );
}

function ExpandableSettingsBlock({
  icon,
  title,
  summary,
  expanded,
  active,
  onExpandedChange,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  expanded: boolean;
  active: boolean;
  onExpandedChange: (expanded: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border-2 bg-white shadow-sm transition",
        active ? "border-emerald-500" : "border-amber-500",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 bg-muted/40 px-3 py-3 text-left transition hover:bg-muted/60"
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white text-white shadow-sm [&_svg]:h-4 [&_svg]:w-4",
            active ? "bg-emerald-500" : "bg-amber-500",
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {summary}
          </span>
        </span>
        <Badge variant={active ? "signal" : "secondary"}>
          {active ? "On" : "Off"}
        </Badge>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition",
            !expanded && "-rotate-90",
          )}
        />
      </button>
      {expanded ? (
        <div className="space-y-4 border-t px-3 py-3">{children}</div>
      ) : null}
    </div>
  );
}

function ControlRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function SliderControl({
  label,
  value,
  display,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        <span className="rounded bg-muted px-2 py-1 font-mono text-xs">
          {display}
        </span>
      </div>
      <Slider
        value={[clamp(value, min, max)]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([nextValue]) => onChange(nextValue)}
      />
    </div>
  );
}

function InfoTable({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[minmax(92px,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate text-right font-mono text-xs text-foreground">
            {value}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function getSectionRange(bounds: BoundsTuple, plane: SectionPlaneMode) {
  const index = plane === "xz" ? 1 : 0;
  const min = bounds.min[index];
  const max = bounds.max[index];
  if (min === max) {
    return { min: min - 1, max: max + 1 };
  }
  return { min, max };
}

function getSectionCenter(bounds: BoundsTuple, plane: SectionPlaneMode) {
  return plane === "xz" ? bounds.center[1] : bounds.center[0];
}

function formatAxisView(view: CameraViewMode) {
  if (view === "iso") return "Isometric";
  return `View from +${view.toUpperCase()}`;
}

function formatSectionSummary({
  enabled,
  plane,
  position,
}: {
  enabled: boolean;
  plane: SectionPlaneMode;
  position: number;
}) {
  return `${enabled ? "Enabled" : "Disabled"} · ${plane.toUpperCase()} · ${formatLength(
    position,
  )}`;
}

function formatFeatureSummaryLine(summary: {
  total: number;
  bumps: number;
  vias: number;
  circuits: number;
}) {
  if (summary.total === 0) return "No density features";
  return `${formatNumber(summary.total)} total · B ${formatNumber(
    summary.bumps,
  )} · V ${formatNumber(summary.vias)} · C ${formatNumber(summary.circuits)}`;
}

function mergeFeatureBounds(baseBounds: BoundsTuple, features: PreviewFeature[]) {
  if (features.length === 0) return baseBounds;

  const min: [number, number, number] = [...baseBounds.min];
  const max: [number, number, number] = [...baseBounds.max];
  features.forEach((feature) => {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], feature.bounds.min[axis]);
      max[axis] = Math.max(max[axis], feature.bounds.max[axis]);
    }
  });

  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const size: [number, number, number] = [
    Math.max(max[0] - min[0], 0),
    Math.max(max[1] - min[1], 0),
    Math.max(max[2] - min[2], 0),
  ];

  return { min, max, center, size };
}

function featureById(features: PreviewFeature[], featureId: string | null) {
  if (!featureId) return null;
  return features.find((feature) => feature.id === featureId) ?? null;
}

function formatDensityRange(min: number | null, max: number | null) {
  if (min === null || max === null) return "n/a";
  if (min === max) return formatDensityPercent(min);
  return `${formatDensityPercent(min)} .. ${formatDensityPercent(max)}`;
}

function formatRawDensity(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(3);
}

function formatFeatureBounds(feature: PreviewFeature) {
  const { size } = feature.bounds;
  return `${formatLength(size[0])} x ${formatLength(size[1])} x ${formatLength(
    size[2],
  )}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
