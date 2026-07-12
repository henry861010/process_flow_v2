"use client";

import * as React from "react";
import * as THREE from "three";

import type {
  GeometrySectionRegion,
  GeometrySectionResponse,
} from "@/components/geometry-preview/geometry-preview-client";
import type { BoundsTuple } from "@/components/viewer/model-loader";
import { materialPreviewColor } from "@/components/viewer/material-palette";
import { sectionDisplayEpsilon } from "@/components/viewer/section-display";

export function GeometrySectionCaps({
  section,
  bounds,
  flip,
}: {
  section: GeometrySectionResponse | null;
  bounds: BoundsTuple;
  flip: boolean;
}) {
  const materialGroups = React.useMemo(
    () => (section ? groupRegionsByMaterial(section.regions) : []),
    [section],
  );
  if (!section) return null;

  return (
    <group name="exact-material-section-caps">
      {materialGroups.map(({ material, regions }) => (
        <SectionCapMesh
          key={material}
          materialName={material}
          regions={regions}
          section={section}
          bounds={bounds}
          flip={flip}
        />
      ))}
    </group>
  );
}

function SectionCapMesh({
  materialName,
  regions,
  section,
  bounds,
  flip,
}: {
  materialName: string;
  regions: GeometrySectionRegion[];
  section: GeometrySectionResponse;
  bounds: BoundsTuple;
  flip: boolean;
}) {
  const geometry = React.useMemo(
    () => createSectionGeometry(regions, section, bounds, flip),
    [bounds, flip, regions, section],
  );
  const edgeGeometry = React.useMemo(
    () => new THREE.EdgesGeometry(geometry, 1),
    [geometry],
  );
  const material = React.useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: materialPreviewColor(materialName),
        depthTest: true,
        depthWrite: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        toneMapped: false,
      }),
    [materialName],
  );
  const edgeMaterial = React.useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: "#334155",
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );

  React.useEffect(
    () => () => {
      geometry.dispose();
      edgeGeometry.dispose();
      material.dispose();
      edgeMaterial.dispose();
    },
    [edgeGeometry, edgeMaterial, geometry, material],
  );

  return (
    <group userData={{ bodyIds: regions.map((region) => region.bodyId) }}>
      <mesh geometry={geometry} material={material} renderOrder={15} />
      <lineSegments
        geometry={edgeGeometry}
        material={edgeMaterial}
        renderOrder={16}
      />
    </group>
  );
}

function createSectionGeometry(
  regions: GeometrySectionRegion[],
  section: GeometrySectionResponse,
  bounds: BoundsTuple,
  flip: boolean,
) {
  const shapes = regions.map((region) => {
    const shape = new THREE.Shape(
      region.outer.map(([u, v]) => new THREE.Vector2(u, v)),
    );
    region.holes.forEach((loop) => {
      shape.holes.push(
        new THREE.Path(loop.map(([u, v]) => new THREE.Vector2(u, v))),
      );
    });
    return shape;
  });

  const geometry = new THREE.ShapeGeometry(shapes);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const epsilon = sectionDisplayEpsilon(bounds);
  // Three.js global clipping discards Plane.distanceToPoint(point) < 0.
  // Offset the cap into the retained positive half-space so it is not clipped
  // by the same plane and is not coplanar with the tessellated body boundary.
  const signedOffset = (flip ? -1 : 1) * epsilon;

  for (let index = 0; index < position.count; index += 1) {
    const u = position.getX(index);
    const v = position.getY(index);
    if (section.axis === "x") {
      position.setXYZ(index, section.position + signedOffset, u, v);
    } else {
      position.setXYZ(index, u, section.position + signedOffset, v);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function groupRegionsByMaterial(regions: GeometrySectionRegion[]) {
  const groups = new Map<string, GeometrySectionRegion[]>();
  regions.forEach((region) => {
    const materialRegions = groups.get(region.material) ?? [];
    materialRegions.push(region);
    groups.set(region.material, materialRegions);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([material, materialRegions]) => ({
      material,
      regions: materialRegions,
    }));
}
