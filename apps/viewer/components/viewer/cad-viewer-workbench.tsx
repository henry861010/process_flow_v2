"use client";

import * as React from "react";
import {
  Box,
  Eye,
  FileUp,
  FlipHorizontal2,
  Layers3,
  Maximize2,
  Ruler,
  RotateCcw,
  Scissors,
  Trash2,
} from "lucide-react";

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
  formatFileSize,
  formatLength,
  formatNumber,
  loadCadFile,
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
import { cn } from "@/lib/utils";

const demoStats = {
  meshCount: 39,
  materialCount: 7,
  vertexCount: 12960,
  triangleCount: 6480,
};

export function CadViewerWorkbench() {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const activeModelRef = React.useRef<LoadedCadModel | null>(null);
  const [model, setModel] = React.useState<LoadedCadModel | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
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
  const [measurement, setMeasurement] = React.useState<Measurement | null>(
    null,
  );

  const bounds = model?.stats.bounds ?? DEMO_BOUNDS;
  const range = getSectionRange(bounds, sectionPlane);
  const rangeStep = Math.max((range.max - range.min) / 400, 0.001);
  const modelKey = model?.id ?? "demo";

  React.useEffect(() => {
    setSectionPosition(getSectionCenter(bounds, sectionPlane));
  }, [bounds, modelKey, sectionPlane]);

  React.useEffect(() => {
    setPendingMeasurePoint(null);
    setMeasurement(null);
  }, [modelKey]);

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

  async function openFile(file: File) {
    setLoadError(null);
    setIsLoading(true);

    try {
      const loaded = await loadCadFile(file);
      setModel((current) => {
        if (current) disposeModel(current.object);
        return loaded;
      });
      setCameraResetKey((value) => value + 1);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load CAD file.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void openFile(file);
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void openFile(file);
  }

  function resetToDemo() {
    setModel((current) => {
      if (current) disposeModel(current.object);
      return null;
    });
    setLoadError(null);
    setCameraResetKey((value) => value + 1);
  }

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

  const displayStats = model?.stats ?? {
    bounds: DEMO_BOUNDS,
    ...demoStats,
  };

  return (
    <main className="flex min-h-screen flex-col bg-[linear-gradient(180deg,#f5f8f9_0%,#e7eef1_100%)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-white/88 px-4 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Box className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold md:text-base">
              Process Flow CAD Viewer
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {model ? model.fileName : "Demo package"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="tool"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isLoading}
          >
            <FileUp />
            Import
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Reset to demo"
            onClick={resetToDemo}
          >
            <RotateCcw />
          </Button>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept=".stl,.glb,.gltf,model/stl,model/gltf-binary,model/gltf+json"
            onChange={handleInputChange}
          />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="relative min-h-[560px] overflow-hidden p-3 md:p-4">
          <div
            className={cn(
              "viewer-surface relative h-full min-h-[540px] overflow-hidden rounded-lg border shadow-viewport",
              isDragging && "border-primary ring-2 ring-primary/30",
            )}
            onDragEnter={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
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
              {isLoading ? <Badge variant="secondary">Loading</Badge> : null}
            </div>

            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white/86 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
              <span>
                Bounds {formatLength(displayStats.bounds.size[0])} x{" "}
                {formatLength(displayStats.bounds.size[1])} x{" "}
                {formatLength(displayStats.bounds.size[2])}
              </span>
              <span>
                {formatNumber(displayStats.meshCount)} meshes /{" "}
                {formatNumber(displayStats.triangleCount)} triangles
              </span>
            </div>
          </div>
        </section>

        <aside className="overflow-y-auto border-t bg-white/92 p-4 backdrop-blur lg:border-l lg:border-t-0">
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
                  <p className="text-xs font-medium text-muted-foreground">
                    Distance
                  </p>
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

            <PanelHeader icon={<Layers3 />} title="Model" />
            <div
              className={cn(
                "rounded-lg border border-dashed bg-muted/35 p-3 transition-colors",
                isDragging && "border-primary bg-primary/5",
              )}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {model ? model.fileName : "Demo package"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {model
                      ? `${model.fileKind.toUpperCase()} / ${formatFileSize(
                          model.fileSize,
                        )}`
                      : "Generated preview"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  title="Import CAD"
                  onClick={() => inputRef.current?.click()}
                  disabled={isLoading}
                >
                  <FileUp />
                </Button>
              </div>
              {loadError ? (
                <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                  {loadError}
                </p>
              ) : null}
            </div>

            <InfoTable
              rows={[
                ["Meshes", formatNumber(displayStats.meshCount)],
                ["Materials", formatNumber(displayStats.materialCount)],
                ["Vertices", formatNumber(displayStats.vertexCount)],
                ["Triangles", formatNumber(displayStats.triangleCount)],
                ["X", formatSpan(bounds.min[0], bounds.max[0])],
                ["Y", formatSpan(bounds.min[1], bounds.max[1])],
                ["Z", formatSpan(bounds.min[2], bounds.max[2])],
              ]}
            />
          </div>
        </aside>
      </div>
    </main>
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
