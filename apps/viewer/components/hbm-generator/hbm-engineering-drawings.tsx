"use client";

import * as React from "react";

import {
  deriveHbmDimensions,
  MAX_CORE_DIE_COUNT,
  type HbmGeneratorParameters,
} from "@/lib/hbm-generator";

const MOLDING_FILL = "#dcefeb";
const MOLDING_STROKE = "#0f766e";
const DIE_FILL = "#f4cf68";
const DIE_STROKE = "#8a6413";
const DIMENSION_STROKE = "#334155";
const CENTER_LINE = "#64748b";

export function HbmTopViewDrawing({
  parameters,
}: {
  parameters: HbmGeneratorParameters;
}) {
  const markerId = useMarkerId("hbm-top-arrow");
  const packageX = positiveOr(parameters.packageX, 1);
  const packageY = positiveOr(parameters.packageY, 1);
  const coreX = clamp(positiveOr(parameters.coreDieX, packageX * 0.5), 1, packageX);
  const coreY = clamp(positiveOr(parameters.coreDieY, packageY * 0.5), 1, packageY);
  const dimensions = deriveHbmDimensions({
    ...parameters,
    packageX,
    packageY,
    coreDieX: coreX,
    coreDieY: coreY,
  });

  const drawingWidth = 300;
  const drawingHeight = 160;
  const scale = Math.min(drawingWidth / packageX, drawingHeight / packageY);
  const outerWidth = packageX * scale;
  const outerHeight = packageY * scale;
  const outerX = 255 - outerWidth / 2;
  const outerY = 137 - outerHeight / 2;
  const coreWidth = coreX * scale;
  const coreHeight = coreY * scale;
  const coreLeft = 255 - coreWidth / 2;
  const coreTop = 137 - coreHeight / 2;

  return (
    <svg
      aria-label={`HBM top view. Package ${formatDimension(packageX)} by ${formatDimension(packageY)} micrometres. Centered core die ${formatDimension(coreX)} by ${formatDimension(coreY)} micrometres.`}
      className="h-auto w-full"
      role="img"
      viewBox="0 0 520 310"
    >
      <ArrowMarker id={markerId} />

      <rect
        fill={MOLDING_FILL}
        height={outerHeight}
        rx="3"
        stroke={MOLDING_STROKE}
        strokeWidth="2"
        width={outerWidth}
        x={outerX}
        y={outerY}
      />
      <rect
        fill="none"
        height={outerHeight}
        stroke={DIE_STROKE}
        strokeDasharray="5 4"
        strokeWidth="1"
        width={outerWidth}
        x={outerX}
        y={outerY}
      />
      <rect
        fill={DIE_FILL}
        height={coreHeight}
        rx="2"
        stroke={DIE_STROKE}
        strokeWidth="2"
        width={coreWidth}
        x={coreLeft}
        y={coreTop}
      />

      <line
        stroke={CENTER_LINE}
        strokeDasharray="7 5"
        strokeWidth="1"
        x1={outerX - 12}
        x2={outerX + outerWidth + 12}
        y1="137"
        y2="137"
      />
      <line
        stroke={CENTER_LINE}
        strokeDasharray="7 5"
        strokeWidth="1"
        x1="255"
        x2="255"
        y1={outerY - 12}
        y2={outerY + outerHeight + 12}
      />
      <circle cx="255" cy="137" fill="white" r="3.5" stroke={CENTER_LINE} />

      <HorizontalDimension
        extensionFromY={outerY}
        label={`Core die X  ${formatDimension(coreX)} µm`}
        markerId={markerId}
        x1={coreLeft}
        x2={coreLeft + coreWidth}
        y="29"
      />
      <HorizontalDimension
        extensionFromY={outerY + outerHeight}
        label={`Package X  ${formatDimension(packageX)} µm`}
        markerId={markerId}
        x1={outerX}
        x2={outerX + outerWidth}
        y="250"
      />
      <VerticalDimension
        extensionFromX={outerX}
        label={`Package Y  ${formatDimension(packageY)} µm`}
        markerId={markerId}
        x="49"
        y1={outerY}
        y2={outerY + outerHeight}
      />
      <VerticalDimension
        extensionFromX={outerX + outerWidth}
        label={`Core die Y  ${formatDimension(coreY)} µm`}
        markerId={markerId}
        x="461"
        y1={coreTop}
        y2={coreTop + coreHeight}
      />

      <text fill={DIMENSION_STROKE} fontSize="10.5" textAnchor="middle" x="255" y="284">
        {`Side molding X  ${formatDimension(dimensions.sideMoldingX)} µm / side`}
      </text>
      <text fill={DIMENSION_STROKE} fontSize="10.5" textAnchor="middle" x="255" y="301">
        {`Side molding Y  ${formatDimension(dimensions.sideMoldingY)} µm / side`}
      </text>
      <text fill={DIE_STROKE} fontSize="9.5" x={outerX + 7} y={outerY + outerHeight - 7}>
        Base die footprint = package footprint
      </text>
    </svg>
  );
}

