"use client";

import * as React from "react";
import { type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import type { BoundsTuple } from "@/components/viewer/model-loader";

export type FeatureKind = "via" | "circuit" | "bump";
export type FeatureOverlayMode = "auto" | "summary" | "detail";

export type FeatureOverlaySettings = {
  enabled: boolean;
  showBumps: boolean;
  showVias: boolean;
  showCircuits: boolean;
  mode: FeatureOverlayMode;
  densityScale: number;
  glyphSizeScale: number;
  opacity: number;
  maxInstances: number;
};

export type PreviewFeature = {
  id: string;
  type: FeatureKind;
  material: string;
  density: number;
  normalizedDensity: number;
  direction: "+z" | "-z" | null;
  geometry: PreviewGeometry;
  bounds: BoundsTuple;
  containerId: string;
  containerKey: string;
  containerPath: string;
};

export type FeatureSummary = {
  total: number;
  bumps: number;
  vias: number;
  circuits: number;
  densityMin: number | null;
  densityMax: number | null;
};

type GeometryFeatureOverlayProps = {
  features: PreviewFeature[];
  bounds: BoundsTuple;
  settings: FeatureOverlaySettings;
  selectedFeatureId: string | null;
  hoveredFeatureId: string | null;
  interactive: boolean;
  onSelectFeature: (featureId: string | null) => void;
  onHoverFeature?: (featureId: string | null) => void;
};

type PreviewGeometry =
  | {
      type: "box";
      min: [number, number, number];
      max: [number, number, number];
    }
  | {
      type: "cylinder";
      center: [number, number, number];
      radius: number;
      height: number;
    }
  | {
      type: "cone";
      center: [number, number, number];
      bottomRadius: number;
      topRadius: number;
      height: number;
    }
  | {
      type: "polygon";
      loops: [number, number, number][][];
      zMin: number;
      height: number;
    };

type FeatureContainerContext = {
  id: string;
  key: string;
  path: string;
};

type GlyphSample = {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Quaternion;
  featureId: string;
};

const FEATURE_COLORS: Record<FeatureKind, string> = {
  via: "#12a8c6",
  circuit: "#2ea85d",
  bump: "#d8ad2f",
};

const FEATURE_LABELS: Record<FeatureKind, string> = {
  via: "Via",
  circuit: "Circuit",
  bump: "Bump",
};

const CYLINDER_TO_Z = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI / 2, 0, 0),
);

const NO_ROTATION = new THREE.Quaternion();

export function GeometryFeatureOverlay({
  features,
  bounds,
  settings,
  selectedFeatureId,
  hoveredFeatureId,
  interactive,
  onSelectFeature,
  onHoverFeature,
}: GeometryFeatureOverlayProps) {
  const visibleFeatures = React.useMemo(
    () => filterVisibleFeatures(features, settings),
    [features, settings],
  );
  const detailSamples = React.useMemo(
    () =>
      shouldRenderDetail(visibleFeatures, bounds, settings)
        ? buildDetailSamples(visibleFeatures, bounds, settings)
        : { bumps: [], vias: [], circuits: [] },
    [bounds, settings, visibleFeatures],
  );
  if (!settings.enabled || visibleFeatures.length === 0) {
    return null;
  }

  return (
    <group name="geometry-feature-overlay" renderOrder={40}>
      {visibleFeatures.map((feature) => (
        <SummaryFeatureMesh
          key={feature.id}
          feature={feature}
          settings={settings}
          selected={feature.id === selectedFeatureId}
          hovered={feature.id === hoveredFeatureId}
          interactive={interactive}
          onSelectFeature={onSelectFeature}
          onHoverFeature={onHoverFeature}
        />
      ))}
      <CircuitHatchOverlay
        features={visibleFeatures.filter((feature) => feature.type === "circuit")}
        bounds={bounds}
        settings={settings}
      />
      <InstancedFeatureGlyphs
        kind="bump"
        samples={detailSamples.bumps}
        settings={settings}
      />
      <InstancedFeatureGlyphs
        kind="via"
        samples={detailSamples.vias}
        settings={settings}
      />
      <InstancedFeatureGlyphs
        kind="circuit"
        samples={detailSamples.circuits}
        settings={settings}
      />
    </group>
  );
}

