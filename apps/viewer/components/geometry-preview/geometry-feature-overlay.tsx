"use client";

import * as React from "react";
import { type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { BoundsTuple } from "@/components/viewer/model-loader";
import { materialPreviewColor } from "@/components/viewer/material-palette";
import { buildFeatureInstanceLayout } from "@/lib/geometry-preview/features/feature-layout";
import {
  FEATURE_KIND_COLORS,
} from "@/lib/geometry-preview/features/feature-pattern";
import {
  extractPreviewFeatures,
  extractPreviewGeometryBounds,
  formatDensityPercent,
  formatFeatureKind,
  summarizeFeatures,
  type FeatureKind,
  type FeatureSummary,
  type PreviewFeature,
  type PreviewGeometry,
} from "@/lib/geometry-preview/features/feature-model";
import type {
  FeatureOverlayMode,
  FeatureOverlaySettings,
} from "@/lib/geometry-preview/features/feature-quality";

export {
  extractPreviewFeatures,
  extractPreviewGeometryBounds,
  formatDensityPercent,
  formatFeatureKind,
  summarizeFeatures,
};
export type {
  FeatureKind,
  FeatureOverlayMode,
  FeatureOverlaySettings,
  FeatureSummary,
  PreviewFeature,
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
    () =>
      filterVisibleFeatures(features, {
        enabled: settings.enabled,
        showBumps: settings.showBumps,
        showVias: settings.showVias,
        showCircuits: settings.showCircuits,
      }),
    [
      features,
      settings.enabled,
      settings.showBumps,
      settings.showCircuits,
      settings.showVias,
    ],
  );
  const layout = React.useMemo(
    () =>
      buildFeatureInstanceLayout(visibleFeatures, bounds, {
        enabled: settings.enabled,
        showBumps: settings.showBumps,
        showVias: settings.showVias,
        showCircuits: settings.showCircuits,
        mode: settings.mode,
        densityScale: settings.densityScale,
        glyphSizeScale: settings.glyphSizeScale,
        maxInstances: settings.maxInstances,
        qualityTier: settings.qualityTier,
      }),
    [
      bounds,
      settings.densityScale,
      settings.enabled,
      settings.glyphSizeScale,
      settings.maxInstances,
      settings.mode,
      settings.qualityTier,
      settings.showBumps,
      settings.showCircuits,
      settings.showVias,
      visibleFeatures,
    ],
  );

  if (!settings.enabled || visibleFeatures.length === 0) return null;

  return (
    <group name="geometry-feature-overlay" renderOrder={40}>
      <BatchedFeatureEnvelopes
        features={visibleFeatures}
        interactive={interactive}
        selectedFeatureId={selectedFeatureId}
        onSelectFeature={onSelectFeature}
        onHoverFeature={onHoverFeature}
      />
      {visibleFeatures
        .filter(
          (feature) =>
            feature.id === selectedFeatureId || feature.id === hoveredFeatureId,
        )
        .map((feature) => (
          <FeatureEnvelopeHighlight
            key={feature.id}
            feature={feature}
            opacity={settings.opacity}
            selected={feature.id === selectedFeatureId}
          />
        ))}
      {(["bump", "via", "circuit"] as FeatureKind[]).map((kind) => (
        <InstancedFeatureBatch key={kind} kind={kind} batch={layout.batches[kind]} />
      ))}
    </group>
  );
}

function BatchedFeatureEnvelopes({
  features,
  interactive,
  selectedFeatureId,
  onSelectFeature,
  onHoverFeature,
}: {
  features: PreviewFeature[];
  interactive: boolean;
  selectedFeatureId: string | null;
  onSelectFeature: (featureId: string | null) => void;
  onHoverFeature?: (featureId: string | null) => void;
}) {
  const geometry = React.useMemo(
    () => createMergedEnvelopeGeometry(features),
    [features],
  );
  const material = React.useMemo(
    () =>
      new THREE.MeshBasicMaterial({
      vertexColors: true,
      wireframe: true,
      transparent: false,
      depthTest: true,
      depthWrite: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      toneMapped: false,
      }),
    [],
  );

  React.useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const handleClick = React.useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      if (!interactive) return;
      const featureId = featureIdFromEvent(event, geometry, features);
      if (!featureId) return;
      event.stopPropagation();
      onSelectFeature(selectedFeatureId === featureId ? null : featureId);
    },
    [features, geometry, interactive, onSelectFeature, selectedFeatureId],
  );
  const handlePointerMove = React.useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (!interactive) return;
      const featureId = featureIdFromEvent(event, geometry, features);
      if (!featureId) return;
      event.stopPropagation();
      onHoverFeature?.(featureId);
    },
    [features, geometry, interactive, onHoverFeature],
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
      renderOrder={42}
      raycast={interactive ? undefined : disabledRaycast}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      userData={{ authority: "estimated-density" }}
    />
  );
}