export function HbmCrossSectionDrawing({
  parameters,
}: {
  parameters: HbmGeneratorParameters;
}) {
  const markerId = useMarkerId("hbm-section-arrow");
  const packageX = positiveOr(parameters.packageX, 1);
  const coreX = clamp(positiveOr(parameters.coreDieX, packageX * 0.5), 1, packageX);
  const baseThickness = positiveOr(parameters.baseDieThickness, 1);
  const coreThickness = positiveOr(parameters.coreDieThickness, 1);
  const coreBaseGap = nonNegativeOr(parameters.coreBaseGap, 0);
  const coreCoreGap = nonNegativeOr(parameters.coreCoreGap, 0);
  const topMolding = nonNegativeOr(parameters.topMoldingThickness, 0);
  const coreCount = clamp(
    Number.isInteger(parameters.coreDieCount) ? parameters.coreDieCount : 1,
    1,
    MAX_CORE_DIE_COUNT,
  );
  const totalThickness =
    baseThickness +
    coreBaseGap +
    coreCount * coreThickness +
    Math.max(0, coreCount - 1) * coreCoreGap +
    topMolding;

  const rootX = 102;
  const rootY = 32;
  const rootWidth = 318;
  const rootHeight = 216;
  const rootBottom = rootY + rootHeight;
  const zScale = rootHeight / totalThickness;
  const coreWidth = Math.max(32, rootWidth * (coreX / packageX));
  const coreLeft = rootX + (rootWidth - coreWidth) / 2;
  const coreRight = coreLeft + coreWidth;
  const baseDisplayHeight = Math.max(1.5, baseThickness * zScale);
  const baseTop = rootBottom - baseDisplayHeight;
  const coreRects = Array.from({ length: coreCount }, (_, index) => {
    const bottomZ =
      baseThickness + coreBaseGap + index * (coreThickness + coreCoreGap);
    return {
      index,
      y: rootBottom - (bottomZ + coreThickness) * zScale,
      height: Math.max(1.5, coreThickness * zScale),
      bottomZ,
    };
  });
  const firstCore = coreRects[0];
  const secondCore = coreRects[1];
  const topCore = coreRects[coreRects.length - 1];
  const coreBaseGapMidY = (baseTop + (firstCore.y + firstCore.height)) / 2;
  const coreCoreGapMidY = secondCore
    ? (firstCore.y + secondCore.y + secondCore.height) / 2
    : firstCore.y - 4;
  const topMoldingMidY = (rootY + topCore.y) / 2;

  return (
    <svg
      aria-label={`HBM cross section with ${coreCount} core dies and total thickness ${formatDimension(totalThickness)} micrometres.`}
      className="h-auto w-full"
      role="img"
      viewBox="0 0 560 310"
    >
      <ArrowMarker id={markerId} />

      <rect
        fill={MOLDING_FILL}
        height={rootHeight}
        stroke={MOLDING_STROKE}
        strokeWidth="2"
        width={rootWidth}
        x={rootX}
        y={rootY}
      />
      <rect
        fill={DIE_FILL}
        height={baseDisplayHeight}
        stroke={DIE_STROKE}
        strokeWidth="1.5"
        width={rootWidth}
        x={rootX}
        y={baseTop}
      />
      {coreRects.map((core) => (
        <g key={core.index}>
          <rect
            fill={DIE_FILL}
            height={core.height}
            stroke={DIE_STROKE}
            strokeWidth="1.5"
            width={coreWidth}
            x={coreLeft}
            y={core.y}
          />
          {core.height >= 13 ? (
            <text
              fill="#5f470f"
              fontSize="9"
              textAnchor="middle"
              x={coreLeft + coreWidth / 2}
              y={core.y + core.height / 2 + 3}
            >
              {`Core ${core.index + 1}`}
            </text>
          ) : null}
        </g>
      ))}

      <Callout
        label={`Top molding  ${formatDimension(topMolding)} µm`}
        sourceX={rootX + rootWidth / 2}
        sourceY={topMoldingMidY}
        targetY={47}
      />
      <Callout
        label={`Core die thk  ${formatDimension(coreThickness)} µm`}
        sourceX={coreRight}
        sourceY={topCore.y + topCore.height / 2}
        targetY={86}
      />
      {coreCount > 1 ? (
        <Callout
          label={`Core–core gap  ${formatDimension(coreCoreGap)} µm`}
          sourceX={coreRight}
          sourceY={coreCoreGapMidY}
          targetY={124}
        />
      ) : null}
      <Callout
        label={`Core–base gap  ${formatDimension(coreBaseGap)} µm`}
        sourceX={coreRight}
        sourceY={coreBaseGapMidY}
        targetY={162}
      />

      <polyline
        fill="none"
        points={`${rootX},${baseTop + baseDisplayHeight / 2} 70,${baseTop + baseDisplayHeight / 2} 60,242`}
        stroke={DIMENSION_STROKE}
        strokeWidth="1"
      />
      <text fill={DIMENSION_STROKE} fontSize="10" textAnchor="end" x="94" y="265">
        {`Base die thk  ${formatDimension(baseThickness)} µm`}
      </text>
      <text fill={DIMENSION_STROKE} fontSize="10.5" textAnchor="middle" x={rootX + rootWidth / 2} y="270">
        {`${coreCount} × core dies · die material shared with base die`}
      </text>
      <VerticalDimension
        extensionFromX={rootX + rootWidth}
        label={`Total  ${formatDimension(totalThickness)} µm`}
        markerId={markerId}
        x="529"
        y1={rootY}
        y2={rootBottom}
      />
      <text fill={CENTER_LINE} fontSize="9.5" textAnchor="middle" x="280" y="300">
        Schematic — dimensions are authoritative
      </text>
    </svg>
  );
}

