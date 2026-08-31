"use client";

import * as React from "react";

import type {
  EngineeringPreviewDimension,
  EngineeringPreviewEntity,
  EngineeringPreviewView,
} from "@/components/geometry-generator/geometry-generator-contracts";

const WIDTH = 560;
const HEIGHT = 330;
const PLOT = { left: 70, right: 78, top: 30, bottom: 72 };

const roleColors: Record<string, { fill: string; stroke: string }> = {
  mold: { fill: "#dcefeb", stroke: "#0f766e" },
  die: { fill: "#f4cf68", stroke: "#8a6413" },
  circuit: { fill: "#c9d8f0", stroke: "#315f9b" },
  solderMask: { fill: "#d8c4e8", stroke: "#6b3f86" },
  via: { fill: "#e2c59b", stroke: "#8a5a18" },
  bump: { fill: "#d8dce3", stroke: "#475569" },
  body: { fill: "#e8edf3", stroke: "#475569" },
};

export function EngineeringPreviewRenderer({
  view,
  unit,
}: {
  view: EngineeringPreviewView;
  unit: string;
}) {
  const markerId = React.useId().replaceAll(":", "");
  const transform = drawingTransform(view);
  const roles = Array.from(new Set(view.entities.map((entity) => entity.role)));

  return (
    <div className="overflow-hidden rounded-md border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div>
          <div className="text-sm font-medium">{view.label}</div>
          <div className="font-mono text-[10px] uppercase text-muted-foreground">
            {view.projection} / {unit}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {roles.map((role) => {
            const color = colorForRole(role);
            return (
              <span key={role} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 rounded-sm border"
                  style={{ backgroundColor: color.fill, borderColor: color.stroke }}
                />
                {role}
              </span>
            );
          })}
        </div>
      </div>
      <svg
        aria-label={`${view.label}, ${view.projection} projection`}
        className="h-auto w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <defs>
          <marker
            id={markerId}
            markerHeight="5"
            markerWidth="5"
            orient="auto-start-reverse"
            refX="2.5"
            refY="2.5"
            viewBox="0 0 5 5"
          >
            <path d="M 5 0 L 0 2.5 L 5 5 z" fill="#334155" />
          </marker>
        </defs>
        <rect fill="#fbfdff" height={HEIGHT} width={WIDTH} x="0" y="0" />
        <line
          stroke="#94a3b8"
          strokeDasharray="5 4"
          strokeWidth="0.8"
          x1={PLOT.left}
          x2={WIDTH - PLOT.right}
          y1={transform.v(0)}
          y2={transform.v(0)}
        />
        <line
          stroke="#94a3b8"
          strokeDasharray="5 4"
          strokeWidth="0.8"
          x1={transform.u(0)}
          x2={transform.u(0)}
          y1={PLOT.top}
          y2={HEIGHT - PLOT.bottom}
        />
        {view.entities.map((entity) => (
          <PreviewEntity key={entity.id} entity={entity} transform={transform} />
        ))}
        {view.dimensions.map((dimension, index) => (
          <PreviewDimension
            key={dimension.id}
            dimension={dimension}
            axisIndex={
              view.dimensions
                .slice(0, index)
                .filter((candidate) => candidate.axis === dimension.axis).length
            }
            markerId={markerId}
            transform={transform}
            unit={unit}
          />
        ))}
      </svg>
    </div>
  );
}

type DrawingTransform = ReturnType<typeof drawingTransform>;

