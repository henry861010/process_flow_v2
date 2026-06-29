import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGeometryStructure, stableId } from "../data/schema.js";
import { classifyPolygonLoops } from "../utils/polygon.js";
import { CadExportOptions, OpenCascadeConverter } from "../exporters/cad.js";

test("normalizeGeometryStructure fills stable ids and defaults", () => {
  const first = normalizeGeometryStructure({
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      key: "package",
      bodies: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [0, 0, 0],
            top_right: [10, 10, 0],
            thk: 1,
          },
          material: "mold",
        },
      ],
      children: [],
    },
  });
  const second = normalizeGeometryStructure(first);

  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.unitSystem, "um");
  assert.equal(first.root.bodies.length, 1);
  assert.equal(first.root.id, second.root.id);
  assert.equal(first.root.bodies[0].id, second.root.bodies[0].id);
});

test("stableId is deterministic", () => {
  assert.equal(
    stableId("body", ["root", "body:0"], { material: "Cu" }),
    stableId("body", ["root", "body:0"], { material: "Cu" }),
  );
});

test("classifyPolygonLoops separates outer loops and holes", () => {
  const regions = classifyPolygonLoops([
    [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
    [[2, 2, 0], [8, 2, 0], [8, 8, 0], [2, 8, 0]],
  ]);

  assert.equal(regions.length, 1);
  assert.equal(regions[0].holes.length, 1);
});

test("CAD exporter options keep AP242 defaults", () => {
  const options = new CadExportOptions();

  assert.deepEqual(options.formats, ["step", "glb"]);
  assert.equal(options.stepSchema, "AP242");
  assert.equal(options.includeFeatureBodies, false);
});

test("OpenCascadeConverter reports missing OpenCascade runtime", () => {
  assert.throws(() => new OpenCascadeConverter(null), /OpenCascade\.js is required/);
});