function HorizontalDimension({
  x1,
  x2,
  y,
  extensionFromY,
  label,
  markerId,
}: {
  x1: number;
  x2: number;
  y: number | string;
  extensionFromY: number;
  label: string;
  markerId: string;
}) {
  const dimensionY = Number(y);
  return (
    <g fill="none" stroke={DIMENSION_STROKE} strokeWidth="1">
      <line x1={x1} x2={x1} y1={extensionFromY} y2={dimensionY} />
      <line x1={x2} x2={x2} y1={extensionFromY} y2={dimensionY} />
      <line
        markerEnd={`url(#${markerId})`}
        markerStart={`url(#${markerId})`}
        x1={x1 + 2}
        x2={x2 - 2}
        y1={dimensionY}
        y2={dimensionY}
      />
      <text
        fill={DIMENSION_STROKE}
        fontSize="10.5"
        stroke="none"
        textAnchor="middle"
        x={(x1 + x2) / 2}
        y={dimensionY - 6}
      >
        {label}
      </text>
    </g>
  );
}

function VerticalDimension({
  x,
  y1,
  y2,
  extensionFromX,
  label,
  markerId,
}: {
  x: number | string;
  y1: number;
  y2: number;
  extensionFromX: number;
  label: string;
  markerId: string;
}) {
  const dimensionX = Number(x);
  const centerY = (y1 + y2) / 2;
  return (
    <g fill="none" stroke={DIMENSION_STROKE} strokeWidth="1">
      <line x1={extensionFromX} x2={dimensionX} y1={y1} y2={y1} />
      <line x1={extensionFromX} x2={dimensionX} y1={y2} y2={y2} />
      <line
        markerEnd={`url(#${markerId})`}
        markerStart={`url(#${markerId})`}
        x1={dimensionX}
        x2={dimensionX}
        y1={y1 + 2}
        y2={y2 - 2}
      />
      <text
        fill={DIMENSION_STROKE}
        fontSize="10.5"
        stroke="none"
        textAnchor="middle"
        transform={`rotate(-90 ${dimensionX - 7} ${centerY})`}
        x={dimensionX - 7}
        y={centerY}
      >
        {label}
      </text>
    </g>
  );
}

function Callout({
  sourceX,
  sourceY,
  targetY,
  label,
}: {
  sourceX: number;
  sourceY: number;
  targetY: number;
  label: string;
}) {
  return (
    <g>
      <circle cx={sourceX} cy={sourceY} fill={DIMENSION_STROKE} r="1.8" />
      <polyline
        fill="none"
        points={`${sourceX},${sourceY} 436,${targetY} 444,${targetY}`}
        stroke={DIMENSION_STROKE}
        strokeWidth="1"
      />
      <text fill={DIMENSION_STROKE} fontSize="9.5" x="448" y={targetY + 3.2}>
        {label}
      </text>
    </g>
  );
}

function ArrowMarker({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        markerHeight="5"
        markerWidth="5"
        orient="auto-start-reverse"
        refX="2.5"
        refY="2.5"
        viewBox="0 0 5 5"
      >
        <path d="M 5 0 L 0 2.5 L 5 5 z" fill={DIMENSION_STROKE} />
      </marker>
    </defs>
  );
}

function useMarkerId(prefix: string) {
  const reactId = React.useId();
  return `${prefix}-${reactId.replace(/:/g, "")}`;
}

function formatDimension(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
}

function positiveOr(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeOr(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
