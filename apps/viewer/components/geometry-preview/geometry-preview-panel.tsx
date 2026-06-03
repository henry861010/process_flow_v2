"use client";

import * as React from "react";
import {
  Download,
  Eye,
  FileJson,
  FlipHorizontal2,
  Loader2,
  Maximize2,
  Ruler,
  Scissors,
  Trash2,
  X,
} from "lucide-react";

import {
  requestGeometryPreview,
  type GeometryEntityDownload,
  type GeometryPreviewRequest,
} from "@/components/geometry-preview/geometry-preview-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
  type Measurement,
  type MeasurePoint,
  type SectionPlaneMode,
  ViewerScene,
} from "@/components/viewer/viewer-scene";

export type GeometryPreviewContext = {
  edgeId: string;
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

export function GeometryPreviewPanel({
  preview,
  onClose,
}: {
  preview: GeometryPreviewContext;
  onClose: () => void;
}) {
  const [state, setState] = React.useState<PanelState>({ status: "loading" });

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
    const controller = new AbortController();
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

    return () => controller.abort();
  }, [preview]);

  const ready = state.status === "ready";

  function saveJson() {
    if (state.status !== "ready") return;
    downloadBlob(
      new Blob([JSON.stringify(state.geometryEntityJson, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
      `geometry-preview-${preview.edgeId}.json`,
    );
  }

  function saveGlb() {
    if (state.status !== "ready") return;
    downloadBlob(state.glbBlob, `geometry-preview-${preview.edgeId}.glb`);
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
              fileName={`geometry-preview-${preview.edgeId}.glb`}
            />
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-white px-4 py-3">
          <Button variant="outline" disabled={!ready} onClick={saveJson}>
            <FileJson />
            Save JSON
          </Button>
          <Button disabled={!ready} onClick={saveGlb}>
            <Download />
            Save GLB
          </Button>
        </footer>
      </section>
    </div>
  );
}

function PreviewCadWorkbench({
  glbBlob,
  fileName,
}: {
  glbBlob: Blob;
  fileName: string;
}) {
  const activeModelRef = React.useRef<LoadedCadModel | null>(null);
  const [model, setModel] = React.useState<LoadedCadModel | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [sectionEnabled, setSectionEnabled] = React.useState(true);
  const [sectionPlane, setSectionPlane] =
    React.useState<SectionPlaneMode>("xz");
  const [sectionPosition, setSectionPosition] = React.useState(0);
  const [sectionFlip, setSectionFlip] = React.useState(false);
  const [showGrid, setShowGrid] = React.useState(true);
  const [showAxes, setShowAxes] = React.useState(true);
  const [cameraResetKey, setCameraResetKey] = React.useState(0);
  const [cameraView, setCameraView] = React.useState<CameraViewMode>("iso");
  const [measureEnabled, setMeasureEnabled] = React.useState(false);
  const [pendingMeasurePoint, setPendingMeasurePoint] =
    React.useState<MeasurePoint | null>(null);
  const [measurement, setMeasurement] = React.useState<Measurement | null>(null);

  const bounds = model?.stats.bounds ?? DEMO_BOUNDS;
  const range = getSectionRange(bounds, sectionPlane);
  const rangeStep = Math.max((range.max - range.min) / 400, 0.001);
  const modelKey = model?.id ?? "loading";

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
    setPendingMeasurePoint(null);
    setMeasurement(null);
  }, [modelKey]);

  function handleMeasurePoint(point: MeasurePoint) {
    setPendingMeasurePoint((current) => {
      if (!current || measurement) {
        setMeasurement(null);
        return point;
      }
      setMeasurement(createMeasurement(current, point));
      return null;
    });
  }

  function clearMeasurement() {
    setPendingMeasurePoint(null);
    setMeasurement(null);
  }

  function moveCameraTo(view: CameraViewMode) {
    setCameraView(view);
    setCameraResetKey((value) => value + 1);
  }

  const stats = model?.stats;

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
            showGrid={showGrid}
            showAxes={showAxes}
            cameraResetKey={cameraResetKey}
            cameraView={cameraView}
            measureEnabled={measureEnabled}
            pendingMeasurePoint={pendingMeasurePoint}
            measurement={measurement}
            onMeasurePoint={handleMeasurePoint}
          />

          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
            <Badge variant="signal" className="gap-1">
              <Scissors className="h-3.5 w-3.5" />
              {sectionEnabled ? sectionPlane.toUpperCase() : "Full"}
            </Badge>
            {measureEnabled ? (
              <Badge variant="secondary" className="gap-1">
                <Ruler className="h-3.5 w-3.5" />
                {pendingMeasurePoint ? "Pick end" : "Measure"}
              </Badge>
            ) : null}
          </div>

          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white/86 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
            <span>
              Bounds {formatLength(bounds.size[0])} x {formatLength(bounds.size[1])}{" "}
              x {formatLength(bounds.size[2])}
            </span>
            <span>
              {formatNumber(stats?.meshCount ?? 0)} meshes /{" "}
              {formatNumber(stats?.triangleCount ?? 0)} triangles
            </span>
          </div>
        </div>
      </section>

      <aside className="min-h-0 overflow-y-auto border-t bg-white/92 p-4 lg:border-l lg:border-t-0">
        <div className="space-y-5">
          <PanelHeader icon={<Scissors />} title="Section" />
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
              onValueChange={(value) => setSectionPlane(value as SectionPlaneMode)}
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

          <Separator />

          <PanelHeader icon={<Ruler />} title="Measure" />
          <ControlRow label="Enabled">
            <Switch
              checked={measureEnabled}
              onCheckedChange={(checked) => {
                setMeasureEnabled(checked);
                clearMeasurement();
              }}
              aria-label="Toggle measurement"
            />
          </ControlRow>
          <div className="rounded-md border bg-muted/25 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Distance</p>
                <p className="mt-1 break-words font-mono text-xs text-foreground">
                  {!measureEnabled
                    ? "Enable measurement"
                    : measurement
                      ? formatMeasurement(measurement)
                      : pendingMeasurePoint
                        ? "Pick second surface point"
                        : "Pick two surface points"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                title="Clear measurement"
                onClick={clearMeasurement}
                disabled={!pendingMeasurePoint && !measurement}
              >
                <Trash2 />
              </Button>
            </div>
          </div>

          <Separator />

          <PanelHeader icon={<Eye />} title="View" />
          <ControlRow label="Grid">
            <Switch
              checked={showGrid}
              onCheckedChange={setShowGrid}
              aria-label="Toggle grid"
            />
          </ControlRow>
          <ControlRow label="Axes">
            <Switch
              checked={showAxes}
              onCheckedChange={setShowAxes}
              aria-label="Toggle axes"
            />
          </ControlRow>
          <ControlRow label="Camera">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title="Fit camera"
              onClick={() => moveCameraTo("iso")}
            >
              <Maximize2 />
            </Button>
          </ControlRow>
          <ControlRow label="Axis view">
            <Button
              type="button"
              variant={cameraView === "x" ? "default" : "outline"}
              size="icon-sm"
              title="View from +X"
              onClick={() => moveCameraTo("x")}
            >
              X
            </Button>
            <Button
              type="button"
              variant={cameraView === "y" ? "default" : "outline"}
              size="icon-sm"
              title="View from +Y"
              onClick={() => moveCameraTo("y")}
            >
              Y
            </Button>
            <Button
              type="button"
              variant={cameraView === "z" ? "default" : "outline"}
              size="icon-sm"
              title="View from +Z"
              onClick={() => moveCameraTo("z")}
            >
              Z
            </Button>
          </ControlRow>

          <Separator />

          <PanelHeader icon={<FileJson />} title="Model" />
          <div className="rounded-md border bg-muted/25 p-3">
            <p className="truncate text-sm font-medium">{fileName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Generated preview / {formatNumber(glbBlob.size)} bytes
            </p>
            {loadError ? (
              <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                {loadError}
              </p>
            ) : null}
          </div>

          <InfoTable
            rows={[
              ["Meshes", formatNumber(stats?.meshCount ?? 0)],
              ["Materials", formatNumber(stats?.materialCount ?? 0)],
              ["Vertices", formatNumber(stats?.vertexCount ?? 0)],
              ["Triangles", formatNumber(stats?.triangleCount ?? 0)],
              ["X", formatSpan(bounds.min[0], bounds.max[0])],
              ["Y", formatSpan(bounds.min[1], bounds.max[1])],
              ["Z", formatSpan(bounds.min[2], bounds.max[2])],
            ]}
          />
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

function PanelHeader({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <span className="[&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-primary">
        {icon}
      </span>
      <span>{title}</span>
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

function createMeasurement(
  start: MeasurePoint,
  end: MeasurePoint,
): Measurement {
  const delta: [number, number, number] = [
    end.position[0] - start.position[0],
    end.position[1] - start.position[1],
    end.position[2] - start.position[2],
  ];
  const distance = Math.hypot(delta[0], delta[1], delta[2]);

  return {
    start,
    end,
    delta,
    distance,
  };
}

function formatMeasurement(measurement: Measurement) {
  const [dx, dy, dz] = measurement.delta;
  return `${formatLength(measurement.distance)} um (${formatSignedLength(
    dx,
  )}, ${formatSignedLength(dy)}, ${formatSignedLength(dz)})`;
}

function formatSignedLength(value: number) {
  if (Object.is(value, -0)) return "0";
  return value > 0 ? `+${formatLength(value)}` : formatLength(value);
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

function formatSpan(min: number, max: number) {
  return `${formatLength(min)} .. ${formatLength(max)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
  URL.revokeObjectURL(url);
}