export function extractPreviewFeatures(structure: unknown): PreviewFeature[] {
  const root = asRecord(structure)?.root;
  if (!isRecord(root)) return [];

  const features: PreviewFeature[] = [];
  visitContainer(root, {
    id: stringValue(root.id, "root"),
    key: stringValue(root.key, "root"),
    path: stringValue(root.key, "root"),
  });

  return features;

  function visitContainer(container: Record<string, unknown>, context: FeatureContainerContext) {
    appendFeatureArray(container.vias, "via", context);
    appendFeatureArray(container.circuits, "circuit", context);
    appendFeatureArray(container.bumps, "bump", context);

    const children = Array.isArray(container.children) ? container.children : [];
    children.forEach((child, index) => {
      if (!isRecord(child)) return;
      const childKey = stringValue(child.key, `child-${index + 1}`);
      const childId = stringValue(child.id, `${context.id}/${childKey}`);
      visitContainer(child, {
        id: childId,
        key: childKey,
        path: `${context.path}/${childKey}`,
      });
    });
  }

  function appendFeatureArray(
    value: unknown,
    type: FeatureKind,
    context: FeatureContainerContext,
  ) {
    const items = Array.isArray(value) ? value : [];
    items.forEach((item, index) => {
      if (!isRecord(item)) return;
      const geometry = parseFeatureGeometry(item.geometry);
      if (!geometry) return;

      const density = finiteNumber(item.density, 0);
      const id = stringValue(item.id, `${context.id}:${type}:${index + 1}`);
      const material = stringValue(item.material, "feature");
      const direction = item.direction === "+z" || item.direction === "-z"
        ? item.direction
        : null;

      features.push({
        id,
        type,
        material,
        density,
        normalizedDensity: normalizeDensity(density),
        direction,
        geometry,
        bounds: geometryBounds(geometry),
        containerId: context.id,
        containerKey: context.key,
        containerPath: context.path,
      });
    });
  }
}

export function extractPreviewGeometryBounds(
  structure: unknown,
): BoundsTuple | null {
  const root = asRecord(structure)?.root;
  if (!isRecord(root)) return null;

  const geometryBoundsList: BoundsTuple[] = [];
  visitContainer(root);
  if (geometryBoundsList.length === 0) return null;

  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  geometryBoundsList.forEach((bounds) => {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
  });
  return boundsFromMinMax(min, max);

  function visitContainer(container: Record<string, unknown>) {
    ["bodies"].forEach((collection) => {
      const items = Array.isArray(container[collection])
        ? container[collection]
        : [];
      items.forEach((item) => {
        if (!isRecord(item)) return;
        const geometry = parseFeatureGeometry(item.geometry);
        if (geometry) geometryBoundsList.push(geometryBounds(geometry));
      });
    });

    const children = Array.isArray(container.children) ? container.children : [];
    children.forEach((child) => {
      if (isRecord(child)) visitContainer(child);
    });
  }
}

export function summarizeFeatures(features: PreviewFeature[]): FeatureSummary {
  let densityMin: number | null = null;
  let densityMax: number | null = null;
  const summary: FeatureSummary = {
    total: features.length,
    bumps: 0,
    vias: 0,
    circuits: 0,
    densityMin,
    densityMax,
  };

  features.forEach((feature) => {
    if (feature.type === "bump") summary.bumps += 1;
    if (feature.type === "via") summary.vias += 1;
    if (feature.type === "circuit") summary.circuits += 1;

    densityMin =
      densityMin === null ? feature.density : Math.min(densityMin, feature.density);
    densityMax =
      densityMax === null ? feature.density : Math.max(densityMax, feature.density);
  });

  summary.densityMin = densityMin;
  summary.densityMax = densityMax;
  return summary;
}

export function formatFeatureKind(kind: FeatureKind) {
  return FEATURE_LABELS[kind];
}

export function formatDensityPercent(value: number) {
  const percent = normalizeDensity(value) * 100;
  const digits = percent >= 10 || percent === 0 ? 0 : 1;
  return `${percent.toFixed(digits)}%`;
}

