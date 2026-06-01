"use client";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export type CadFileKind = "glb" | "gltf" | "stl";

export type BoundsTuple = {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
};

export type ModelStats = {
  bounds: BoundsTuple;
  meshCount: number;
  materialCount: number;
  vertexCount: number;
  triangleCount: number;
};

export type LoadedCadModel = {
  id: string;
  object: THREE.Object3D;
  fileName: string;
  fileKind: CadFileKind;
  fileSize: number;
  stats: ModelStats;
};

export const DEMO_BOUNDS: BoundsTuple = {
  min: [-4200, -3000, -520],
  max: [4200, 3000, 1550],
  center: [0, 0, 515],
  size: [8400, 6000, 2070],
};

export async function loadCadFile(file: File): Promise<LoadedCadModel> {
  const fileKind = inferFileKind(file.name);
  return loadCadBlob(file, {
    fileName: file.name,
    fileKind,
    fileSize: file.size,
    id: `${file.name}-${file.size}-${file.lastModified}`,
  });
}

export async function loadCadBlob(
  blob: Blob,
  {
    fileName,
    fileKind = inferFileKind(fileName),
    fileSize = blob.size,
    id = `${fileName}-${fileSize}`,
  }: {
    fileName: string;
    fileKind?: CadFileKind;
    fileSize?: number;
    id?: string;
  },
): Promise<LoadedCadModel> {
  const url = URL.createObjectURL(blob);

  try {
    const object =
      fileKind === "stl" ? await loadStl(url, fileName) : await loadGltf(url);

    object.name = fileName;
    standardizeImportedObject(object);

    return {
      id,
      object,
      fileName,
      fileKind,
      fileSize,
      stats: collectModelStats(object),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function disposeModel(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!isMesh(child)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatLength(value: number) {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function inferFileKind(fileName: string): CadFileKind {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "glb" || extension === "gltf" || extension === "stl") {
    return extension;
  }
  throw new Error("Unsupported CAD file. Use STL, GLB, or GLTF.");
}

function loadGltf(url: string) {
  const loader = new GLTFLoader();
  return new Promise<THREE.Object3D>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      (error) => reject(error),
    );
  });
}

function loadStl(url: string, fileName: string) {
  const loader = new STLLoader();
  return new Promise<THREE.Object3D>((resolve, reject) => {
    loader.load(
      url,
      (geometry) => {
        if (!geometry.getAttribute("normal")) {
          geometry.computeVertexNormals();
        }
        geometry.computeBoundingBox();
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshPhysicalMaterial({
            color: "#8f9894",
            metalness: 0.12,
            roughness: 0.62,
            clearcoat: 0.1,
            side: THREE.DoubleSide,
          }),
        );
        mesh.name = fileName;
        resolve(mesh);
      },
      undefined,
      (error) => reject(error),
    );
  });
}

function standardizeImportedObject(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    if (!isMesh(child)) return;

    child.castShadow = true;
    child.receiveShadow = true;

    if (!child.geometry.getAttribute("normal")) {
      child.geometry.computeVertexNormals();
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    materials.forEach((material, index) => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return;
      material.side = THREE.DoubleSide;
      material.roughness = Math.max(material.roughness, 0.45);
      material.metalness = Math.min(material.metalness, 0.55);
      if (looksUnstyled(material)) {
        material.color.set(packageFallbackColor(child.name, index));
      }
      material.needsUpdate = true;
    });
  });
}

function collectModelStats(object: THREE.Object3D): ModelStats {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    box.min.set(-1, -1, -1);
    box.max.set(1, 1, 1);
  }

  const materialNames = new Set<string>();
  let meshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;

  object.traverse((child) => {
    if (!isMesh(child)) return;
    meshCount += 1;

    const position = child.geometry.getAttribute("position");
    const vertices = position?.count ?? 0;
    vertexCount += vertices;
    triangleCount += child.geometry.index
      ? child.geometry.index.count / 3
      : vertices / 3;

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material, index) => {
      materialNames.add(material.name || `${child.uuid}:${index}`);
    });
  });

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  return {
    bounds: {
      min: vectorTuple(box.min),
      max: vectorTuple(box.max),
      center: vectorTuple(center),
      size: vectorTuple(size),
    },
    meshCount,
    materialCount: materialNames.size,
    vertexCount,
    triangleCount: Math.round(triangleCount),
  };
}

function packageFallbackColor(name: string, index: number) {
  const normalized = name.toLowerCase();
  if (normalized.includes("substrate") || normalized.includes("bt")) {
    return "#10775d";
  }
  if (
    normalized.includes("cu") ||
    normalized.includes("copper") ||
    normalized.includes("metal") ||
    normalized.includes("rdl") ||
    normalized.includes("via")
  ) {
    return "#dfc22d";
  }
  if (
    normalized.includes("solder") ||
    normalized.includes("snag") ||
    normalized.includes("bump")
  ) {
    return "#d9dddb";
  }
  if (
    normalized.includes("dielectric") ||
    normalized.includes("underfill") ||
    normalized.includes("interface")
  ) {
    return "#1aa7d2";
  }
  if (
    normalized.includes("si") ||
    normalized.includes("die") ||
    normalized.includes("logic") ||
    normalized.includes("hbm")
  ) {
    return "#8c8f8d";
  }
  if (normalized.includes("mold") || normalized.includes("epoxy")) {
    return "#b9bfbd";
  }

  const fallbackPalette = ["#8f9894", "#10775d", "#d8bd28", "#1aa7d2"];
  return fallbackPalette[index % fallbackPalette.length];
}

function looksUnstyled(material: THREE.MeshStandardMaterial) {
  const color = material.color;
  const channels = [color.r, color.g, color.b];
  const spread = Math.max(...channels) - Math.min(...channels);
  const brightness = channels.reduce((sum, channel) => sum + channel, 0) / 3;
  return spread < 0.025 && brightness > 0.48;
}

function vectorTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function isMesh(
  object: THREE.Object3D,
): object is THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]> {
  return (object as THREE.Mesh).isMesh === true;
}