function FeatureEnvelopeHighlight({
  feature,
  opacity,
  selected,
}: {
  feature: PreviewFeature;
  opacity: number;
  selected: boolean;
}) {
  const geometry = React.useMemo(
    () => createEnvelopeGeometry(feature.geometry),
    [feature.geometry],
  );
  const material = React.useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: FEATURE_KIND_COLORS[feature.type],
        transparent: true,
        opacity: clamp(opacity * 0.35, 0.1, 0.35),
        depthTest: true,
        depthWrite: false,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        toneMapped: false,
      }),
    [feature.type, opacity],
  );
  React.useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={selected ? 47 : 46}
      raycast={disabledRaycast}
      userData={{ featureId: feature.id, authority: "estimated-density" }}
    />
  );
}

function InstancedFeatureBatch({
  kind,
  batch,
}: {
  kind: FeatureKind;
  batch: ReturnType<typeof buildFeatureInstanceLayout>["batches"][FeatureKind];
}) {
  const geometry = React.useMemo(() => createLowPolyGlyphGeometry(kind), [kind]);
  const material = React.useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: false,
        depthTest: true,
        depthWrite: true,
        side: THREE.FrontSide,
        toneMapped: false,
      }),
    [],
  );
  const object = React.useMemo(() => {
    if (batch.count === 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, batch.count);
    mesh.name = `estimated-feature-${kind}-instances`;
    mesh.renderOrder = 50;
    mesh.raycast = disabledRaycast;
    mesh.instanceMatrix.array.set(batch.matrices);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(batch.colors, 3);
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    const trianglesPerInstance = geometry.index
      ? geometry.index.count / 3
      : geometry.getAttribute("position").count / 3;
    mesh.userData = {
      authority: "estimated-density",
      instanceCount: batch.count,
      estimatedTriangles: trianglesPerInstance * batch.count,
    };
    return mesh;
  }, [batch, geometry, kind, material]);

  React.useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return object ? <primitive object={object} /> : null;
}

export function createLowPolyGlyphGeometry(kind: FeatureKind) {
  if (kind === "bump") return new THREE.IcosahedronGeometry(1, 0);
  if (kind === "via") {
    const geometry = new THREE.CylinderGeometry(1, 1, 2, 6, 1);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  return new THREE.BoxGeometry(2, 2, 2);
}

function createEnvelopeGeometry(geometry: PreviewGeometry) {
  if (geometry.type === "box") {
    const size: [number, number, number] = [
      geometry.max[0] - geometry.min[0],
      geometry.max[1] - geometry.min[1],
      geometry.max[2] - geometry.min[2],
    ];
    const mesh = new THREE.BoxGeometry(
      Math.max(size[0], 0.001),
      Math.max(size[1], 0.001),
      Math.max(size[2], 0.001),
    );
    mesh.translate(
      (geometry.min[0] + geometry.max[0]) / 2,
      (geometry.min[1] + geometry.max[1]) / 2,
      (geometry.min[2] + geometry.max[2]) / 2,
    );
    return mesh;
  }
  if (geometry.type === "cylinder") {
    const mesh = new THREE.CylinderGeometry(
      geometry.radius,
      geometry.radius,
      Math.max(geometry.height, 0.001),
      16,
      1,
    );
    mesh.rotateX(Math.PI / 2);
    mesh.translate(
      geometry.center[0],
      geometry.center[1],
      geometry.center[2] + geometry.height / 2,
    );
    return mesh;
  }
  if (geometry.type === "cone") {
    const mesh = new THREE.CylinderGeometry(
      geometry.topRadius,
      geometry.bottomRadius,
      Math.max(geometry.height, 0.001),
      16,
      1,
    );
    mesh.rotateX(Math.PI / 2);
    mesh.translate(
      geometry.center[0],
      geometry.center[1],
      geometry.center[2] + geometry.height / 2,
    );
    return mesh;
  }

  const shapes = polygonShapes(geometry.loops);
  if (shapes.length === 0) return new THREE.BoxGeometry(0.001, 0.001, 0.001);
  const mesh = new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(geometry.height, 0.001),
    bevelEnabled: false,
  });
  mesh.translate(0, 0, geometry.zMin);
  return mesh;
}