function SummaryFeatureMesh({
  feature,
  settings,
  selected,
  hovered,
  interactive,
  onSelectFeature,
  onHoverFeature,
}: {
  feature: PreviewFeature;
  settings: FeatureOverlaySettings;
  selected: boolean;
  hovered: boolean;
  interactive: boolean;
  onSelectFeature: (featureId: string | null) => void;
  onHoverFeature?: (featureId: string | null) => void;
}) {
  const geometry = React.useMemo(
    () => createEnvelopeGeometry(feature.geometry),
    [feature.geometry],
  );
  const material = React.useMemo(
    () => {
      const highlighted = selected || hovered;
      return new THREE.MeshBasicMaterial({
        color: FEATURE_COLORS[feature.type],
        wireframe: !highlighted,
        transparent: highlighted,
        opacity: highlighted ? clamp(settings.opacity * 0.35, 0.1, 0.35) : 1,
        depthTest: true,
        depthWrite: false,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        toneMapped: false,
      });
    },
    [feature.type, hovered, selected, settings.opacity],
  );

  React.useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const handleClick = React.useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (!interactive) return;
      event.stopPropagation();
      onSelectFeature(selected ? null : feature.id);
    },
    [feature.id, interactive, onSelectFeature, selected],
  );

  const handlePointerOver = React.useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!interactive) return;
      event.stopPropagation();
      onHoverFeature?.(feature.id);
    },
    [feature.id, interactive, onHoverFeature],
  );

  const handlePointerOut = React.useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!interactive) return;
      event.stopPropagation();
      onHoverFeature?.(null);
    },
    [interactive, onHoverFeature],
  );

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={selected ? 47 : 42}
      raycast={interactive ? undefined : disabledRaycast}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    />
  );
}

function CircuitHatchOverlay({
  features,
  bounds,
  settings,
}: {
  features: PreviewFeature[];
  bounds: BoundsTuple;
  settings: FeatureOverlaySettings;
}) {
  const line = React.useMemo(() => {
    const points: THREE.Vector3[] = [];
    features.forEach((feature) => {
      points.push(...createCircuitHatchPoints(feature, bounds, settings));
    });

    if (points.length === 0) return null;

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: FEATURE_COLORS.circuit,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
    });
    const object = new THREE.LineSegments(geometry, material);
    object.renderOrder = 48;
    object.raycast = disabledRaycast;
    return object;
  }, [bounds, features, settings]);

  React.useEffect(() => {
    return () => {
      if (!line) return;
      line.geometry.dispose();
      if (line.material instanceof THREE.Material) {
        line.material.dispose();
      }
    };
  }, [line]);

  return line ? <primitive object={line} /> : null;
}

