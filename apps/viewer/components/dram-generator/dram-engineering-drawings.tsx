"use client";

import * as React from "react";

import {
  deriveDramDimensions,
  MAX_DRAM_CORE_DIE_COUNT,
  type DramGeneratorParameters,
} from "@/lib/dram-generator";

const MOLDING_FILL = "#dcefeb";
const MOLDING_STROKE = "#0f766e";
const DIE_FILL = "#f4cf68";
const DIE_STROKE = "#8a6413";
const DIELECTRIC_FILL = "#dceeff";
const DIELECTRIC_STROKE = "#2563a6";
const CIRCUIT_STROKE = "#16845b";
const CORE_FILL = "#d8dee8";
const CORE_STROKE = "#566579";
const SOLDER_MASK_FILL = "#d7c6e8";
const SOLDER_MASK_STROKE = "#73518d";
const DIMENSION_STROKE = "#334155";
const CENTER_LINE = "#64748b";

export function DramTopViewDrawing({
  parameters,
}: {
  parameters: DramGeneratorParameters;
}) {
  const markerId = useSvgId("dram-top-arrow");
  const packageX = positiveOr(parameters.packageX, 1);
  const packageY = positiveOr(parameters.packageY, 1);
  const coreX = clamp(positiveOr(parameters.coreDieX, packageX * 0.5), 1, packageX);
  const coreY = clamp(positiveOr(parameters.coreDieY, packageY * 0.5), 1, packageY);
  const dimensions = deriveDramDimensions({
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
      aria-label={`DRAM top view. Package ${formatDimension(packageX)} by ${formatDimension(packageY)} micrometres. Centered core die ${formatDimension(coreX)} by ${formatDimension(coreY)} micrometres.`}
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
        y={29}
      />
      <HorizontalDimension
        extensionFromY={outerY + outerHeight}
        label={`Package / SBT X  ${formatDimension(packageX)} µm`}
        markerId={markerId}
        x1={outerX}
        x2={outerX + outerWidth}
        y={250}
      />
      <VerticalDimension
        extensionFromX={outerX}
        label={`Package / SBT Y  ${formatDimension(packageY)} µm`}
        markerId={markerId}
        x={49}
        y1={outerY}
        y2={outerY + outerHeight}
      />
      <VerticalDimension
        extensionFromX={outerX + outerWidth}
        label={`Core die Y  ${formatDimension(coreY)} µm`}
        markerId={markerId}
        x={461}
        y1={coreTop}
        y2={coreTop + coreHeight}
      />
      <text fill={DIMENSION_STROKE} fontSize="10.5" textAnchor="middle" x="255" y="284">
        {`Side molding X  ${formatDimension(dimensions.sideMoldingX)} µm / side`}
      </text>
      <text fill={DIMENSION_STROKE} fontSize="10.5" textAnchor="middle" x="255" y="301">
        {`Side molding Y  ${formatDimension(dimensions.sideMoldingY)} µm / side`}
      </text>
    </svg>
  );
}

type DisplaySegment = {
  key: string;
  label: string;
  bottomZ: number;
  thickness: number;
  fill: string;
  stroke: string;
  circuit: boolean;
};

export function DramCrossSectionDrawing({
  parameters,
}: {
  parameters: DramGeneratorParameters;
}) {
  const markerId = useSvgId("dram-section-arrow");
  const circuitPatternId = useSvgId("dram-circuit-pattern");
  const packageX = positiveOr(parameters.packageX, 1);
  const coreX = clamp(positiveOr(parameters.coreDieX, packageX * 0.5), 1, packageX);
  const coreThickness = positiveOr(parameters.coreDieThickness, 1);
  const dieGap = nonNegativeOr(parameters.dieGapThickness, 0);
  const topMolding = nonNegativeOr(parameters.topMoldingThickness, 0);
  const coreCount = clamp(
    Number.isInteger(parameters.coreDieCount) ? parameters.coreDieCount : 1,
    1,
    MAX_DRAM_CORE_DIE_COUNT,
  );
  const bottomMaskThickness = positiveOr(parameters.bottomSolderMaskThickness, 1);
  const topMaskThickness = positiveOr(parameters.topSolderMaskThickness, 1);
  const coreLayerThickness = positiveOr(parameters.sbtCoreLayerThickness, 1);
  const bottomLayers = parameters.bottomBuildupLayers.map((layer) => ({
    ...layer,
    thickness: positiveOr(layer.thickness, 1),
  }));
  const topLayers = parameters.topBuildupLayers.map((layer) => ({
    ...layer,
    thickness: positiveOr(layer.thickness, 1),
  }));

  const segments: DisplaySegment[] = [];
  let cursorZ = 0;
  segments.push({
    key: "bottom-mask",
    label: "Bottom SM",
    bottomZ: cursorZ,
    thickness: bottomMaskThickness,
    fill: SOLDER_MASK_FILL,
    stroke: SOLDER_MASK_STROKE,
    circuit: false,
  });
  cursorZ += bottomMaskThickness;
  for (let index = bottomLayers.length - 1; index >= 0; index -= 1) {
    const layer = bottomLayers[index];
    segments.push({
      key: `bottom-${index + 1}`,
      label: `B${index + 1}`,
      bottomZ: cursorZ,
      thickness: layer.thickness,
      fill: DIELECTRIC_FILL,
      stroke: DIELECTRIC_STROKE,
      circuit: (index + 1) % 2 === 0,
    });
    cursorZ += layer.thickness;
  }
  const coreLayerBottomZ = cursorZ;
  segments.push({
    key: "sbt-core",
    label: "SBT core layer",
    bottomZ: cursorZ,
    thickness: coreLayerThickness,
    fill: CORE_FILL,
    stroke: CORE_STROKE,
    circuit: false,
  });
  cursorZ += coreLayerThickness;
  topLayers.forEach((layer, index) => {
    segments.push({
      key: `top-${index + 1}`,
      label: `T${index + 1}`,
      bottomZ: cursorZ,
      thickness: layer.thickness,
      fill: DIELECTRIC_FILL,
      stroke: DIELECTRIC_STROKE,
      circuit: (index + 1) % 2 === 0,
    });
    cursorZ += layer.thickness;
  });
  const topMaskBottomZ = cursorZ;
  segments.push({
    key: "top-mask",
    label: "Top SM",
    bottomZ: cursorZ,
    thickness: topMaskThickness,
    fill: SOLDER_MASK_FILL,
    stroke: SOLDER_MASK_STROKE,
    circuit: false,
  });
  cursorZ += topMaskThickness;
  const sbtThickness = cursorZ;
  const totalThickness =
    sbtThickness +
    coreCount * coreThickness +
    coreCount * dieGap +
    topMolding;

  const rootX = 96;
  const rootY = 26;
  const rootWidth = 326;
  const rootHeight = 258;
  const rootBottom = rootY + rootHeight;
  const zScale = rootHeight / Math.max(1, totalThickness);
  const yAtZ = (z: number) => rootBottom - z * zScale;
  const coreWidth = Math.max(36, rootWidth * (coreX / packageX));
  const coreLeft = rootX + (rootWidth - coreWidth) / 2;
  const coreRight = coreLeft + coreWidth;
  const sbtTopY = yAtZ(sbtThickness);
  const coreRects = Array.from({ length: coreCount }, (_, index) => {
    const bottomZ = sbtThickness + dieGap + index * (coreThickness + dieGap);
    return {
      index,
      y: yAtZ(bottomZ + coreThickness),
      height: Math.max(1.5, coreThickness * zScale),
      bottomZ,
    };
  });
  const topCore = coreRects.at(-1)!;
  const firstCore = coreRects[0];

  return (
    <svg
      aria-label={`DRAM cross section with ${coreCount} core dies, ${topLayers.length} top buildup layers, ${bottomLayers.length} bottom buildup layers, and total thickness ${formatDimension(totalThickness)} micrometres.`}
      className="h-auto w-full"
      role="img"
      viewBox="0 0 610 350"
    >
      <defs>
        <pattern
          height="6"
          id={circuitPatternId}
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
          width="6"
        >
          <line stroke={CIRCUIT_STROKE} strokeWidth="2" x1="0" x2="0" y1="0" y2="6" />
        </pattern>
      </defs>
      <ArrowMarker id={markerId} />

      <rect
        fill={MOLDING_FILL}
        height={sbtTopY - rootY}
        stroke={MOLDING_STROKE}
        strokeWidth="2"
        width={rootWidth}
        x={rootX}
        y={rootY}
      />
      {segments.map((segment) => {
        const y = yAtZ(segment.bottomZ + segment.thickness);
        const height = Math.max(1.2, segment.thickness * zScale);
        return (
          <g key={segment.key}>
            <rect
              fill={segment.fill}
              height={height}
              stroke={segment.stroke}
              strokeWidth="1"
              width={rootWidth}
              x={rootX}
              y={y}
            />
            {segment.circuit ? (
              <rect
                fill={`url(#${circuitPatternId})`}
                height={height}
                opacity="0.8"
                width={rootWidth}
                x={rootX}
                y={y}
              />
            ) : null}
            {height >= 11 ? (
              <text
                fill={DIMENSION_STROKE}
                fontSize="8.5"
                textAnchor="middle"
                x={rootX + rootWidth / 2}
                y={y + height / 2 + 3}
              >
                {segment.label}
              </text>
            ) : null}
          </g>
        );
      })}
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
          {core.height >= 12 ? (
            <text
              fill="#5f470f"
              fontSize="8.5"
              textAnchor="middle"
              x={coreLeft + coreWidth / 2}
              y={core.y + core.height / 2 + 3}
            >
              {`Core ${core.index + 1}`}
            </text>
          ) : null}
        </g>
      ))}
      <rect
        fill="none"
        height={rootHeight}
        stroke={DIMENSION_STROKE}
        strokeWidth="1.5"
        width={rootWidth}
        x={rootX}
        y={rootY}
      />

      <Callout
        label={`Top molding  ${formatDimension(topMolding)} µm`}
        sourceX={rootX + rootWidth / 2}
        sourceY={(rootY + topCore.y) / 2}
        targetY={42}
      />
      <Callout
        label={`Core die thk  ${formatDimension(coreThickness)} µm`}
        sourceX={coreRight}
        sourceY={topCore.y + topCore.height / 2}
        targetY={78}
      />
      <Callout
        label={`Molding gap  ${formatDimension(dieGap)} µm`}
        sourceX={coreRight}
        sourceY={(sbtTopY + firstCore.y + firstCore.height) / 2}
        targetY={114}
      />
      <Callout
        label={`Top SM  ${formatDimension(topMaskThickness)} µm`}
        sourceX={rootX + rootWidth}
        sourceY={yAtZ(topMaskBottomZ + topMaskThickness / 2)}
        targetY={174}
      />
      <Callout
        label={`Core layer  ${formatDimension(coreLayerThickness)} µm`}
        sourceX={rootX + rootWidth}
        sourceY={yAtZ(coreLayerBottomZ + coreLayerThickness / 2)}
        targetY={214}
      />
      <Callout
        label={`Bottom SM  ${formatDimension(bottomMaskThickness)} µm`}
        sourceX={rootX + rootWidth}
        sourceY={yAtZ(bottomMaskThickness / 2)}
        targetY={254}
      />
      <VerticalDimension
        extensionFromX={rootX}
        label={`SBT  ${formatDimension(sbtThickness)} µm`}
        markerId={markerId}
        x={62}
        y1={sbtTopY}
        y2={rootBottom}
      />
      <VerticalDimension
        extensionFromX={rootX + rootWidth}
        label={`Total  ${formatDimension(totalThickness)} µm`}
        markerId={markerId}
        x={588}
        y1={rootY}
        y2={rootBottom}
      />
      <text fill={CENTER_LINE} fontSize="9.5" textAnchor="middle" x="275" y="316">
        {`${topLayers.length} top layers · ${bottomLayers.length} bottom layers · striped even layers contain circuit density`}
      </text>
      <g transform="translate(155 331)">
        <rect fill={DIELECTRIC_FILL} height="8" stroke={DIELECTRIC_STROKE} width="22" />
        <text fill={DIMENSION_STROKE} fontSize="8.5" x="28" y="7">
          Dielectric
        </text>
        <rect
          fill={`url(#${circuitPatternId})`}
          height="8"
          stroke={CIRCUIT_STROKE}
          width="22"
          x="102"
        />
        <text fill={DIMENSION_STROKE} fontSize="8.5" x="130" y="7">
          Dielectric + circuit
        </text>
      </g>
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
  y: number;
  extensionFromY: number;
  label: string;
  markerId: string;
}) {
  return (
    <g fill="none" stroke={DIMENSION_STROKE} strokeWidth="1">
      <line x1={x1} x2={x1} y1={extensionFromY} y2={y} />
      <line x1={x2} x2={x2} y1={extensionFromY} y2={y} />
      <line
        markerEnd={`url(#${markerId})`}
        markerStart={`url(#${markerId})`}
        x1={x1 + 2}
        x2={x2 - 2}
        y1={y}
        y2={y}
      />
      <text
        fill={DIMENSION_STROKE}
        fontSize="10.5"
        stroke="none"
        textAnchor="middle"
        x={(x1 + x2) / 2}
        y={y - 6}
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
  x: number;
  y1: number;
  y2: number;
  extensionFromX: number;
  label: string;
  markerId: string;
}) {
  const centerY = (y1 + y2) / 2;
  return (
    <g fill="none" stroke={DIMENSION_STROKE} strokeWidth="1">
      <line x1={extensionFromX} x2={x} y1={y1} y2={y1} />
      <line x1={extensionFromX} x2={x} y1={y2} y2={y2} />
      <line
        markerEnd={`url(#${markerId})`}
        markerStart={`url(#${markerId})`}
        x1={x}
        x2={x}
        y1={y1 + 2}
        y2={y2 - 2}
      />
      <text
        fill={DIMENSION_STROKE}
        fontSize="10"
        stroke="none"
        textAnchor="middle"
        transform={`rotate(-90 ${x - 7} ${centerY})`}
        x={x - 7}
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
        points={`${sourceX},${sourceY} 440,${targetY} 448,${targetY}`}
        stroke={DIMENSION_STROKE}
        strokeWidth="1"
      />
      <text fill={DIMENSION_STROKE} fontSize="9.5" x="452" y={targetY + 3.2}>
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

function useSvgId(prefix: string) {
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
