import { describe, expect, it } from "vitest";

import {
  extractPreviewFeatures,
  geometryBounds,
  type PreviewFeature,
  type PreviewGeometry,
} from "@/lib/geometry-preview/features/feature-model";
import { buildFeatureInstanceLayout } from "@/lib/geometry-preview/features/feature-layout";
import {
  buildEstimatedFeatureSection,
  intersectFeatureEnvelope,
} from "@/lib/geometry-preview/features/feature-section";

describe("feature model", () => {
  it("preserves estimated metadata and keeps zero density at zero", () => {
    const features = extractPreviewFeatures({
      root: {
        id: "root-id",
        key: "root",
        bodies: [],
        vias: [
          {
            id: "via-1",
            material: "Cu",
            density: 0,
            direction: "+z",
            koz: 2.5,
            geometry: {
              type: "CylinderGeometry",
              center: [0, 0, 10],
              bottom_radius: 5,
              thk: 20,
            },
          },
        ],
        circuits: [],
        bumps: [],
        children: [],
      },
    });

    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({
      id: "via-1",
      density: 0,
      normalizedDensity: 0,
      koz: 2.5,
      direction: "+z",
    });
  });
});

describe("feature section projection", () => {
  it("sections a box anywhere inside its envelope, independent of glyph rows", () => {
    const geometry: PreviewGeometry = {
      type: "box",
      min: [0, 10, 20],
      max: [100, 50, 40],
    };
    expect(intersectFeatureEnvelope(geometry, "x", 37)).toEqual([
      {
        outer: [
          [10, 20],
          [50, 20],
          [50, 40],
          [10, 40],
          [10, 20],
        ],
        holes: [],
      },
    ]);
    expect(intersectFeatureEnvelope(geometry, "x", 101)).toEqual([]);
  });

  it("uses an analytic cylinder chord and excludes a zero-area tangent", () => {
    const geometry: PreviewGeometry = {
      type: "cylinder",
      center: [0, 0, 5],
      radius: 5,
      height: 10,
    };
    const section = intersectFeatureEnvelope(geometry, "x", 3);
    expect(section[0].outer).toEqual([
      [-4, 5],
      [4, 5],
      [4, 15],
      [-4, 15],
      [-4, 5],
    ]);
    expect(intersectFeatureEnvelope(geometry, "x", 5)).toEqual([]);
  });

  it("preserves polygon holes as disconnected scanline intervals", () => {
    const geometry: PreviewGeometry = {
      type: "polygon",
      zMin: 0,
      height: 5,
      loops: [
        [
          [0, 0, 0],
          [10, 0, 0],
          [10, 10, 0],
          [0, 10, 0],
        ],
        [
          [3, 3, 0],
          [7, 3, 0],
          [7, 7, 0],
          [3, 7, 0],
        ],
      ],
    };
    expect(intersectFeatureEnvelope(geometry, "x", 5).map((region) => region.outer)).toEqual([
      [
        [0, 0],
        [3, 0],
        [3, 5],
        [0, 5],
        [0, 0],
      ],
      [
        [7, 0],
        [10, 0],
        [10, 5],
        [7, 5],
        [7, 0],
      ],
    ]);
    expect(intersectFeatureEnvelope(geometry, "x", 3).map((region) => region.outer)).toEqual([
      [
        [0, 0],
        [3, 0],
        [3, 5],
        [0, 5],
        [0, 0],
      ],
      [
        [7, 0],
        [10, 0],
        [10, 5],
        [7, 5],
        [7, 0],
      ],
    ]);
  });

  it("keeps a polygon boundary face visible and rejects an isolated tangent", () => {
    const geometry: PreviewGeometry = {
      type: "polygon",
      zMin: 2,
      height: 3,
      loops: [
        [
          [0, 0, 2],
          [10, 0, 2],
          [10, 10, 2],
          [0, 10, 2],
        ],
      ],
    };
    expect(intersectFeatureEnvelope(geometry, "x", 0)[0].outer).toEqual([
      [0, 2],
      [10, 2],
      [10, 5],
      [0, 5],
      [0, 2],
    ]);
    expect(intersectFeatureEnvelope(geometry, "x", 11)).toEqual([]);
  });

  it("sections a tapered cone only through its valid height", () => {
    const geometry: PreviewGeometry = {
      type: "cone",
      center: [0, 0, 0],
      bottomRadius: 2,
      topRadius: 10,
      height: 20,
    };
    const section = intersectFeatureEnvelope(geometry, "x", 6);
    expect(section).toHaveLength(1);
    const zValues = section[0].outer.map((point) => point[1]);
    expect(Math.min(...zValues)).toBeCloseTo(10);
    expect(Math.max(...zValues)).toBeCloseTo(20);
    expect(section[0].outer[0]).toEqual(section[0].outer.at(-1));
  });

  it("builds a deterministic estimated layer while retaining zero-density outlines", () => {
    const feature = makeFeature({ density: 0, normalizedDensity: 0 });
    const options = {
      axis: "x" as const,
      position: 5,
      densityScale: 1,
      visibility: { bumps: true, vias: true, circuits: true },
    };
    const first = buildEstimatedFeatureSection([feature], options);
    const second = buildEstimatedFeatureSection([feature], options);
    expect(first).toEqual(second);
    expect(first.regions[0].pattern.density).toBe(0);
    expect(first.regions[0].contours).toHaveLength(1);
  });
});