function InstancedFeatureGlyphs({
  kind,
  samples,
  settings,
}: {
  kind: FeatureKind;
  samples: GlyphSample[];
  settings: FeatureOverlaySettings;
}) {
  const mesh = React.useMemo(() => {
    if (samples.length === 0) return null;

    const geometry = createGlyphGeometry(kind);
    const material = new THREE.MeshBasicMaterial({
      color: FEATURE_COLORS[kind],
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    const object = new THREE.InstancedMesh(geometry, material, samples.length);
    object.name = `feature-${kind}-glyphs`;
    object.renderOrder = 50;
    object.raycast = disabledRaycast;

    const matrix = new THREE.Matrix4();
    samples.forEach((sample, index) => {
      matrix.compose(sample.position, sample.rotation, sample.scale);
      object.setMatrixAt(index, matrix);
    });
    object.instanceMatrix.needsUpdate = true;
    return object;
  }, [kind, samples]);

  React.useEffect(() => {
    return () => {
      if (!mesh) return;
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    };
  }, [mesh]);

  return mesh ? <primitive object={mesh} /> : null;
}

function filterVisibleFeatures(
  features: PreviewFeature[],
  settings: FeatureOverlaySettings,
) {
  if (!settings.enabled) return [];
  return features.filter((feature) => {
    if (feature.type === "bump") return settings.showBumps;
    if (feature.type === "via") return settings.showVias;
    return settings.showCircuits;
  });
}

function shouldRenderDetail(
  features: PreviewFeature[],
  bounds: BoundsTuple,
  settings: FeatureOverlaySettings,
) {
  if (settings.mode === "summary") return false;
  if (settings.mode === "detail") return true;

  const estimate = estimateDetailInstanceCount(features, bounds, settings);
  return estimate <= settings.maxInstances && features.length <= 64;
}

function estimateDetailInstanceCount(
  features: PreviewFeature[],
  bounds: BoundsTuple,
  settings: FeatureOverlaySettings,
) {
  return features.reduce((total, feature) => {
    return total + estimateFeatureSampleCount(feature, bounds, settings);
  }, 0);
}

function buildDetailSamples(
  features: PreviewFeature[],
  bounds: BoundsTuple,
  settings: FeatureOverlaySettings,
) {
  const result: Record<FeatureKind, GlyphSample[]> = {
    bump: [],
    via: [],
    circuit: [],
  };
  if (features.length === 0) return { bumps: [], vias: [], circuits: [] };

  const perFeatureLimit = Math.max(
    4,
    Math.floor(settings.maxInstances / features.length),
  );

  features.forEach((feature) => {
    const remaining = settings.maxInstances - totalSamples(result);
    if (remaining <= 0) return;
    const samples = createFeatureSamples(
      feature,
      bounds,
      settings,
      Math.min(perFeatureLimit, remaining),
    );
    result[feature.type].push(...samples);
  });

  return {
    bumps: result.bump,
    vias: result.via,
    circuits: result.circuit,
  };
}

function totalSamples(samples: Record<FeatureKind, GlyphSample[]>) {
  return samples.bump.length + samples.via.length + samples.circuit.length;
}

function estimateFeatureSampleCount(
  feature: PreviewFeature,
  bounds: BoundsTuple,
  settings: FeatureOverlaySettings,
) {
  const grid = featureGridDimensions(feature, bounds, settings);
  return Math.max(1, grid.x * grid.y);
}

function createFeatureSamples(
  feature: PreviewFeature,
  bounds: BoundsTuple,
  settings: FeatureOverlaySettings,
  limit: number,
) {
  const grid = featureGridDimensions(feature, bounds, settings);
  const positions = sampleFeatureFootprint(feature, grid.x, grid.y, limit);
  const featureSize = feature.bounds.size;
  const maxDim = Math.max(...bounds.size, 1);
  const featureMaxXY = Math.max(featureSize[0], featureSize[1], 1);
  const density = effectiveDensity(feature, settings);
  const baseRadius = clamp(
    featureMaxXY / Math.max(grid.x, grid.y, 1) * 0.24,
    maxDim * 0.001,
    maxDim * 0.03,
  );
  const glyphRadius = baseRadius * settings.glyphSizeScale * (0.65 + density * 0.45);
  const height = Math.max(featureSize[2], glyphRadius * 1.2);
  const circuitDepth = circuitGlyphDepth(featureSize[2], glyphRadius);
  const circuitScale = circuitGlyphScale(featureSize, grid, glyphRadius, circuitDepth);
  const bumpRadius = Math.max(glyphRadius, featureSize[2] / 2);

  return positions.map(({ x, y, z }, index) => {
    const rotation =
      feature.type === "via"
        ? CYLINDER_TO_Z
        : feature.type === "circuit"
          ? circuitRotation(index)
          : NO_ROTATION;
    const scale =
      feature.type === "via"
        ? new THREE.Vector3(glyphRadius, height, glyphRadius)
        : feature.type === "circuit"
          ? circuitScale
          : new THREE.Vector3(bumpRadius, bumpRadius, bumpRadius);

    return {
      position: new THREE.Vector3(x, y, z),
      rotation,
      scale,
      featureId: feature.id,
    };
  });
}

function featureGridDimensions(
  feature: PreviewFeature,
  bounds: BoundsTuple,
  settings: FeatureOverlaySettings,
) {
  const density = effectiveDensity(feature, settings);
  const sceneMaxXY = Math.max(bounds.size[0], bounds.size[1], 1);
  const pitch = sceneMaxXY / (14 + density * 82);
  const sx = Math.max(feature.bounds.size[0], pitch);
  const sy = Math.max(feature.bounds.size[1], pitch);
  const x = clampInteger(Math.round(sx / pitch), 1, 90);
  const y = clampInteger(Math.round(sy / pitch), 1, 90);
  return { x, y };
}

function effectiveDensity(
  feature: PreviewFeature,
  settings: FeatureOverlaySettings,
) {
  return clamp(feature.normalizedDensity * settings.densityScale, 0.02, 1);
}

function sampleFeatureFootprint(
  feature: PreviewFeature,
  xCount: number,
  yCount: number,
  limit: number,
) {
  const { min, max, center } = feature.bounds;
  const samples: { x: number; y: number; z: number }[] = [];
  const z = center[2];

  for (let yi = 0; yi < yCount; yi += 1) {
    for (let xi = 0; xi < xCount; xi += 1) {
      const x = lerp(min[0], max[0], (xi + 0.5) / xCount);
      const y = lerp(min[1], max[1], (yi + 0.5) / yCount);
      if (!pointInsideFeatureFootprint(feature, x, y)) continue;
      samples.push({ x, y, z });
    }
  }

  if (samples.length <= limit) return samples;

  const stride = samples.length / limit;
  const limited: { x: number; y: number; z: number }[] = [];
  for (let index = 0; index < limit; index += 1) {
    limited.push(samples[Math.floor(index * stride)]);
  }
  return limited;
}

function pointInsideFeatureFootprint(feature: PreviewFeature, x: number, y: number) {
  const geometry = feature.geometry;
  if (geometry.type === "cylinder") {
    return pointInsideCircle(x, y, geometry.center[0], geometry.center[1], geometry.radius);
  }
  if (geometry.type === "cone") {
    return pointInsideCircle(
      x,
      y,
      geometry.center[0],
      geometry.center[1],
      Math.max(geometry.bottomRadius, geometry.topRadius),
    );
  }
  if (geometry.type === "polygon") {
    return pointInsidePolygonLoops(x, y, geometry.loops);
  }
  return (
    x >= feature.bounds.min[0] &&
    x <= feature.bounds.max[0] &&
    y >= feature.bounds.min[1] &&
    y <= feature.bounds.max[1]
  );
}

function createCircuitHatchPoints(
  feature: PreviewFeature,
  bounds: BoundsTuple,
  settings: FeatureOverlaySettings,
) {
  const density = effectiveDensity(feature, settings);
  const sceneMaxXY = Math.max(bounds.size[0], bounds.size[1], 1);
  const pitch = sceneMaxXY / (12 + density * 56);
  const { min, max, size } = feature.bounds;
  const z = min[2] + size[2] * 0.5;
  const points: THREE.Vector3[] = [];
  const span = Math.max(size[0], size[1], pitch);
  const lineLength = Math.min(span * 0.82, pitch * 5);
  const yCount = clampInteger(Math.round(Math.max(size[1], pitch) / pitch), 1, 120);
  const xCount = clampInteger(Math.round(Math.max(size[0], pitch) / pitch), 1, 120);
  const maxLines = Math.min(settings.maxInstances, 500);
  let lineIndex = 0;

  for (let yi = 0; yi < yCount; yi += 1) {
    for (let xi = 0; xi < xCount; xi += 1) {
      if (lineIndex >= maxLines) return points;
      const x = lerp(min[0], max[0], (xi + 0.5) / xCount);
      const y = lerp(min[1], max[1], (yi + 0.5) / yCount);
      if (!pointInsideFeatureFootprint(feature, x, y)) continue;
      points.push(...createClippedCircuitHatchSegment(feature, x, y, z, lineLength));
      lineIndex += 1;
    }
  }
  return points;
}

function createClippedCircuitHatchSegment(
  feature: PreviewFeature,
  x: number,
  y: number,
  z: number,
  lineLength: number,
) {
  const center = { x, y };
  const start = { x: x - lineLength * 0.5, y: y - lineLength * 0.18 };
  const end = { x: x + lineLength * 0.5, y: y + lineLength * 0.18 };
  const clippedStart = clipEndpointToFeatureFootprint(feature, center, start);
  const clippedEnd = clipEndpointToFeatureFootprint(feature, center, end);

  if (distance2D(clippedStart, clippedEnd) <= 0.001) {
    return [];
  }

  return [
    new THREE.Vector3(clippedStart.x, clippedStart.y, z),
    new THREE.Vector3(clippedEnd.x, clippedEnd.y, z),
  ];
}

function clipEndpointToFeatureFootprint(
  feature: PreviewFeature,
  insidePoint: { x: number; y: number },
  candidate: { x: number; y: number },
) {
  if (pointInsideFeatureFootprint(feature, candidate.x, candidate.y)) {
    return candidate;
  }

  let inside = insidePoint;
  let outside = candidate;
  for (let index = 0; index < 24; index += 1) {
    const midpoint = {
      x: (inside.x + outside.x) / 2,
      y: (inside.y + outside.y) / 2,
    };
    if (pointInsideFeatureFootprint(feature, midpoint.x, midpoint.y)) {
      inside = midpoint;
    } else {
      outside = midpoint;
    }
  }
  return inside;
}

function distance2D(
  left: { x: number; y: number },
  right: { x: number; y: number },
) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function createEnvelopeGeometry(geometry: PreviewGeometry) {
  if (geometry.type === "box") {
    const bounds = geometryBounds(geometry);
    const box = new THREE.BoxGeometry(
      Math.max(bounds.size[0], 0.001),
      Math.max(bounds.size[1], 0.001),
      Math.max(bounds.size[2], 0.001),
    );
    box.translate(...bounds.center);
    return box;
  }

  if (geometry.type === "cylinder") {
    const cylinder = new THREE.CylinderGeometry(
      geometry.radius,
      geometry.radius,
      Math.max(geometry.height, 0.001),
      40,
      1,
    );
    cylinder.applyQuaternion(CYLINDER_TO_Z);
    cylinder.translate(
      geometry.center[0],
      geometry.center[1],
      geometry.center[2] + geometry.height / 2,
    );
    return cylinder;
  }

  if (geometry.type === "cone") {
    const cone = new THREE.CylinderGeometry(
      geometry.topRadius,
      geometry.bottomRadius,
      Math.max(geometry.height, 0.001),
      40,
      1,
    );
    cone.applyQuaternion(CYLINDER_TO_Z);
    cone.translate(
      geometry.center[0],
      geometry.center[1],
      geometry.center[2] + geometry.height / 2,
    );
    return cone;
  }

  const shapes = geometry.loops
    .filter((loop) => loop.length >= 3)
    .map((loop) => {
      const shape = new THREE.Shape();
      loop.forEach((point, index) => {
        if (index === 0) shape.moveTo(point[0], point[1]);
        else shape.lineTo(point[0], point[1]);
      });
      shape.closePath();
      return shape;
    });

  if (shapes.length === 0) {
    return new THREE.BoxGeometry(0.001, 0.001, 0.001);
  }

  const polygon = new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(geometry.height, 0.001),
    bevelEnabled: false,
  });
  polygon.translate(0, 0, geometry.zMin);
  return polygon;
}