function createMergedEnvelopeGeometry(features: PreviewFeature[]) {
  const geometries = features.map((feature, featureIndex) => {
    const source = createEnvelopeGeometry(feature.geometry);
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    source.dispose();
    const position = geometry.getAttribute("position");
    const featureIndices = new Float32Array(position.count).fill(featureIndex);
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color(materialPreviewColor(feature.material));
    for (let index = 0; index < position.count; index += 1) {
      colors.set([color.r, color.g, color.b], index * 3);
    }
    geometry.setAttribute("featureIndex", new THREE.BufferAttribute(featureIndices, 1));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
  });
  if (geometries.length === 0) return new THREE.BufferGeometry();
  const merged = mergeGeometries(geometries, false) ?? new THREE.BufferGeometry();
  geometries.forEach((geometry) => geometry.dispose());
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function featureIdFromEvent(
  event: ThreeEvent<MouseEvent | PointerEvent>,
  geometry: THREE.BufferGeometry,
  features: PreviewFeature[],
) {
  if (event.faceIndex === undefined || event.faceIndex === null) return null;
  const attribute = geometry.getAttribute("featureIndex");
  if (!attribute) return null;
  const vertexIndex = geometry.index
    ? geometry.index.getX(event.faceIndex * 3)
    : event.faceIndex * 3;
  const featureIndex = Math.round(attribute.getX(vertexIndex));
  return features[featureIndex]?.id ?? null;
}

function polygonShapes(loops: [number, number, number][][]) {
  const entries = loops.map((loop, index) => {
    const point = loop[0];
    const depth = loops.reduce((count, candidate, candidateIndex) => {
      if (candidateIndex === index) return count;
      return pointInsideLoop(point[0], point[1], candidate) ? count + 1 : count;
    }, 0);
    return { loop, depth, area: Math.abs(loopArea(loop)) };
  });
  const outers = entries.filter((entry) => entry.depth % 2 === 0);
  return outers.map((outer) => {
    const shape = pathFromLoop(outer.loop, true) as THREE.Shape;
    entries
      .filter((entry) => entry.depth === outer.depth + 1)
      .filter((hole) => pointInsideLoop(hole.loop[0][0], hole.loop[0][1], outer.loop))
      .sort((left, right) => right.area - left.area)
      .forEach((hole) => shape.holes.push(pathFromLoop(hole.loop, false)));
    return shape;
  });
}

function pathFromLoop(loop: [number, number, number][], shape: boolean) {
  const path = shape ? new THREE.Shape() : new THREE.Path();
  loop.forEach(([x, y], index) => {
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  return path;
}

function pointInsideLoop(x: number, y: number, loop: [number, number, number][]) {
  let inside = false;
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
    const [xi, yi] = loop[index];
    const [xj, yj] = loop[previous];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function loopArea(loop: [number, number, number][]) {
  return loop.reduce((area, [x, y], index) => {
    const [nextX, nextY] = loop[(index + 1) % loop.length];
    return area + x * nextY - nextX * y;
  }, 0) / 2;
}

function filterVisibleFeatures(
  features: PreviewFeature[],
  settings: Pick<
    FeatureOverlaySettings,
    "enabled" | "showBumps" | "showVias" | "showCircuits"
  >,
) {
  if (!settings.enabled) return [];
  return features.filter((feature) => {
    if (feature.type === "bump") return settings.showBumps;
    if (feature.type === "via") return settings.showVias;
    return settings.showCircuits;
  });
}

function disabledRaycast() {}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
