"use client";

import * as React from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { BoundsTuple } from "@/components/viewer/model-loader";
import { sectionDisplayEpsilon } from "@/components/viewer/section-display";
import type { FeatureKind } from "@/lib/geometry-preview/features/feature-model";
import { FEATURE_KIND_COLORS } from "@/lib/geometry-preview/features/feature-pattern";
import type {
  EstimatedFeatureSectionLayer,
  EstimatedFeatureSectionRegion,
} from "@/lib/geometry-preview/features/feature-section";

export function GeometryFeatureSectionCaps({
  section,
  bounds,
  flip,
}: {
  section: EstimatedFeatureSectionLayer | null;
  bounds: BoundsTuple;
  flip: boolean;
}) {
  if (!section || section.regions.length === 0) return null;
  return (
    <group name="estimated-feature-section-patterns">
      {(["bump", "via", "circuit"] as FeatureKind[]).map((kind) => (
        <FeaturePatternBatch
          key={kind}
          kind={kind}
          regions={section.regions.filter((region) => region.featureKind === kind)}
          section={section}
          bounds={bounds}
          flip={flip}
        />
      ))}
      <FeatureSectionOutlines section={section} bounds={bounds} flip={flip} />
    </group>
  );
}

function FeaturePatternBatch({
  kind,
  regions,
  section,
  bounds,
  flip,
}: {
  kind: FeatureKind;
  regions: EstimatedFeatureSectionRegion[];
  section: EstimatedFeatureSectionLayer;
  bounds: BoundsTuple;
  flip: boolean;
}) {
  const texture = React.useMemo(() => createPatternTexture(kind), [kind]);
  const geometry = React.useMemo(
    () => createPatternGeometry(regions, section, bounds, flip),
    [bounds, flip, regions, section],
  );
  const material = React.useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: texture,
        vertexColors: true,
        alphaTest: 0.3,
        transparent: false,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        toneMapped: false,
      }),
    [texture],
  );

  React.useEffect(
    () => () => {
      texture.dispose();
      geometry?.dispose();
      material.dispose();
    },
    [geometry, material, texture],
  );
  return geometry ? (
    <mesh geometry={geometry} material={material} renderOrder={55} />
  ) : null;
}

function FeatureSectionOutlines({
  section,
  bounds,
  flip,
}: {
  section: EstimatedFeatureSectionLayer;
  bounds: BoundsTuple;
  flip: boolean;
}) {
  const geometry = React.useMemo(
    () => createOutlineGeometry(section, bounds, flip),
    [bounds, flip, section],
  );
  const material = React.useMemo(
    () =>
      new THREE.LineBasicMaterial({
        vertexColors: true,
        depthTest: true,
        depthWrite: false,
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
  return <lineSegments geometry={geometry} material={material} renderOrder={56} />;
}

function createPatternGeometry(
  regions: EstimatedFeatureSectionRegion[],
  section: EstimatedFeatureSectionLayer,
  bounds: BoundsTuple,
  flip: boolean,
) {
  const geometries: THREE.BufferGeometry[] = [];
  const epsilon = sectionDisplayEpsilon(bounds);
  const signedOffset = (flip ? -1 : 1) * epsilon * 2;

  regions.forEach((region) => {
    if (region.pattern.density <= 0) return;
    region.contours.forEach((contour) => {
      const shape = new THREE.Shape(
        contour.outer.map(([u, v]) => new THREE.Vector2(u, v)),
      );
      contour.holes.forEach((hole) => {
        shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))));
      });
      const geometry = new THREE.ShapeGeometry(shape);
      const position = geometry.getAttribute("position") as THREE.BufferAttribute;
      const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
      const colors = new Float32Array(position.count * 3);
      const color = new THREE.Color(region.pattern.materialColor);
      for (let index = 0; index < position.count; index += 1) {
        const u = position.getX(index);
        const v = position.getY(index);
        uv.setXY(
          index,
          (u - region.pattern.phaseU) / region.pattern.pitchU,
          (v - region.pattern.phaseV) / region.pattern.pitchV,
        );
        if (section.axis === "x") {
          position.setXYZ(index, section.position + signedOffset, u, v);
        } else {
          position.setXYZ(index, u, section.position + signedOffset, v);
        }
        colors.set([color.r, color.g, color.b], index * 3);
      }
      position.needsUpdate = true;
      uv.needsUpdate = true;
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      geometries.push(geometry);
    });
  });

  if (geometries.length === 0) return null;
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  return merged;
}

function createOutlineGeometry(
  section: EstimatedFeatureSectionLayer,
  bounds: BoundsTuple,
  flip: boolean,
) {
  const positions: number[] = [];
  const colors: number[] = [];
  const epsilon = sectionDisplayEpsilon(bounds);
  const signedOffset = (flip ? -1 : 1) * epsilon * 2.25;
  section.regions.forEach((region) => {
    const color = new THREE.Color(FEATURE_KIND_COLORS[region.featureKind]);
    region.contours.forEach((contour) => {
      [contour.outer, ...contour.holes].forEach((loop) => {
        for (let index = 0; index + 1 < loop.length; index += 1) {
          const start = worldPoint(section, loop[index], signedOffset);
          const end = worldPoint(section, loop[index + 1], signedOffset);
          positions.push(...start, ...end);
          colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      });
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function worldPoint(
  section: EstimatedFeatureSectionLayer,
  [u, v]: [number, number],
  offset: number,
): [number, number, number] {
  return section.axis === "x"
    ? [section.position + offset, u, v]
    : [u, section.position + offset, v];
}

function createPatternTexture(kind: FeatureKind) {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const visible = patternPixel(kind, x, y, size);
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = visible ? 255 : 0;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function patternPixel(kind: FeatureKind, x: number, y: number, size: number) {
  const cx = x - size / 2 + 0.5;
  const cy = y - size / 2 + 0.5;
  if (kind === "bump") return cx * cx + cy * cy <= (size * 0.24) ** 2;
  if (kind === "via") {
    const halfWidth = size * 0.13;
    const halfHeight = size * 0.34;
    const cappedY = Math.max(Math.abs(cy) - (halfHeight - halfWidth), 0);
    return cx * cx + cappedY * cappedY <= halfWidth ** 2;
  }
  const diagonal = ((x - y + size * 2) % size) - size / 2;
  return Math.abs(diagonal) <= size * 0.065;
}