function circuitGlyphDepth(featureThickness: number, glyphRadius: number) {
  const thickness = Math.max(featureThickness, 0.001);
  return clamp(glyphRadius * 0.3, thickness * 0.12, thickness * 0.72);
}

function circuitGlyphScale(
  featureSize: [number, number, number],
  grid: { x: number; y: number },
  glyphRadius: number,
  circuitDepth: number,
) {
  const cellWidth = Math.max(featureSize[0] / Math.max(grid.x, 1), 0.001);
  const cellHeight = Math.max(featureSize[1] / Math.max(grid.y, 1), 0.001);
  return new THREE.Vector3(
    Math.min(glyphRadius * 4.2, cellWidth * 0.62),
    Math.min(glyphRadius * 0.72, cellHeight * 0.38),
    circuitDepth,
  );
}

function createGlyphGeometry(kind: FeatureKind) {
  if (kind === "via") {
    return new THREE.CylinderGeometry(1, 1, 1, 16, 1);
  }
  if (kind === "circuit") {
    return new THREE.BoxGeometry(1, 1, 1);
  }
  return new THREE.SphereGeometry(1, 18, 12);
}

function parseFeatureGeometry(value: unknown): PreviewGeometry | null {
  if (!isRecord(value)) return null;

  if (value.type === "BoxGeometry") {
    const bottomLeft = vector3Value(value.bottom_left);
    const topRight = vector3Value(value.top_right);
    const thk = finiteNumber(value.thk, 0);
    if (!bottomLeft || !topRight || thk <= 0) return null;
    return {
      type: "box",
      min: [
        Math.min(bottomLeft[0], topRight[0]),
        Math.min(bottomLeft[1], topRight[1]),
        Math.min(bottomLeft[2], bottomLeft[2] + thk),
      ],
      max: [
        Math.max(bottomLeft[0], topRight[0]),
        Math.max(bottomLeft[1], topRight[1]),
        Math.max(bottomLeft[2], bottomLeft[2] + thk),
      ],
    };
  }

  if (value.type === "CylinderGeometry") {
    const center = vector3Value(value.center);
    const radius = finiteNumber(value.bottom_radius, 0);
    const height = finiteNumber(value.thk, 0);
    if (!center || radius <= 0 || height <= 0) return null;
    return { type: "cylinder", center, radius, height };
  }

  if (value.type === "ConeGeometry") {
    const center = vector3Value(value.center);
    const bottomRadius = finiteNumber(value.bottom_radius, 0);
    const topRadius = finiteNumber(value.top_radius, 0);
    const height = finiteNumber(value.thk, 0);
    if (!center || height <= 0 || Math.max(bottomRadius, topRadius) <= 0) {
      return null;
    }
    return { type: "cone", center, bottomRadius, topRadius, height };
  }

  if (value.type === "PolygonGeometry") {
    const loops = parsePolygonLoops(value.polys);
    const height = finiteNumber(value.thk, 0);
    if (loops.length === 0 || height <= 0) return null;
    const zMin = loops.reduce((min, loop) => {
      return Math.min(min, ...loop.map((point) => point[2]));
    }, Number.POSITIVE_INFINITY);
    return { type: "polygon", loops, zMin, height };
  }

  return null;
}

