import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { buildFeatureInstanceLayout } from "./feature-layout";
import { installFeatureMasks } from "./feature-masking";
import { extractPreviewFeatures, pointInsideFeatureFootprint } from "./feature-model";
import { buildEstimatedFeatureSection } from "./feature-section";

function box(x0: number, y0: number, x1: number, y1: number, z: number, height: number) {
  return { type: "BoxGeometry", bottom_left: [x0, y0, z], top_right: [x1, y1, z], thk: height };
}
function bump(id: string, geometry: unknown, stage: string) {
  return { id, geometry, stage, density: 80, material: "SnAg", direction: "-z", koz: 0 };
}
function structure(height = 25) {
  return { root: { id: "main", bumps: [bump("lower", box(0, 0, 100, 100, 100, 20), "reflowed")], children: [
    { id: "die", bumps: [bump("upper", box(0, 0, 10, 10, 100, height), "joined")], children: [] },
  ] } };
}
const visibility = { bumps: true, vias: true, circuits: true };

describe("joined bump display ownership", () => {
  it("preserves raw geometry and stages while hiding consumed XY columns", () => {
    const raw = structure();
    const before = JSON.stringify(raw);
    const [lower, upper] = extractPreviewFeatures(raw);
    expect(lower.bumpStage).toBe("reflowed");
    expect(upper.bumpStage).toBe("joined");
    expect(upper.containerAncestors).toEqual(["main"]);
    expect(pointInsideFeatureFootprint(lower, 5, 5)).toBe(false);
    expect(pointInsideFeatureFootprint(lower, 50, 50)).toBe(true);
    expect(pointInsideFeatureFootprint(upper, 5, 5)).toBe(true);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it.each([25, 5])("section excludes lower bump columns even at joined height %s", (height) => {
    const regions = buildEstimatedFeatureSection(extractPreviewFeatures(structure(height)), {
      axis: "x", position: 5, densityScale: 1, visibility,
    }).regions;
    const lower = regions.find((region) => region.featureId === "lower")!;
    const upper = regions.find((region) => region.featureId === "upper")!;
    expect(Math.min(...lower.contours.flatMap((contour) => contour.outer.map(([u]) => u)))).toBe(10);
    expect(Math.max(...lower.contours.flatMap((contour) => contour.outer.map(([u]) => u)))).toBe(100);
    expect(Math.max(...upper.contours[0].outer.map(([, z]) => z))).toBe(100 + height);
  });

  it("does not hide unrelated siblings, nonintersecting layers or unjoined bumps", () => {
    const raw = structure();
    raw.root.children[0].bumps[0].stage = "reflowed";
    expect(extractPreviewFeatures(raw)[0].occlusionMasks).toEqual([]);
    raw.root.children[0].bumps[0].stage = "joined";
    raw.root.children[0].bumps[0].geometry = box(0, 0, 10, 10, 140, 25);
    expect(extractPreviewFeatures(raw)[0].occlusionMasks).toEqual([]);
    const siblings = { root: { id: "root", children: [
      { id: "a", bumps: [bump("a", box(0, 0, 10, 10, 100, 20), "reflowed")] },
      { id: "b", bumps: [bump("b", box(0, 0, 10, 10, 100, 25), "joined")] },
    ] } };
    expect(extractPreviewFeatures(siblings)[0].occlusionMasks).toEqual([]);
  });

  it("detail layout contains no glyphs for a completely consumed lower footprint", () => {
    const raw = structure();
    raw.root.bumps[0].geometry = box(0, 0, 10, 10, 100, 20);
    const features = extractPreviewFeatures(raw);
    const layout = buildFeatureInstanceLayout(features, features[1].bounds, {
      enabled: true, showBumps: true, showVias: true, showCircuits: true,
      mode: "detail", densityScale: 1, glyphSizeScale: 1, maxInstances: 20,
    });
    expect(layout.batches.bump.count).toBeGreaterThan(0);
    const matrices = layout.batches.bump.matrices;
    for (let index = 14; index < matrices.length; index += 16) expect(matrices[index]).toBe(112.5);
  });

  it("uses polygon holes and circular footprints instead of bounding-box masks", () => {
    const raw = structure();
    raw.root.children[0].bumps[0].geometry = {
      type: "PolygonGeometry", thk: 25, polys: [
        [[0,0,100],[10,0,100],[10,10,100],[0,10,100]],
        [[3,3,100],[3,7,100],[7,7,100],[7,3,100]],
      ],
    } as unknown as ReturnType<typeof box>;
    const features = extractPreviewFeatures(raw);
    expect(pointInsideFeatureFootprint(features[0], 1, 1)).toBe(false);
    expect(pointInsideFeatureFootprint(features[0], 5, 5)).toBe(true);
    const layer = buildEstimatedFeatureSection(features, { axis: "x", position: 5, densityScale: 1, visibility });
    const lower = layer.regions.find((region) => region.featureId === "lower")!;
    expect(lower.contours.map((contour) => [Math.min(...contour.outer.map(([u]) => u)), Math.max(...contour.outer.map(([u]) => u))])).toEqual([[3,7],[10,100]]);
    raw.root.children[0].bumps[0].geometry = { type: "CylinderGeometry", center: [5,5,100], bottom_radius: 5, thk: 25 } as unknown as ReturnType<typeof box>;
    const circle = extractPreviewFeatures(raw)[0];
    expect(pointInsideFeatureFootprint(circle, 0.5, 0.5)).toBe(true);
    expect(pointInsideFeatureFootprint(circle, 5, 5)).toBe(false);
  });

  it("installs both batched and highlight shader masks without changing geometry", () => {
    const features = extractPreviewFeatures(structure());
    for (const batched of [true, false]) {
      const material = installFeatureMasks(new THREE.MeshBasicMaterial(), features, batched);
      const shader = { vertexShader: "#include <begin_vertex>", fragmentShader: "#include <clipping_planes_fragment>", uniforms: {} };
      material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], null as unknown as THREE.WebGLRenderer);
      expect(shader.fragmentShader).toContain("discard;");
      expect(shader.vertexShader).toContain("vFeaturePosition = transformed");
      expect(shader.fragmentShader.includes("vFeatureIndex")).toBe(batched);
      material.dispose();
    }
  });
});
