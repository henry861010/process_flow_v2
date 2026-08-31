"use client";

import * as React from "react";

import {
  CoordinateListControl,
  type GdsTargetRegion,
} from "@/components/process-flow-fields/coordinate-list-control";

type RectanglePlacement = {
  targetRegion: { type: "rectangle"; width: number; height: number };
  pose: { x: number; y: number; rotationZ?: number };
  anchor?: "bottomLeft" | "center" | "origin";
};

type PolygonPlacement = {
  targetRegion: { type: "polygon"; points: Array<[number, number]> };
  pose: { x: number; y: number; rotationZ?: number };
  anchor?: "bottomLeft" | "center" | "origin";
};

type Placement = RectanglePlacement | PolygonPlacement;

const inputClass =
  "h-8 w-24 rounded-md border border-input bg-white px-2 py-1 text-xs shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";

export function PlacementListControl({
  value,
  unit,
  onChange,
}: {
  value: unknown;
  unit?: string | null;
  onChange: (value: Placement[]) => void;
}) {
  const placements = normalizePlacements(value);
  const rectangles = placements.flatMap((placement) => {
    if (placement.targetRegion.type !== "rectangle") return [];
    const x = placement.pose.x;
    const y = placement.pose.y;
    return [
      [
        [x, y],
        [x + placement.targetRegion.width, y + placement.targetRegion.height],
      ],
    ];
  });
  const polygons = placements.filter(
    (placement): placement is PolygonPlacement => placement.targetRegion.type === "polygon",
  );

  function updateRectangles(nextValue: unknown) {
    const coordinates = Array.isArray(nextValue) ? nextValue : [];
    const previousRectangles = placements.filter(
      (placement): placement is RectanglePlacement =>
        placement.targetRegion.type === "rectangle",
    );
    const nextRectangles = coordinates.flatMap((coordinate, coordinateIndex) => {
      if (
        !Array.isArray(coordinate) ||
        coordinate.length !== 2 ||
        !Array.isArray(coordinate[0]) ||
        !Array.isArray(coordinate[1])
      ) {
        return [];
      }
      const x = Number(coordinate[0][0]);
      const y = Number(coordinate[0][1]);
      const xMax = Number(coordinate[1][0]);
      const yMax = Number(coordinate[1][1]);
      const previous = previousRectangles[coordinateIndex];
      return [
        {
          targetRegion: {
            type: "rectangle" as const,
            width: xMax - x,
            height: yMax - y,
          },
          pose: { x, y, rotationZ: previous?.pose.rotationZ ?? 0 },
          anchor: previous?.anchor ?? ("bottomLeft" as const),
        },
      ];
    });
    onChange(mergeRectangles(placements, nextRectangles));
  }

  function importGdsRegions(regions: GdsTargetRegion[]) {
    onChange(
      regions.map((region): Placement => {
        if (region.type === "rectangle") {
          const [[xMin, yMin], [xMax, yMax]] = region.bounds;
          return {
            targetRegion: {
              type: "rectangle",
              width: xMax - xMin,
              height: yMax - yMin,
            },
            pose: { x: xMin, y: yMin, rotationZ: 0 },
            anchor: "bottomLeft",
          };
        }
        const xMin = Math.min(...region.points.map((point) => point[0]));
        const yMin = Math.min(...region.points.map((point) => point[1]));
        return {
          targetRegion: {
            type: "polygon",
            points: region.points.map((point) => [
              point[0] - xMin,
              point[1] - yMin,
            ]),
          },
          pose: { x: xMin, y: yMin, rotationZ: 0 },
          anchor: "bottomLeft",
        };
      }),
    );
  }

  function updateRotation(index: number, rawValue: string) {
    const rotationZ = rawValue === "" ? 0 : Number(rawValue);
    onChange(
      placements.map((placement, placementIndex) =>
        placementIndex === index
          ? { ...placement, pose: { ...placement.pose, rotationZ } }
          : placement,
      ),
    );
  }

  return (
    <div className="space-y-3">
      <CoordinateListControl
        value={rectangles}
        unit={unit}
        onChange={updateRectangles}
        onGdsRegions={importGdsRegions}
      />
      {placements.length > 0 ? (
        <div className="overflow-hidden rounded-md border bg-muted/10">
          {placements.map((placement, index) => (
            <div
              key={`${placement.targetRegion.type}-${index}`}
              className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2 text-xs last:border-b-0"
            >
              <div>
                <span className="font-medium">Placement {index + 1}</span>
                <span className="ml-2 font-mono text-muted-foreground">
                  {placementSummary(placement, unit)}
                </span>
              </div>
              <label className="flex items-center gap-2 text-muted-foreground">
                Rotation Z
                <input
                  className={inputClass}
                  type="number"
                  step="90"
                  value={placement.pose.rotationZ ?? 0}
                  onChange={(event) => updateRotation(index, event.target.value)}
                />
                deg
              </label>
            </div>
          ))}
        </div>
      ) : null}
      {polygons.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Polygon target regions keep their exact outline. Manual rectangle edits leave them unchanged;
          a new GDS import replaces the complete placement list.
        </p>
      ) : null}
    </div>
  );
}

function mergeRectangles(
  current: Placement[],
  replacements: RectanglePlacement[],
): Placement[] {
  let replacementIndex = 0;
  const result = current.flatMap((placement) => {
    if (placement.targetRegion.type === "polygon") return [placement];
    const replacement = replacements[replacementIndex];
    replacementIndex += 1;
    return replacement ? [replacement] : [];
  });
  return [...result, ...replacements.slice(replacementIndex)];
}

function normalizePlacements(value: unknown): Placement[] {
  if (!Array.isArray(value)) return [];
  return value.filter((placement): placement is Placement => {
    if (!isRecord(placement) || !isRecord(placement.targetRegion) || !isRecord(placement.pose)) {
      return false;
    }
    return placement.targetRegion.type === "rectangle" || placement.targetRegion.type === "polygon";
  });
}

function placementSummary(placement: Placement, unit?: string | null) {
  const suffix = unit ? ` ${unit}` : "";
  const position = `(${placement.pose.x}, ${placement.pose.y})${suffix}`;
  if (placement.targetRegion.type === "rectangle") {
    return `${position} · ${placement.targetRegion.width} × ${placement.targetRegion.height}${suffix}`;
  }
  return `${position} · polygon ${placement.targetRegion.points.length} points`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
