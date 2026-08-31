"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, CircleAlert, Plus, Trash2 } from "lucide-react";

import { GdsPlacementImport, type GdsTargetRegion } from "./gds-placement-import";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NumericDraft = number | "";
type PointDraft = [NumericDraft, NumericDraft];
type Anchor = "bottomLeft" | "center" | "origin";

type PlacementBase = {
  pose: { x: NumericDraft; y: NumericDraft; rotationZ: NumericDraft };
  anchor: Anchor;
};

type RectanglePlacement = PlacementBase & {
  targetRegion: { type: "rectangle"; width: NumericDraft; height: NumericDraft };
};

type PolygonPlacement = PlacementBase & {
  targetRegion: { type: "polygon"; points: PointDraft[] };
};

export type PlacementDraft = RectanglePlacement | PolygonPlacement;

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-2.5 py-1.5 text-sm tabular-nums shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function PlacementListControl({
  value,
  unit,
  disabled = false,
  onChange,
}: {
  value: unknown;
  unit?: string | null;
  disabled?: boolean;
  onChange: (value: PlacementDraft[]) => void;
}) {
  const placements = React.useMemo(() => normalizePlacements(value), [value]);

  function updatePlacement(index: number, next: PlacementDraft) {
    onChange(
      placements.map((placement, placementIndex) =>
        placementIndex === index ? next : placement,
      ),
    );
  }

  function movePlacement(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= placements.length) return;
    const next = [...placements];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function importGdsRegions(regions: GdsTargetRegion[]) {
    onChange(regions.map(placementFromGdsRegion));
  }

  return (
    <div className="min-w-0 space-y-3">
      {!disabled ? <GdsPlacementImport unit={unit} onImport={importGdsRegions} /> : null}

      <div className="space-y-3">
        {placements.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
            No placements
          </div>
        ) : null}
        {placements.map((placement, index) => (
          <PlacementCard
            key={index}
            index={index}
            placement={placement}
            unit={unit}
            disabled={disabled}
            canMoveUp={index > 0}
            canMoveDown={index < placements.length - 1}
            onChange={(next) => updatePlacement(index, next)}
            onMoveUp={() => movePlacement(index, -1)}
            onMoveDown={() => movePlacement(index, 1)}
            onRemove={() =>
              onChange(placements.filter((_, placementIndex) => placementIndex !== index))
            }
          />
        ))}
      </div>

      {!disabled ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => onChange([...placements, emptyRectanglePlacement()])}
          >
            <Plus />
            Add placement
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PlacementCard({
  index,
  placement,
  unit,
  disabled,
  canMoveUp,
  canMoveDown,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  index: number;
  placement: PlacementDraft;
  unit?: string | null;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (placement: PlacementDraft) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const diagnostic = placementDiagnostic(placement);
  const unitSuffix = unit ? ` (${unit})` : "";

  if (disabled) {
    return (
      <section className="overflow-hidden rounded-md border bg-muted/20">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <span className="font-medium">Placement {index + 1}</span>
          <span className="min-w-0 break-words text-right font-mono text-xs text-muted-foreground">
            {readOnlyPlacementSummary(placement, unit)}
          </span>
        </div>
        {placement.targetRegion.type === "polygon" ? (
          <div className="p-3">
            <PolygonPreview placement={placement as PolygonPlacement} />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className={cn("rounded-md border bg-white", diagnostic && "border-destructive/40")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
        <div>
          <span className="font-medium">Placement {index + 1}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground">
            {placementSummary(placement, unit)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label={`Move placement ${index + 1} up`} disabled={!canMoveUp} onClick={onMoveUp}>
            <ArrowUp />
          </IconButton>
          <IconButton label={`Move placement ${index + 1} down`} disabled={!canMoveDown} onClick={onMoveDown}>
            <ArrowDown />
          </IconButton>
          <IconButton label={`Remove placement ${index + 1}`} destructive onClick={onRemove}>
            <Trash2 />
          </IconButton>
        </div>
      </div>

      <div className="space-y-4 p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,4fr)]">
          <Field label="Shape">
            <select
              className={inputClass}
              value={placement.targetRegion.type}
              onChange={(event) =>
                onChange(convertPlacement(placement, event.target.value as "rectangle" | "polygon"))
              }
            >
              <option value="rectangle">Rectangle</option>
              <option value="polygon">Polygon</option>
            </select>
          </Field>
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span>Pose and anchor</span>
              <PoseHelp />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <NumericField
                label={`Pose X${unitSuffix}`}
                value={placement.pose.x}
                onChange={(x) => onChange({ ...placement, pose: { ...placement.pose, x } })}
              />
              <NumericField
                label={`Pose Y${unitSuffix}`}
                value={placement.pose.y}
                onChange={(y) => onChange({ ...placement, pose: { ...placement.pose, y } })}
              />
              <NumericField
                label="Rotation Z (deg)"
                value={placement.pose.rotationZ}
                onChange={(rotationZ) =>
                  onChange({ ...placement, pose: { ...placement.pose, rotationZ } })
                }
              />
              <Field label="Anchor">
                <select
                  className={inputClass}
                  value={placement.anchor}
                  onChange={(event) => onChange({ ...placement, anchor: event.target.value as Anchor })}
                >
                  <option value="bottomLeft">Bottom-left</option>
                  <option value="center">Center</option>
                  <option value="origin">Origin</option>
                </select>
              </Field>
            </div>
          </div>
        </div>

        {placement.targetRegion.type === "rectangle" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericField
              label={`Width${unitSuffix}`}
              value={placement.targetRegion.width}
              min={0}
              onChange={(width) =>
                onChange({
                  ...placement,
                  targetRegion: {
                    type: "rectangle",
                    width,
                    height: (placement as RectanglePlacement).targetRegion.height,
                  },
                })
              }
            />
            <NumericField
              label={`Height${unitSuffix}`}
              value={placement.targetRegion.height}
              min={0}
              onChange={(height) =>
                onChange({
                  ...placement,
                  targetRegion: {
                    type: "rectangle",
                    width: (placement as RectanglePlacement).targetRegion.width,
                    height,
                  },
                })
              }
            />
          </div>
        ) : (
          <PolygonEditor placement={placement as PolygonPlacement} unit={unit} onChange={onChange} />
        )}

        {diagnostic ? (
          <p role="alert" className="text-xs text-destructive">
            {diagnostic}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function PolygonEditor({
  placement,
  unit,
  onChange,
}: {
  placement: PolygonPlacement;
  unit?: string | null;
  onChange: (placement: PolygonPlacement) => void;
}) {
  const points = placement.targetRegion.points;

  function updatePoints(nextPoints: PointDraft[]) {
    onChange({ ...placement, targetRegion: { ...placement.targetRegion, points: nextPoints } });
  }

  function movePoint(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= points.length) return;
    const next = [...points];
    [next[index], next[target]] = [next[target], next[index]];
    updatePoints(next);
  }

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 overflow-hidden rounded-md border">
        <div className="grid grid-cols-[42px_minmax(0,1fr)_minmax(0,1fr)_112px] gap-2 border-b bg-muted/30 px-2 py-2 text-xs font-medium text-muted-foreground">
          <span>#</span>
          <span>Local X{unit ? ` (${unit})` : ""}</span>
          <span>Local Y{unit ? ` (${unit})` : ""}</span>
          <span className="sr-only">Actions</span>
        </div>
        {points.map((point, index) => {
          const invalidPoint =
            !isFiniteNumber(point[0]) || !isFiniteNumber(point[1]);
          return (
            <div
              key={index}
              className={cn(
                "grid grid-cols-[42px_minmax(0,1fr)_minmax(0,1fr)_112px] items-center gap-2 border-b px-2 py-2 last:border-b-0",
                invalidPoint && "bg-destructive/5",
              )}
            >
              <span className="text-xs text-muted-foreground">{index + 1}</span>
              <NumericInput
                ariaLabel={`Placement polygon point ${index + 1} X`}
                value={point[0]}
                invalid={!isFiniteNumber(point[0])}
                onChange={(x) =>
                  updatePoints(points.map((candidate, pointIndex) => (pointIndex === index ? [x, candidate[1]] : candidate)))
                }
              />
              <NumericInput
                ariaLabel={`Placement polygon point ${index + 1} Y`}
                value={point[1]}
                invalid={!isFiniteNumber(point[1])}
                onChange={(y) =>
                  updatePoints(points.map((candidate, pointIndex) => (pointIndex === index ? [candidate[0], y] : candidate)))
                }
              />
              <div className="flex justify-end gap-1">
                <IconButton label={`Move polygon point ${index + 1} up`} disabled={index === 0} onClick={() => movePoint(index, -1)}>
                  <ArrowUp />
                </IconButton>
                <IconButton label={`Move polygon point ${index + 1} down`} disabled={index === points.length - 1} onClick={() => movePoint(index, 1)}>
                  <ArrowDown />
                </IconButton>
                <IconButton label={`Remove polygon point ${index + 1}`} destructive onClick={() => updatePoints(points.filter((_, pointIndex) => pointIndex !== index))}>
                  <Trash2 />
                </IconButton>
              </div>
              {invalidPoint ? (
                <p role="alert" className="col-start-2 col-span-3 text-[11px] text-destructive">
                  Point {index + 1} requires finite X and Y values.
                </p>
              ) : null}
            </div>
          );
        })}
        <div className="flex justify-end border-t bg-muted/10 px-2 py-2">
          <Button type="button" size="sm" variant="outline" onClick={() => updatePoints([...points, ["", ""]])}>
            <Plus />
            Add point
          </Button>
        </div>
      </div>
      <PolygonPreview placement={placement} />
    </div>
  );
}

function PolygonPreview({ placement }: { placement: PolygonPlacement }) {
  const points = numericPoints(placement.targetRegion.points);
  if (!points || points.length < 2) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed bg-muted/10 px-3 text-center text-xs text-muted-foreground">
        Enter finite polygon points to preview the target outline.
      </div>
    );
  }
  const pivot = anchorPoint(points, placement.anchor);
  const angle = typeof placement.pose.rotationZ === "number" ? placement.pose.rotationZ : 0;
  const radians = (angle * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotated = points.map(([x, y]) => {
    const localX = x - pivot[0];
    const localY = y - pivot[1];
    return [localX * cosine - localY * sine, localX * sine + localY * cosine] as [number, number];
  });
  const display = rotated.map(([x, y]) => [x, -y] as [number, number]);
  const xs = [...display.map((point) => point[0]), 0];
  const ys = [...display.map((point) => point[1]), 0];
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const padding = Math.max(width, height, 1) * 0.15;
  const viewBox = [
    Math.min(...xs) - padding,
    Math.min(...ys) - padding,
    Math.max(width, 1) + padding * 2,
    Math.max(height, 1) + padding * 2,
  ].join(" ");

  return (
    <svg
      role="img"
      aria-label={`Polygon target preview with ${points.length} points, rotated ${angle} degrees around ${placement.anchor}`}
      className="min-h-40 w-full rounded-md border bg-slate-950"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
    >
      <polygon
        points={display.map((point) => point.join(",")).join(" ")}
        fill="rgba(56,189,248,0.2)"
        stroke="rgb(56,189,248)"
        strokeWidth={Math.max(width, height, 1) / 120}
        vectorEffect="non-scaling-stroke"
      />
      {display.map((point, index) => (
        <g key={index}>
          <circle cx={point[0]} cy={point[1]} r={Math.max(width, height, 1) / 45} fill="white" />
          <text
            x={point[0]}
            y={point[1]}
            dx={Math.max(width, 1) / 40}
            dy={-Math.max(height, 1) / 40}
            fill="white"
            fontSize={Math.max(width, height, 1) / 18}
          >
            {index + 1}
          </text>
        </g>
      ))}
      <circle cx={0} cy={0} r={Math.max(width, height, 1) / 32} fill="rgb(251,191,36)" />
    </svg>
  );
}

function PoseHelp() {
  const tooltipId = React.useId();
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label="Explain pose and anchor fields"
        aria-describedby={tooltipId}
        className="inline-flex size-5 items-center justify-center rounded-full text-amber-600 outline-none transition hover:bg-amber-50 hover:text-amber-700 focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <CircleAlert className="size-4" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="invisible absolute left-1/2 top-full z-50 mt-2 w-72 max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-md border bg-popover p-3 text-left text-xs font-normal text-popover-foreground opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <span className="mb-1.5 block font-semibold">Placement pose</span>
        <span className="block">
          <span className="font-semibold">Pose X / Y:</span> global position of the selected anchor, in um.
        </span>
        <span className="mt-1 block">
          <span className="font-semibold">Rotation Z:</span> counter-clockwise rotation in the XY plane around the anchor.
        </span>
        <span className="mt-1 block">
          <span className="font-semibold">Anchor:</span> Bottom-left and Center use the shape AABB; Origin uses local (0, 0).
        </span>
      </span>
    </span>
  );
}

function NumericField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: NumericDraft;
  min?: number;
  onChange: (value: NumericDraft) => void;
}) {
  return (
    <Field label={label}>
      <NumericInput ariaLabel={label} value={value} min={min} onChange={onChange} />
    </Field>
  );
}

function NumericInput({
  ariaLabel,
  value,
  min,
  invalid,
  onChange,
}: {
  ariaLabel: string;
  value: NumericDraft;
  min?: number;
  invalid?: boolean;
  onChange: (value: NumericDraft) => void;
}) {
  return (
    <input
      className={inputClass}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      type="number"
      min={min}
      step="any"
      value={value}
      onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="min-w-0 text-xs">
      <span className="mb-1 block font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function IconButton({
  label,
  disabled,
  destructive,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4",
        destructive && "hover:bg-destructive/10 hover:text-destructive",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function emptyRectanglePlacement(): RectanglePlacement {
  return {
    targetRegion: { type: "rectangle", width: "", height: "" },
    pose: { x: 0, y: 0, rotationZ: 0 },
    anchor: "bottomLeft",
  };
}

function normalizePlacements(value: unknown): PlacementDraft[] {
  if (!Array.isArray(value)) return [];
  const result: PlacementDraft[] = [];
  value.forEach((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.targetRegion) || !isRecord(candidate.pose)) {
      return;
    }
    const base: PlacementBase = {
      pose: {
        x: numericDraft(candidate.pose.x),
        y: numericDraft(candidate.pose.y),
        rotationZ: numericDraft(candidate.pose.rotationZ),
      },
      anchor: isAnchor(candidate.anchor) ? candidate.anchor : "bottomLeft",
    };
    if (candidate.targetRegion.type === "polygon") {
      const rawPoints = Array.isArray(candidate.targetRegion.points) ? candidate.targetRegion.points : [];
      const points = rawPoints.flatMap((point) =>
        Array.isArray(point) && point.length === 2
          ? ([[numericDraft(point[0]), numericDraft(point[1])]] as PointDraft[])
          : [],
      );
      if (points.length > 3 && draftPointsEqual(points[0], points[points.length - 1])) points.pop();
      result.push({ ...base, targetRegion: { type: "polygon", points } });
      return;
    }
    result.push({
      ...base,
      targetRegion: {
        type: "rectangle",
        width: numericDraft(candidate.targetRegion.width),
        height: numericDraft(candidate.targetRegion.height),
      },
    });
  });
  return result;
}

function convertPlacement(
  placement: PlacementDraft,
  type: "rectangle" | "polygon",
): PlacementDraft {
  if (placement.targetRegion.type === type) return placement;
  if (type === "polygon" && placement.targetRegion.type === "rectangle") {
    const { width, height } = placement.targetRegion;
    const points: PointDraft[] =
      isPositiveNumber(width) && isPositiveNumber(height)
        ? [[0, 0], [width, 0], [width, height], [0, height]]
        : [["", ""], ["", ""], ["", ""]];
    return { ...placement, targetRegion: { type: "polygon", points } };
  }
  const points = numericPoints((placement as PolygonPlacement).targetRegion.points);
  if (!points || points.length === 0) {
    return { ...placement, targetRegion: { type: "rectangle", width: "", height: "" } };
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    ...placement,
    targetRegion: {
      type: "rectangle",
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
  };
}

function placementFromGdsRegion(region: GdsTargetRegion): PlacementDraft {
  if (region.type === "rectangle") {
    const [[xMin, yMin], [xMax, yMax]] = region.bounds;
    return {
      targetRegion: { type: "rectangle", width: xMax - xMin, height: yMax - yMin },
      pose: { x: xMin, y: yMin, rotationZ: 0 },
      anchor: "bottomLeft",
    };
  }
  const xMin = Math.min(...region.points.map((point) => point[0]));
  const yMin = Math.min(...region.points.map((point) => point[1]));
  return {
    targetRegion: {
      type: "polygon",
      points: region.points.map((point) => [point[0] - xMin, point[1] - yMin]),
    },
    pose: { x: xMin, y: yMin, rotationZ: 0 },
    anchor: "bottomLeft",
  };
}

function placementDiagnostic(placement: PlacementDraft) {
  if (
    !isFiniteNumber(placement.pose.x) ||
    !isFiniteNumber(placement.pose.y) ||
    !isFiniteNumber(placement.pose.rotationZ)
  ) {
    return "Pose X, Y, and rotation must be finite numbers.";
  }
  if (placement.targetRegion.type === "rectangle") {
    return isPositiveNumber(placement.targetRegion.width) &&
      isPositiveNumber(placement.targetRegion.height)
      ? null
      : "Rectangle width and height must be greater than zero.";
  }
  const points = numericPoints(placement.targetRegion.points);
  if (!points) return "Enter a finite X and Y for every polygon point.";
  if (points.length < 3) return "Polygon requires at least three points.";
  if (new Set(points.map((point) => `${point[0]}:${point[1]}`)).size !== points.length) {
    return "Polygon points must be unique.";
  }
  if (points.some((point, index) => pointsEqual(point, points[(index + 1) % points.length]))) {
    return "Polygon must not contain zero-length edges.";
  }
  if (polygonSelfIntersects(points)) return "Polygon must not self-intersect.";
  if (Math.abs(polygonArea(points)) <= 1e-9) return "Polygon must have non-zero area.";
  return null;
}

function placementSummary(placement: PlacementDraft, unit?: string | null) {
  const suffix = unit ? ` ${unit}` : "";
  const position = `(${draftLabel(placement.pose.x)}, ${draftLabel(placement.pose.y)})${suffix}`;
  if (placement.targetRegion.type === "rectangle") {
    return `${position} · ${draftLabel(placement.targetRegion.width)} × ${draftLabel(placement.targetRegion.height)}${suffix}`;
  }
  return `${position} · polygon ${placement.targetRegion.points.length} points`;
}

function readOnlyPlacementSummary(
  placement: PlacementDraft,
  unit?: string | null,
) {
  const suffix = unit ? ` ${unit}` : "";
  const pose = `pose (${draftLabel(placement.pose.x)}, ${draftLabel(placement.pose.y)})${suffix}`;
  const rotation = `rotation ${draftLabel(placement.pose.rotationZ)}°`;
  const anchor = `anchor ${placement.anchor}`;
  if (placement.targetRegion.type === "rectangle") {
    return `Rectangle · ${pose} · ${rotation} · ${draftLabel(placement.targetRegion.width)} × ${draftLabel(placement.targetRegion.height)}${suffix} · ${anchor}`;
  }
  return `Polygon · ${pose} · ${rotation} · ${placement.targetRegion.points.length} vertices · ${anchor}`;
}

function anchorPoint(points: [number, number][], anchor: Anchor): [number, number] {
  if (anchor === "origin") return [0, 0];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  if (anchor === "bottomLeft") return [Math.min(...xs), Math.min(...ys)];
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function numericPoints(points: PointDraft[]): [number, number][] | null {
  if (!points.every((point) => isFiniteNumber(point[0]) && isFiniteNumber(point[1]))) return null;
  return points.map((point) => [point[0] as number, point[1] as number]);
}

function polygonArea(points: [number, number][]) {
  return (
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length];
      return area + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2
  );
}

function polygonSelfIntersects(points: [number, number][]) {
  for (let left = 0; left < points.length; left += 1) {
    const leftEnd = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightEnd = (right + 1) % points.length;
      if (left === right || left === rightEnd || leftEnd === right || leftEnd === rightEnd) continue;
      if (segmentsIntersect(points[left], points[leftEnd], points[right], points[rightEnd])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: number[], b: number[], c: number[], d: number[]) {
  const orientations = [orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)];
  if (orientations[0] * orientations[1] < -1e-9 && orientations[2] * orientations[3] < -1e-9) return true;
  return pointOnSegment(a, c, d) || pointOnSegment(b, c, d) || pointOnSegment(c, a, b) || pointOnSegment(d, a, b);
}

function pointOnSegment(point: number[], start: number[], end: number[]) {
  return (
    Math.abs(orientation(start, end, point)) <= 1e-9 &&
    point[0] >= Math.min(start[0], end[0]) - 1e-9 &&
    point[0] <= Math.max(start[0], end[0]) + 1e-9 &&
    point[1] >= Math.min(start[1], end[1]) - 1e-9 &&
    point[1] <= Math.max(start[1], end[1]) + 1e-9
  );
}

function orientation(a: number[], b: number[], c: number[]) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function numericDraft(value: unknown): NumericDraft {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function isFiniteNumber(value: NumericDraft): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveNumber(value: NumericDraft): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isAnchor(value: unknown): value is Anchor {
  return value === "bottomLeft" || value === "center" || value === "origin";
}

function draftPointsEqual(left: PointDraft, right: PointDraft) {
  return (
    isFiniteNumber(left[0]) &&
    isFiniteNumber(left[1]) &&
    isFiniteNumber(right[0]) &&
    isFiniteNumber(right[1]) &&
    pointsEqual(left as [number, number], right as [number, number])
  );
}

function pointsEqual(left: number[], right: number[]) {
  return Math.abs(left[0] - right[0]) <= 1e-9 && Math.abs(left[1] - right[1]) <= 1e-9;
}

function draftLabel(value: NumericDraft) {
  return value === "" ? "—" : String(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