function geometryBounds(geometry: PreviewGeometry): BoundsTuple {
  if (geometry.type === "box") {
    return boundsFromMinMax(geometry.min, geometry.max);
  }

  if (geometry.type === "cylinder") {
    const { center, radius, height } = geometry;
    return boundsFromMinMax(
      [center[0] - radius, center[1] - radius, center[2]],
      [center[0] + radius, center[1] + radius, center[2] + height],
    );
  }

  if (geometry.type === "cone") {
    const { center, height } = geometry;
    const radius = Math.max(geometry.bottomRadius, geometry.topRadius);
    return boundsFromMinMax(
      [center[0] - radius, center[1] - radius, center[2]],
      [center[0] + radius, center[1] + radius, center[2] + height],
    );
  }

  const points = geometry.loops.flat();
  const min: [number, number, number] = [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    geometry.zMin,
  ];
  const max: [number, number, number] = [
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
    geometry.zMin + geometry.height,
  ];
  return boundsFromMinMax(min, max);
}

function boundsFromMinMax(
  min: [number, number, number],
  max: [number, number, number],
): BoundsTuple {
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

function normalizeDensity(value: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp(value / 100, 0, 1);
}

function parsePolygonLoops(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((loop) => {
      if (!Array.isArray(loop)) return [];
      return loop
        .map((point) => vector3Value(point))
        .filter((point): point is [number, number, number] => point !== null);
    })
    .filter((loop) => loop.length >= 3);
}

function vector3Value(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = finiteNumber(value[0], Number.NaN);
  const y = finiteNumber(value[1], Number.NaN);
  const z = finiteNumber(value[2], 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }
  return [x, y, z];
}

function pointInsideCircle(
  x: number,
  y: number,
  cx: number,
  cy: number,
  radius: number,
) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function pointInsidePolygonLoops(
  x: number,
  y: number,
  loops: [number, number, number][][],
) {
  let winding = 0;
  loops.forEach((loop) => {
    if (pointInsideLoop(x, y, loop)) winding += 1;
  });
  return winding % 2 === 1;
}

function pointInsideLoop(x: number, y: number, loop: [number, number, number][]) {
  let inside = false;
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index, index += 1) {
    const currentPoint = loop[index];
    const previousPoint = loop[previous];
    const intersects =
      currentPoint[1] > y !== previousPoint[1] > y &&
      x <
        ((previousPoint[0] - currentPoint[0]) * (y - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1] || Number.EPSILON) +
          currentPoint[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function circuitRotation(index: number) {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, 0, index % 2 === 0 ? 0.18 : -0.18),
  );
}

function disabledRaycast(
  _raycaster: THREE.Raycaster,
  _intersects: THREE.Intersection[],
) {
  return undefined;
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function lerp(min: number, max: number, ratio: number) {
  return min + (max - min) * ratio;
}