describe("packed feature layout", () => {
  it("uses a global cap, packed matrices, and no repeated marks for density zero", () => {
    const features = [
      makeFeature({ id: "a", density: 100, normalizedDensity: 1 }),
      makeFeature({ id: "b", density: 100, normalizedDensity: 1 }),
      makeFeature({ id: "zero", density: 0, normalizedDensity: 0 }),
    ];
    const layout = buildFeatureInstanceLayout(features, geometryBounds(features[0].geometry), {
      enabled: true,
      showBumps: true,
      showVias: true,
      showCircuits: true,
      mode: "detail",
      densityScale: 1,
      glyphSizeScale: 1,
      maxInstances: 11,
    });

    expect(layout.total).toBe(11);
    expect(layout.batches.bump.matrices).toBeInstanceOf(Float32Array);
    expect(layout.batches.bump.matrices.length).toBe(11 * 16);
    expect(layout.batches.bump.colors.length).toBe(11 * 3);
  });

  it("keeps the 10,000-mark packed instance payload below two MiB", () => {
    const feature = makeFeature({ density: 100, normalizedDensity: 1 });
    const layout = buildFeatureInstanceLayout(
      [feature],
      geometryBounds(feature.geometry),
      {
        enabled: true,
        showBumps: true,
        showVias: true,
        showCircuits: true,
        mode: "detail",
        densityScale: 1,
        glyphSizeScale: 1,
        maxInstances: 10_000,
      },
    );
    const bytes = Object.values(layout.batches).reduce(
      (total, batch) => total + batch.matrices.byteLength + batch.colors.byteLength,
      0,
    );
    expect(layout.total).toBe(8_100);
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
  });

  it("allocates a constrained budget independently of source array order", () => {
    const features = Array.from({ length: 7 }, (_, index) =>
      makeFeature({ id: `feature-${index}`, density: 100, normalizedDensity: 1 }),
    );
    const settings = {
      enabled: true,
      showBumps: true,
      showVias: true,
      showCircuits: true,
      mode: "detail" as const,
      densityScale: 1,
      glyphSizeScale: 1,
      maxInstances: 4,
    };
    const forward = buildFeatureInstanceLayout(
      features,
      geometryBounds(features[0].geometry),
      settings,
    );
    const reversed = buildFeatureInstanceLayout(
      [...features].reverse(),
      geometryBounds(features[0].geometry),
      settings,
    );
    expect(forward.total).toBe(4);
    expect(reversed.total).toBe(4);
    expect([...forward.batches.bump.matrices]).toEqual([
      ...reversed.batches.bump.matrices,
    ]);
  });
});

function makeFeature(overrides: Partial<PreviewFeature> = {}): PreviewFeature {
  const geometry: PreviewGeometry = {
    type: "box",
    min: [0, 0, 0],
    max: [10, 10, 5],
  };
  return {
    id: "feature",
    type: "bump",
    material: "solder",
    density: 50,
    normalizedDensity: 0.5,
    direction: "+z",
    koz: 0,
    geometry,
    bounds: geometryBounds(geometry),
    containerId: "root",
    containerKey: "root",
    containerPath: "root",
    ...overrides,
  };
}