function PreviewEntity({
  entity,
  transform,
}: {
  entity: EngineeringPreviewEntity;
  transform: DrawingTransform;
}) {
  const color = colorForRole(entity.role);
  const common = {
    fill: color.fill,
    fillOpacity: entity.role === "mold" ? 0.55 : 0.82,
    stroke: color.stroke,
    strokeWidth: 1.3,
  };
  if (
    entity.kind === "rectangle" &&
    entity.uMin != null &&
    entity.uMax != null &&
    entity.vMin != null &&
    entity.vMax != null
  ) {
    const x = transform.u(entity.uMin);
    const y = transform.v(entity.vMax);
    return (
      <rect
        {...common}
        height={Math.max(0.8, transform.v(entity.vMin) - y)}
        width={Math.max(0.8, transform.u(entity.uMax) - x)}
        x={x}
        y={y}
      >
        <title>{entity.sourceId}</title>
      </rect>
    );
  }
  if (entity.kind === "circle" && entity.center && entity.radius != null) {
    return (
      <circle
        {...common}
        cx={transform.u(entity.center[0])}
        cy={transform.v(entity.center[1])}
        r={Math.max(0.8, entity.radius * transform.scale)}
      >
        <title>{entity.sourceId}</title>
      </circle>
    );
  }
  if (entity.kind === "polygon" && entity.loops) {
    const path = entity.loops
      .filter((loop) => loop.length > 0)
      .map(
        (loop) =>
          `${loop
            .map(
              (point, index) =>
                `${index === 0 ? "M" : "L"} ${transform.u(point[0])} ${transform.v(point[1])}`,
            )
            .join(" ")} Z`,
      )
      .join(" ");
    return (
      <path {...common} d={path} fillRule="evenodd">
        <title>{entity.sourceId}</title>
      </path>
    );
  }
  return null;
}

function PreviewDimension({
  dimension,
  axisIndex,
  markerId,
  transform,
  unit,
}: {
  dimension: EngineeringPreviewDimension;
  axisIndex: number;
  markerId: string;
  transform: DrawingTransform;
  unit: string;
}) {
  const stroke = "#334155";
  if (dimension.axis === "u") {
    const x1 = transform.u(dimension.from[0]);
    const x2 = transform.u(dimension.to[0]);
    const sourceY = transform.v(dimension.from[1]);
    const y = HEIGHT - 40 + axisIndex * 13;
    return (
      <g fill="none" stroke={stroke} strokeWidth="0.9">
        <line x1={x1} x2={x1} y1={sourceY} y2={y} />
        <line x1={x2} x2={x2} y1={sourceY} y2={y} />
        <line
          markerEnd={`url(#${markerId})`}
          markerStart={`url(#${markerId})`}
          x1={x1 + 3}
          x2={x2 - 3}
          y1={y}
          y2={y}
        />
        <text fill={stroke} fontSize="10" stroke="none" textAnchor="middle" x={(x1 + x2) / 2} y={y - 6}>
          {`${dimension.label} ${formatNumber(dimension.value)} ${unit}`}
        </text>
      </g>
    );
  }
  const y1 = transform.v(dimension.from[1]);
  const y2 = transform.v(dimension.to[1]);
  const sourceX = transform.u(dimension.from[0]);
  const x = WIDTH - 43 + axisIndex * 13;
  return (
    <g fill="none" stroke={stroke} strokeWidth="0.9">
      <line x1={sourceX} x2={x} y1={y1} y2={y1} />
      <line x1={sourceX} x2={x} y1={y2} y2={y2} />
      <line
        markerEnd={`url(#${markerId})`}
        markerStart={`url(#${markerId})`}
        x1={x}
        x2={x}
        y1={y1 - 3}
        y2={y2 + 3}
      />
      <text
        fill={stroke}
        fontSize="10"
        stroke="none"
        textAnchor="middle"
        transform={`rotate(-90 ${x + 15} ${(y1 + y2) / 2})`}
        x={x + 15}
        y={(y1 + y2) / 2}
      >
        {`${dimension.label} ${formatNumber(dimension.value)} ${unit}`}
      </text>
    </g>
  );
}

function drawingTransform(view: EngineeringPreviewView) {
  const uSpan = Math.max(1e-9, view.bounds.uMax - view.bounds.uMin);
  const vSpan = Math.max(1e-9, view.bounds.vMax - view.bounds.vMin);
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = HEIGHT - PLOT.top - PLOT.bottom;
  const scale = Math.min(plotWidth / uSpan, plotHeight / vSpan);
  const renderedWidth = uSpan * scale;
  const renderedHeight = vSpan * scale;
  const xOffset = PLOT.left + (plotWidth - renderedWidth) / 2;
  const yOffset = PLOT.top + (plotHeight - renderedHeight) / 2;
  return {
    scale,
    u: (value: number) => xOffset + (value - view.bounds.uMin) * scale,
    v: (value: number) => yOffset + renderedHeight - (value - view.bounds.vMin) * scale,
  };
}

function colorForRole(role: string) {
  return roleColors[role] ?? roleColors.body;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}
