import type * as THREE from "three";

import type { PreviewFeature, PreviewGeometry } from "./feature-model";

// Envelopes already use global geometry coordinates as their vertex positions.
// Keep the source geometries intact: masks are a display-only ownership rule.
export function installFeatureMasks(material: THREE.MeshBasicMaterial, features: PreviewFeature[], batched: boolean) {
  const masked = features.map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => feature.occlusionMasks.length > 0);
  if (masked.length === 0) return material;
  const functions: string[] = [];
  const tests = masked.map(({ feature, index }) => {
    const conditions = feature.occlusionMasks.map((mask, maskIndex) => {
      const name = `featureMask_${index}_${maskIndex}`;
      functions.push(footprintFunction(name, mask));
      return `${name}(vFeaturePosition.xy)`;
    });
    const selected = batched ? `abs(vFeatureIndex - ${number(index)}) < 0.25 && ` : "";
    return `if (${selected}(${conditions.join(" || ")})) discard;`;
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `${batched ? "attribute float featureIndex; varying float vFeatureIndex;" : ""}\nvarying vec3 vFeaturePosition;\n${shader.vertexShader}`
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvFeaturePosition = transformed;\n${batched ? "vFeatureIndex = featureIndex;" : ""}`);
    shader.fragmentShader = `${batched ? "varying float vFeatureIndex;" : ""}\nvarying vec3 vFeaturePosition;\n${functions.join("\n")}\n${shader.fragmentShader}`
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${tests.join("\n")}`);
  };
  material.customProgramCacheKey = () => JSON.stringify([batched, features.map((feature) => feature.occlusionMasks)]);
  return material;
}

function footprintFunction(name: string, geometry: PreviewGeometry) {
  if (geometry.type === "box") {
    return `bool ${name}(vec2 p) { return p.x >= ${number(geometry.min[0])} && p.x <= ${number(geometry.max[0])} && p.y >= ${number(geometry.min[1])} && p.y <= ${number(geometry.max[1])}; }`;
  }
  if (geometry.type === "cylinder" || geometry.type === "cone") {
    const radius = geometry.type === "cylinder" ? geometry.radius : Math.max(geometry.bottomRadius, geometry.topRadius);
    return `bool ${name}(vec2 p) { return distance(p, vec2(${number(geometry.center[0])}, ${number(geometry.center[1])})) <= ${number(radius)}; }`;
  }
  const edges = geometry.loops.flatMap((loop) => loop.map((a, index) => {
    const b = loop[(index + 1) % loop.length];
    if (a[1] === b[1]) return "";
    return `if (((${number(a[1])} > p.y) != (${number(b[1])} > p.y)) && p.x < (${number(b[0] - a[0])}) * (p.y - ${number(a[1])}) / (${number(b[1] - a[1])}) + ${number(a[0])}) inside = !inside;`;
  }));
  return `bool ${name}(vec2 p) { bool inside = false; ${edges.join("\n")} return inside; }`;
}

function number(value: number) {
  return value.toExponential(12);
}
