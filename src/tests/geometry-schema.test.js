import assert from "node:assert/strict";
import test from "node:test";

import { Bump } from "../data/bump.js";
import { Circuit } from "../data/circuit.js";
import { Container } from "../data/container.js";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  PolygonGeometry,
} from "../data/geometry.js";
import { classifyPolygonLoops } from "../utils/polygon.js";
import { Body } from "../data/body.js";
import { Via } from "../data/via.js";
import { normalizeGeometryStructure } from "../data/schema.js";
import { ProcessGeometryState } from "../kernel/process-geometry-state.js";
import {
  CadExportError,
  OpenCascadeConverter,
  convertCad,
  materialColorHex,
} from "../exporters/cad.js";
import {
  GeometryKernel,
  InMemoryRepository,
  ProcessStepModuleResolver,
  geometryStructureToProcessGeometryState,
} from "../kernel/index.js";
import { execute as executeGrinding } from "../process/grinding/grinding.js";
import { execute as executeMicroBump } from "../process/bump/uBump_formation.js";
import { execute as executeFlip } from "../process/flip/flip.js";

test("container json has schema unit and stable ids", () => {
  const root = new Container({ key: "package-root" });
  root.addBodyBox("mold", [0, 0, 0], [10, 10, 0], 1);

  const child = new Container({ key: "die" });
  child.addBodyBox("silicon", [2, 2, 0.2], [8, 8, 0.2], 0.2);
  root.addChild(child);

  const first = root.json();
  const second = root.json();

  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.unitSystem, "um");
  assert.deepEqual(first, second);
  assert.ok(first.root.id);
  assert.ok(first.root.bodies[0].id);
  assert.ok(first.root.children[0].bodies[0].id);
});

test("geometry primitives serialize explicit type", () => {
  const root = new Container({ key: "typed-primitives" });
  root.addBody(
    new Body(new BoxGeometry([0, 0, 0], [10, 10, 0], 1), "box"),
  );
  root.addVia(
    new Via(new CylinderGeometry([0, 0, 0], 1, 2), 0.5, "via", "+z"),
  );
  root.addCircuit(
    new Circuit(
      new PolygonGeometry(
        [[[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]],
        1,
      ),
      0.6,
      "circuit",
    ),
  );
  root.addBump(
    new Bump(new ConeGeometry([0, 0, 0], 2, 1, 3), 0.7, "bump", "-z"),
  );

  const output = root.json();

  assert.equal(output.root.bodies[0].geometry.type, "BoxGeometry");
  assert.equal(output.root.vias[0].geometry.type, "CylinderGeometry");
  assert.equal(output.root.vias[0].direction, "+z");
  assert.equal(output.root.circuits[0].geometry.type, "PolygonGeometry");
  assert.equal(output.root.circuits[0].direction, undefined);
  assert.equal(output.root.bumps[0].geometry.type, "ConeGeometry");
  assert.equal(output.root.bumps[0].direction, "-z");
});

test("via and bump require explicit direction and flip with geometry", () => {
  assert.throws(
    () => new Via(new CylinderGeometry([0, 0, 0], 1, 2), 0.5, "via"),
    /Via direction must be "\+z" or "-z"; received undefined/,
  );
  assert.throws(
    () => new Bump(new ConeGeometry([0, 0, 0], 2, 1, 3), 0.7, "bump", "z"),
    /Bump direction must be "\+z" or "-z"; received z/,
  );

  const root = new Container({ key: "direction-flip" });
  root.addVia(
    new Via(new CylinderGeometry([0, 0, 0], 1, 2), 0.5, "via", "+z"),
  );
  root.addBump(
    new Bump(new ConeGeometry([0, 0, 0], 2, 1, 3), 0.7, "bump", "-z"),
  );

  root.flip(0);

  assert.equal(root.vias()[0].direction(), "-z");
  assert.equal(root.bumps()[0].direction(), "+z");
  assert.equal(root.json().root.vias[0].direction, "-z");
  assert.equal(root.json().root.bumps[0].direction, "+z");
});

test("geometry hydration requires explicit primitive type", () => {
  assert.throws(
    () =>
      geometryStructureToProcessGeometryState(
        singleBodyGeometryStructure({
          bottom_left: [0, 0, 0],
          top_right: [1, 1, 0],
          thk: 1,
        }),
      ),
    /Unsupported geometry type: undefined/,
  );

  assert.throws(
    () =>
      geometryStructureToProcessGeometryState(
        singleBodyGeometryStructure({
          type: "PolygonGeometry",
          bottom_left: [0, 0, 0],
          top_right: [1, 1, 0],
          thk: 1,
        }),
      ),
    /Geometry PolygonGeometry missing field polys/,
  );
});

test("geometry hydration requires via and bump direction", () => {
  assert.throws(
    () =>
      geometryStructureToProcessGeometryState({
        schemaVersion: "1.0.0",
        unitSystem: "um",
        root: {
          key: "missing-via-direction",
          bodies: [],
          vias: [
            {
              geometry: {
                type: "CylinderGeometry",
                center: [0, 0, 0],
                bottom_radius: 1,
                thk: 2,
              },
              material: "Cu",
              density: 0.4,
            },
          ],
          circuits: [],
          bumps: [],
          children: [],
        },
      }),
    /Via direction must be "\+z" or "-z"; received undefined/,
  );

  assert.throws(
    () =>
      geometryStructureToProcessGeometryState({
        schemaVersion: "1.0.0",
        unitSystem: "um",
        root: {
          key: "missing-bump-direction",
          bodies: [],
          vias: [],
          circuits: [],
          bumps: [
            {
              geometry: {
                type: "ConeGeometry",
                center: [0, 0, 0],
                bottom_radius: 2,
                top_radius: 1,
                thk: 3,
              },
              material: "SnAg",
              density: 0.7,
            },
          ],
          children: [],
        },
      }),
    /Bump direction must be "\+z" or "-z"; received undefined/,
  );
});

test("polygon geometry rejects self intersection", () => {
  assert.throws(
    () =>
      new PolygonGeometry(
        [[[0, 0, 0], [2, 2, 0], [0, 2, 0], [2, 0, 0]]],
        1,
      ),
    /self-intersects/,
  );
});

test("polygon loop odd even classification", () => {
  const regions = classifyPolygonLoops([
    [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
    [[2, 2, 0], [8, 2, 0], [8, 8, 0], [2, 8, 0]],
    [[3, 3, 0], [4, 3, 0], [4, 4, 0], [3, 4, 0]],
  ]);

  assert.equal(regions.length, 2);
  assert.deepEqual(regions.map((region) => region.holes.length), [1, 0]);
});

test("geometry primitives copy with XY inset", () => {
  const box = new BoxGeometry([0, 0, 1], [10, 20, 1], 5).copyWithXYInset(2);
  assert.deepEqual(box.bottomLeft(), [2, 2, 1]);
  assert.deepEqual(box.topRight(), [8, 18, 1]);

  const cylinder = new CylinderGeometry([0, 0, 0], 10, 5).copyWithXYInset(3);
  assert.equal(cylinder.bottomRadius(), 7);

  const cone = new ConeGeometry([0, 0, 0], 10, 6, 5).copyWithXYInset(-2);
  assert.equal(cone.bottomRadius(), 12);
  assert.equal(cone.topRadius(), 8);

  const polygon = new PolygonGeometry(
    [[[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]],
    1,
  );
  assert.deepEqual(polygon.copyWithXYInset(0).polygons(), polygon.polygons());
  assert.throws(
    () => polygon.copyWithXYInset(1),
    /PolygonGeometry does not support non-zero XY inset/,
  );
});

test("process geometry state deposit and placement track cursor z", () => {
  const state = ProcessGeometryState.create();
  state.initializeBoxLayer({
    material: "base",
    bottomLeft: [0, 0, 0],
    topRight: [10, 10, 0],
    thickness: 5,
  });

  const die = ProcessGeometryState.create({ key: "die" });
  die.initializeBoxLayer({
    material: "silicon",
    bottomLeft: [2, 2, 1],
    topRight: [8, 8, 1],
    thickness: 2,
    setFootprint: false,
  });
  state.placeGeometryState(die, {
    x: 2,
    y: 2,
    bottomZ: state.cursorZ(),
    anchor: "bottomLeft",
  });

  const output = state.toGeometryStructure();
  assert.equal(state.cursorZ(), 5);
  assert.equal(output.root.bodies[0].geometry.bottom_left[2], 0);
  assert.equal(output.root.children[0].bodies[0].geometry.bottom_left[2], 5);
  assert.equal(output.root.children[0].bodies[0].geometry.thk, 2);
});

test("rootBodyZMax reports only direct root body top", () => {
  const state = ProcessGeometryState.create();
  state.initializeBoxLayer({
    material: "base",
    bottomLeft: [0, 0, 0],
    topRight: [10, 10, 0],
    thickness: 5,
  });
  state.addViaAboveCursor({
    material: "Cu",
    density: 0.5,
    thickness: 3,
  });

  const child = ProcessGeometryState.create({ key: "child" });
  child.initializeBoxLayer({
    material: "silicon",
    bottomLeft: [0, 0, 0],
    topRight: [2, 2, 0],
    thickness: 10,
  });
  state.placeGeometryState(child, {
    x: 0,
    y: 0,
    bottomZ: 20,
    anchor: "bottomLeft",
  });

  assert.equal(state.rootBodyZMax(), 5);
  assert.equal(state.geometryZMax(), 30);
});

test("Flip process step flips directions and sets cursor from root bodies only", () => {
  const state = ProcessGeometryState.create({ key: "flip-root" });
  state.initializeBoxLayer({
    material: "carrier",
    bottomLeft: [-10, -10, 0],
    topRight: [10, 10, 0],
    thickness: 10,
  });
  state.addViaAboveCursor({
    material: "Cu",
    density: 0.5,
    thickness: 2,
    direction: "+z",
  });
  state.addBump({
    material: "SnAg",
    density: 0.8,
    direction: "-z",
    geometry: {
      type: "box",
      bottomLeft: [-5, -5, -2],
      topRight: [5, 5, -2],
      thickness: 2,
    },
  });

  const child = ProcessGeometryState.create({ key: "die" });
  child.initializeBoxLayer({
    material: "Si",
    bottomLeft: [0, 0, 0],
    topRight: [4, 4, 0],
    thickness: 5,
  });
  state.placeGeometryState(child, {
    x: 0,
    y: 0,
    bottomZ: 20,
    anchor: "bottomLeft",
  });

  executeFlip({
    state,
    geometryState: (fieldId) => (fieldId === "main_geometry" ? state : null),
  });

  const output = state.toGeometryStructure();
  assert.equal(state.cursorZ(), 25);
  assert.equal(state.geometryZMin(), 0);
  assert.equal(state.geometryZMax(), 27);
  assert.equal(output.root.vias[0].direction, "-z");
  assert.equal(output.root.bumps[0].direction, "+z");
  assert.deepEqual(output.root.bodies[0].geometry.bottom_left, [-10, -10, 15]);
  assert.equal(output.root.bodies[0].geometry.thk, 10);
  assert.deepEqual(
    output.root.children[0].bodies[0].geometry.bottom_left,
    [0, 0, 0],
  );
});

test("micro bump formation uses process footprint and recursive lowest body", () => {
  const state = ProcessGeometryState.create({ key: "bump-root" });
  state.initializeBoxLayer({
    material: "carrier",
    bottomLeft: [-100, -100, 10],
    topRight: [100, 100, 10],
    thickness: 10,
  });
  const child = ProcessGeometryState.create({ key: "die-child" });
  child.initializeBoxLayer({
    material: "Si",
    bottomLeft: [-20, -20, 5],
    topRight: [20, 20, 5],
    thickness: 5,
  });
  state.placeGeometryState(child, {
    x: 0,
    y: 0,
    bottomZ: 0,
    anchor: "center",
  });

  executeMicroBump({
    state,
    values: {
      material: "SnAg",
      thk: 2,
      density: 80,
      koz: 10,
    },
    geometryState: (fieldId) => (fieldId === "main_geometry" ? state : null),
  });

  const output = state.toGeometryStructure();
  assert.equal(output.root.bumps.length, 1);
  assert.equal(output.root.bumps[0].material, "SnAg");
  assert.equal(output.root.bumps[0].density, 80);
  assert.equal(output.root.bumps[0].direction, "-z");
  assert.deepEqual(output.root.bumps[0].geometry.bottom_left, [-90, -90, -2]);
  assert.deepEqual(output.root.bumps[0].geometry.top_right, [90, 90, -2]);
  assert.equal(output.root.bumps[0].geometry.thk, 2);
});

test("CAD converter reports missing OpenCascade instance clearly", () => {
  assert.throws(
    () => new OpenCascadeConverter(null),
    CadExportError,
  );
});

test("CAD converter requires explicit primitive type", () => {
  const converter = new OpenCascadeConverter({});

  assert.throws(
    () =>
      converter.convert(
        singleBodyGeometryStructure({
          bottom_left: [0, 0, 0],
          top_right: [1, 1, 0],
          thk: 1,
        }),
      ),
    /Unknown geometry type: undefined/,
  );
});

test("CAD converter exports a box with OpenCascade.js", async () => {
  const result = await convertCad(
    {
      key: "root",
      bodies: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [0, 0, 0],
            top_right: [1, 1, 0],
            thk: 1,
          },
          material: "test",
        },
      ],
      children: [],
    },
    { formats: ["glb"] },
  );

  assert.ok(result.files.glb.byteLength > 0);
  assert.equal(result.manifest.bodies.length, 1);
});

test("CAD converter manifest preserves via and bump directions", () => {
  const converter = new OpenCascadeConverter({});
  const structure = normalizeGeometryStructure({
    key: "root",
    bodies: [
      {
        geometry: {
          type: "BoxGeometry",
          bottom_left: [0, 0, 0],
          top_right: [10, 10, 0],
          thk: 1,
        },
        material: "carrier",
      },
    ],
    vias: [
      {
        geometry: {
          type: "CylinderGeometry",
          center: [2, 2, 0],
          bottom_radius: 0.5,
          thk: 1,
        },
        material: "Cu",
        density: 0.4,
        direction: "+z",
      },
    ],
    circuits: [
      {
        geometry: {
          type: "BoxGeometry",
          bottom_left: [0, 0, 1],
          top_right: [10, 10, 1],
          thk: 0.1,
        },
        material: "Cu",
        density: 0.2,
      },
    ],
    bumps: [
      {
        geometry: {
          type: "ConeGeometry",
          center: [5, 5, -1],
          bottom_radius: 1,
          top_radius: 0.5,
          thk: 1,
        },
        material: "SnAg",
        density: 0.8,
        direction: "-z",
      },
    ],
    children: [],
  });
  const manifest = converter._buildManifest(structure, []);

  assert.deepEqual(
    manifest.features.map((feature) => [
      feature.featureType,
      feature.direction,
    ]),
    [
      ["via", "+z"],
      ["circuit", undefined],
      ["bump", "-z"],
    ],
  );
});

test("CAD converter writes GLB colors from body materials", async () => {
  const result = await convertCad(
    {
      key: "root",
      bodies: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [0, 0, 0],
            top_right: [1, 1, 0],
            thk: 1,
          },
          material: "Cu",
        },
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [2, 0, 0],
            top_right: [3, 1, 0],
            thk: 1,
          },
          material: "Si die",
        },
      ],
      children: [],
    },
    { formats: ["glb"] },
  );

  const glbJson = readGlbJson(result.files.glb);
  const baseColors = (glbJson.materials ?? []).map(
    (material) => material.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3),
  );

  assert.equal(baseColors.length, 2);
  assertColorClose(baseColors[0], linearBaseColorForHex(materialColorHex("Cu")));
  assertColorClose(
    baseColors[1],
    linearBaseColorForHex(materialColorHex("Si die")),
  );
  assert.deepEqual(
    (glbJson.nodes ?? []).map((node) => node.name),
    ["Cu body 1", "Si die body 2"],
  );
  assert.equal(materialColorHex("SAC305"), materialColorHex("SnAg"));
});

test("geometry hydration restores process state from geometry structure", () => {
  const state = geometryStructureToProcessGeometryState(kernelInputGeometry());

  state.depositLayer({ material: "EMC-A", thickness: 5 });

  const output = state.toGeometryStructure();
  assert.equal(output.root.bodies.length, 2);
  assert.deepEqual(output.root.bodies[1].geometry.bottom_left, [-50, -50, 10]);
  assert.equal(output.root.bodies[1].geometry.thk, 5);
});

test("geometry kernel resolves step definition by program path", async () => {
  const kernel = createTestKernel();

  const result = await kernel.execute("flow_inst_kernel_test");
  const geometry = result.geometry();

  assert.equal(geometry.schemaVersion, "1.0.0");
  assert.equal(geometry.root.bodies.length, 2);
  assert.equal(geometry.root.bodies[1].material, "EMC-A");
  assert.deepEqual(geometry.root.bodies[1].geometry.bottom_left, [-50, -50, 10]);
  assert.equal(geometry.root.bodies[1].geometry.thk, 5);
  assert.deepEqual(result.terminalStepRefIds(), ["molding"]);
  assert.ok(result.stepOutput("molding"));
});

test("geometry kernel imports and executes real molding process step", async () => {
  const kernel = createTestKernel({
    processStepTemplates: [realMoldingStepTemplate()],
    flowTemplate: {
      id: "flow_tpl_kernel_test",
      stepRefs: [
        {
          stepRefId: "molding",
          processStepTemplateId: "step_tpl_molding_1_0_0",
        },
      ],
      flowEdges: [
        {
          edgeId: "edge_input_to_molding",
          source: { sourceType: "geometryRef" },
          target: {
            stepRefId: "molding",
            targetFieldId: "main_geometry",
          },
        },
      ],
    },
    flowInstance: {
      id: "flow_inst_kernel_test",
      processFlowTemplateId: "flow_tpl_kernel_test",
      stepValueSets: [
        {
          stepRefId: "molding",
          processStepTemplateId: "step_tpl_molding_1_0_0",
          fieldValues: [
            { fieldId: "main_geometry", value: "geom_kernel_input" },
            { fieldId: "material", value: "EMC-A" },
            { fieldId: "thickness", value: 5 },
          ],
        },
      ],
    },
    moduleResolver: new ProcessStepModuleResolver(),
  });

  const geometry = (await kernel.execute("flow_inst_kernel_test")).geometry();

  assert.equal(geometry.root.bodies.length, 2);
  assert.equal(geometry.root.bodies[1].material, "EMC-A");
  assert.deepEqual(geometry.root.bodies[1].geometry.bottom_left, [-50, -50, 10]);
  assert.equal(geometry.root.bodies[1].geometry.thk, 5);
});

test("geometry kernel imports and executes real RDL process step", async () => {
  const kernel = createTestKernel({
    processStepTemplates: [realRdlStepTemplate()],
    flowTemplate: {
      id: "flow_tpl_kernel_test",
      stepRefs: [
        {
          stepRefId: "rdl",
          processStepTemplateId: "step_tpl_rdl_1_0_0",
        },
      ],
      flowEdges: [
        {
          edgeId: "edge_input_to_rdl",
          source: { sourceType: "geometryRef" },
          target: {
            stepRefId: "rdl",
            targetFieldId: "main_geometry",
          },
        },
      ],
    },
    flowInstance: {
      id: "flow_inst_kernel_test",
      processFlowTemplateId: "flow_tpl_kernel_test",
      stepValueSets: [
        {
          stepRefId: "rdl",
          processStepTemplateId: "step_tpl_rdl_1_0_0",
          fieldValues: [
            { fieldId: "main_geometry", value: "geom_kernel_input" },
            {
              fieldId: "layers",
              value: {
                items: [
                  {
                    itemId: "rdl_layer_1",
                    index: 1,
                    fieldValues: [
                      { fieldId: "Dielectric", value: "PI-1" },
                      { fieldId: "Conductivity", value: "Cu" },
                      { fieldId: "thk", value: 2 },
                      { fieldId: "density", value: 45 },
                    ],
                  },
                  {
                    itemId: "rdl_layer_2",
                    index: 2,
                    fieldValues: [
                      { fieldId: "Dielectric", value: "PI-2" },
                      { fieldId: "Conductivity", value: "Cu" },
                      { fieldId: "thk", value: 3 },
                      { fieldId: "density", value: 60 },
                    ],
                  },
                  {
                    itemId: "rdl_layer_3",
                    index: 3,
                    fieldValues: [
                      { fieldId: "Dielectric", value: "PI-3" },
                      { fieldId: "Conductivity", value: "Cu-Ni" },
                      { fieldId: "thk", value: 4 },
                      { fieldId: "density", value: 75 },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    moduleResolver: new ProcessStepModuleResolver(),
  });

  const geometry = (await kernel.execute("flow_inst_kernel_test")).geometry();

  assert.equal(geometry.root.bodies.length, 4);
  assert.equal(geometry.root.bodies[1].material, "PI-1");
  assert.deepEqual(geometry.root.bodies[1].geometry.bottom_left, [-50, -50, 10]);
  assert.equal(geometry.root.bodies[1].geometry.thk, 2);
  assert.equal(geometry.root.bodies[2].material, "PI-2");
  assert.deepEqual(geometry.root.bodies[2].geometry.bottom_left, [-50, -50, 12]);
  assert.equal(geometry.root.bodies[2].geometry.thk, 3);
  assert.equal(geometry.root.bodies[3].material, "PI-3");
  assert.deepEqual(geometry.root.bodies[3].geometry.bottom_left, [-50, -50, 15]);
  assert.equal(geometry.root.bodies[3].geometry.thk, 4);

  assert.equal(geometry.root.circuits.length, 2);
  assert.equal(geometry.root.circuits[0].material, "Cu");
  assert.equal(geometry.root.circuits[0].density, 45);
  assert.deepEqual(geometry.root.circuits[0].geometry.bottom_left, [-50, -50, 10]);
  assert.equal(geometry.root.circuits[0].geometry.thk, 2);
  assert.equal(geometry.root.circuits[1].material, "Cu-Ni");
  assert.equal(geometry.root.circuits[1].density, 75);
  assert.deepEqual(geometry.root.circuits[1].geometry.bottom_left, [-50, -50, 15]);
  assert.equal(geometry.root.circuits[1].geometry.thk, 4);

  assert.equal(geometry.root.vias.length, 1);
  assert.equal(geometry.root.vias[0].material, "Cu");
  assert.equal(geometry.root.vias[0].density, 60);
  assert.equal(geometry.root.vias[0].direction, "-z");
  assert.deepEqual(geometry.root.vias[0].geometry.bottom_left, [-50, -50, 12]);
  assert.equal(geometry.root.vias[0].geometry.thk, 3);
});

test("geometry kernel imports and executes real bounding bump process steps", async () => {
  const variants = [
    {
      id: "step_tpl_ubump_formation_1_0_0",
      name: "Micro Bump",
      program: "bump/uBump_formation",
    },
    {
      id: "step_tpl_bga_bump_formation_1_0_0",
      name: "BGA Bump",
      program: "bump/bga_bump_formation",
    },
    {
      id: "step_tpl_c4_bump_formation_1_0_0",
      name: "C4 Bump",
      program: "bump/c4_bump_formation",
    },
  ];

  for (const variant of variants) {
    const kernel = createTestKernel({
      processStepTemplates: [realBumpStepTemplate(variant)],
      flowTemplate: {
        id: "flow_tpl_kernel_test",
        stepRefs: [
          {
            stepRefId: "bump",
            processStepTemplateId: variant.id,
          },
        ],
        flowEdges: [
          {
            edgeId: "edge_input_to_bump",
            source: { sourceType: "geometryRef" },
            target: {
              stepRefId: "bump",
              targetFieldId: "main_geometry",
            },
          },
        ],
      },
      flowInstance: {
        id: "flow_inst_kernel_test",
        processFlowTemplateId: "flow_tpl_kernel_test",
        stepValueSets: [
          {
            stepRefId: "bump",
            processStepTemplateId: variant.id,
            fieldValues: [
              { fieldId: "main_geometry", value: "geom_kernel_input" },
              { fieldId: "material", value: "SnAg" },
              { fieldId: "thk", value: 3 },
              { fieldId: "density", value: 75 },
              { fieldId: "koz", value: 5 },
            ],
          },
        ],
      },
      moduleResolver: new ProcessStepModuleResolver(),
    });

    const geometry = (await kernel.execute("flow_inst_kernel_test")).geometry();

    assert.equal(geometry.root.bumps.length, 1);
    assert.equal(geometry.root.bumps[0].material, "SnAg");
    assert.equal(geometry.root.bumps[0].density, 75);
    assert.equal(geometry.root.bumps[0].direction, "-z");
    assert.deepEqual(geometry.root.bumps[0].geometry.bottom_left, [-45, -45, -3]);
    assert.deepEqual(geometry.root.bumps[0].geometry.top_right, [45, 45, -3]);
    assert.equal(geometry.root.bumps[0].geometry.thk, 3);
  }
});

test("Grinding process step can grind geometry flat while retaining footprint", () => {
  const state = ProcessGeometryState.create({ key: "grind-flat" });
  state.initializeBoxLayer({
    material: "carrier",
    bottomLeft: [-50, -50, 0],
    topRight: [50, 50, 0],
    thickness: 10,
  });
  const footprint = state.processFootprint();

  executeGrinding({
    state,
    values: { thk: 15 },
    geometryState: (fieldId) => (fieldId === "main_geometry" ? state : null),
  });

  assert.equal(state.inspect().bodyCount, 0);
  assert.deepEqual(state.processFootprint(), footprint);
});

test("geometry kernel imports real Grinding step and preserves footprint for downstream steps", async () => {
  const kernel = createTestKernel({
    processStepTemplates: [realGrindingStepTemplate(), realMoldingStepTemplate()],
    flowTemplate: {
      id: "flow_tpl_kernel_test",
      stepRefs: [
        {
          stepRefId: "grinding",
          processStepTemplateId: "step_tpl_grinding_1_0_0",
        },
        {
          stepRefId: "molding",
          processStepTemplateId: "step_tpl_molding_1_0_0",
        },
      ],
      flowEdges: [
        {
          edgeId: "edge_input_to_grinding",
          source: { sourceType: "geometryRef" },
          target: {
            stepRefId: "grinding",
            targetFieldId: "main_geometry",
          },
        },
        {
          edgeId: "edge_grinding_to_molding",
          source: { sourceType: "stepOutput", stepRefId: "grinding" },
          target: {
            stepRefId: "molding",
            targetFieldId: "main_geometry",
          },
        },
      ],
    },
    flowInstance: {
      id: "flow_inst_kernel_test",
      processFlowTemplateId: "flow_tpl_kernel_test",
      stepValueSets: [
        {
          stepRefId: "grinding",
          processStepTemplateId: "step_tpl_grinding_1_0_0",
          fieldValues: [
            { fieldId: "main_geometry", value: "geom_kernel_input" },
            { fieldId: "thk", value: 4 },
          ],
        },
        {
          stepRefId: "molding",
          processStepTemplateId: "step_tpl_molding_1_0_0",
          fieldValues: [
            { fieldId: "main_geometry", value: null },
            { fieldId: "material", value: "EMC-A" },
            { fieldId: "thickness", value: 2 },
          ],
        },
      ],
    },
    moduleResolver: new ProcessStepModuleResolver(),
  });

  const result = await kernel.execute("flow_inst_kernel_test");
  const grindingOutput = result.stepOutput("grinding");
  const geometry = result.geometry();

  assert.equal(grindingOutput.root.bodies.length, 1);
  assert.equal(grindingOutput.root.bodies[0].geometry.thk, 6);
  assert.equal(geometry.root.bodies.length, 2);
  assert.equal(geometry.root.bodies[0].geometry.thk, 6);
  assert.equal(geometry.root.bodies[1].material, "EMC-A");
  assert.deepEqual(geometry.root.bodies[1].geometry.bottom_left, [-50, -50, 6]);
  assert.equal(geometry.root.bodies[1].geometry.thk, 2);
});

test("geometry kernel imports real Flip step and passes root-body cursor downstream", async () => {
  const kernel = createTestKernel({
    geometryEntities: [
      {
        id: "geom_kernel_flip",
        category: "carrier.panel",
        name: "Kernel flip input",
        version: "v1",
        owner: "test",
        description: "Geometry kernel flip test input",
        structureFormat: "standard",
        structure: kernelFlipGeometry(),
      },
    ],
    processStepTemplates: [realFlipStepTemplate(), realMoldingStepTemplate()],
    flowTemplate: {
      id: "flow_tpl_kernel_test",
      stepRefs: [
        {
          stepRefId: "flip",
          processStepTemplateId: "step_tpl_flip_1_0_0",
        },
        {
          stepRefId: "molding",
          processStepTemplateId: "step_tpl_molding_1_0_0",
        },
      ],
      flowEdges: [
        {
          edgeId: "edge_input_to_flip",
          source: { sourceType: "geometryRef" },
          target: {
            stepRefId: "flip",
            targetFieldId: "main_geometry",
          },
        },
        {
          edgeId: "edge_flip_to_molding",
          source: { sourceType: "stepOutput", stepRefId: "flip" },
          target: {
            stepRefId: "molding",
            targetFieldId: "main_geometry",
          },
        },
      ],
    },
    flowInstance: {
      id: "flow_inst_kernel_test",
      processFlowTemplateId: "flow_tpl_kernel_test",
      stepValueSets: [
        {
          stepRefId: "flip",
          processStepTemplateId: "step_tpl_flip_1_0_0",
          fieldValues: [{ fieldId: "main_geometry", value: "geom_kernel_flip" }],
        },
        {
          stepRefId: "molding",
          processStepTemplateId: "step_tpl_molding_1_0_0",
          fieldValues: [
            { fieldId: "main_geometry", value: null },
            { fieldId: "material", value: "EMC-A" },
            { fieldId: "thickness", value: 3 },
          ],
        },
      ],
    },
    moduleResolver: new ProcessStepModuleResolver(),
  });

  const result = await kernel.execute("flow_inst_kernel_test");
  const flipOutput = result.stepOutput("flip");
  const geometry = result.geometry();

  assert.equal(flipOutput.root.bodies.length, 1);
  assert.deepEqual(flipOutput.root.bodies[0].geometry.bottom_left, [-10, -10, 15]);
  assert.equal(flipOutput.root.bodies[0].geometry.thk, 10);
  assert.equal(flipOutput.root.vias[0].direction, "-z");
  assert.deepEqual(flipOutput.root.vias[0].geometry.bottom_left, [-10, -10, 13]);
  assert.equal(flipOutput.root.bumps[0].direction, "+z");
  assert.deepEqual(
    flipOutput.root.children[0].bodies[0].geometry.bottom_left,
    [0, 0, 0],
  );

  assert.equal(geometry.root.bodies.length, 2);
  assert.equal(geometry.root.bodies[1].material, "EMC-A");
  assert.deepEqual(geometry.root.bodies[1].geometry.bottom_left, [-10, -10, 25]);
  assert.equal(geometry.root.bodies[1].geometry.thk, 3);
});

test("geometry kernel imports and executes real PnP process step", async () => {
  const kernel = createTestKernel({
    geometryEntities: [
      {
        id: "geom_kernel_input",
        category: "carrier.panel",
        name: "Kernel input panel",
        version: "v1",
        owner: "test",
        description: "Geometry kernel test input",
        structureFormat: "standard",
        structure: kernelInputGeometry(),
      },
      {
        id: "geom_kernel_die",
        category: "initial.die",
        name: "Kernel test die",
        version: "v1",
        owner: "test",
        description: "Geometry kernel test die with bump bottom",
        structureFormat: "standard",
        structure: kernelDieGeometry(),
      },
    ],
    processStepTemplates: [realPnpStepTemplate(), realMoldingStepTemplate()],
    flowTemplate: {
      id: "flow_tpl_kernel_test",
      stepRefs: [
        {
          stepRefId: "pnp",
          processStepTemplateId: "step_tpl_pnp_1_0_0",
        },
        {
          stepRefId: "molding",
          processStepTemplateId: "step_tpl_molding_1_0_0",
        },
      ],
      flowEdges: [
        {
          edgeId: "edge_input_to_pnp",
          source: { sourceType: "geometryRef" },
          target: {
            stepRefId: "pnp",
            targetFieldId: "main_geometry",
          },
        },
        {
          edgeId: "edge_die_to_pnp",
          source: { sourceType: "geometryRef" },
          target: {
            stepRefId: "pnp",
            targetFieldId: "die_geometry",
          },
        },
        {
          edgeId: "edge_pnp_to_molding",
          source: { sourceType: "stepOutput", stepRefId: "pnp" },
          target: {
            stepRefId: "molding",
            targetFieldId: "main_geometry",
          },
        },
      ],
    },
    flowInstance: {
      id: "flow_inst_kernel_test",
      processFlowTemplateId: "flow_tpl_kernel_test",
      stepValueSets: [
        {
          stepRefId: "pnp",
          processStepTemplateId: "step_tpl_pnp_1_0_0",
          fieldValues: [
            { fieldId: "main_geometry", value: "geom_kernel_input" },
            { fieldId: "die_geometry", value: "geom_kernel_die" },
            {
              fieldId: "coordinates",
              value: {
                items: [
                  {
                    itemId: "die_1",
                    index: 1,
                    fieldValues: [
                      { fieldId: "bottemLeftX", value: 10 },
                      { fieldId: "bottemLeftY", value: 20 },
                    ],
                  },
                  {
                    itemId: "die_2",
                    index: 2,
                    fieldValues: [
                      { fieldId: "bottemLeftX", value: -5 },
                      { fieldId: "bottemLeftY", value: 0 },
                    ],
                  },
                ],
              },
            },
          ],
        },
        {
          stepRefId: "molding",
          processStepTemplateId: "step_tpl_molding_1_0_0",
          fieldValues: [
            { fieldId: "main_geometry", value: null },
            { fieldId: "material", value: "EMC-A" },
            { fieldId: "thickness", value: 5 },
          ],
        },
      ],
    },
    moduleResolver: new ProcessStepModuleResolver(),
  });

  const result = await kernel.execute("flow_inst_kernel_test");
  const pnpOutput = result.stepOutput("pnp");
  const geometry = result.geometry();

  assert.equal(pnpOutput.root.children.length, 2);
  assert.deepEqual(
    pnpOutput.root.children.map((child) => child.bumps[0].geometry.bottom_left),
    [
      [11, 21, 10],
      [-4, 1, 10],
    ],
  );
  assert.deepEqual(
    pnpOutput.root.children.map((child) => child.bodies[0].geometry.bottom_left),
    [
      [10, 20, 12],
      [-5, 0, 12],
    ],
  );
  assert.equal(geometry.root.bodies.length, 2);
  assert.equal(geometry.root.bodies[1].material, "EMC-A");
  assert.deepEqual(geometry.root.bodies[1].geometry.bottom_left, [-50, -50, 10]);
  assert.equal(geometry.root.children.length, 2);
});

test("process step module resolver validates program paths", () => {
  const resolver = new ProcessStepModuleResolver();
  const template = {
    id: "step_tpl_test_molding",
    program: "test/molding",
  };

  assert.match(
    resolver.moduleSpecifier(template),
    /\/process\/test\/molding\.js$/,
  );
  assert.throws(
    () => resolver.moduleSpecifier({ ...template, program: "" }),
    /missing program/,
  );
  assert.throws(
    () => resolver.moduleSpecifier({ ...template, program: "/absolute/path" }),
    /relative to src\/process/,
  );
  assert.throws(
    () => resolver.moduleSpecifier({ ...template, program: "test/molding.js" }),
    /must not include \.js/,
  );
  assert.throws(
    () => resolver.moduleSpecifier({ ...template, program: "test/../molding" }),
    /relative to src\/process/,
  );
  assert.throws(
    () => resolver.moduleSpecifier({ ...template, program: "test/molding.v1" }),
    /relative to src\/process/,
  );
});

test("geometry kernel passes step output geometry to downstream steps", async () => {
  const kernel = createTestKernel({
    flowTemplate: {
      id: "flow_tpl_kernel_test",
      stepRefs: [
        {
          stepRefId: "molding_1",
          processStepTemplateId: "step_tpl_test_molding",
        },
        {
          stepRefId: "molding_2",
          processStepTemplateId: "step_tpl_test_molding",
        },
      ],
      flowEdges: [
        {
          edgeId: "edge_input_to_molding_1",
          source: { sourceType: "geometryRef" },
          target: {
            stepRefId: "molding_1",
            targetFieldId: "main_geometry",
          },
        },
        {
          edgeId: "edge_molding_1_to_molding_2",
          source: { sourceType: "stepOutput", stepRefId: "molding_1" },
          target: {
            stepRefId: "molding_2",
            targetFieldId: "main_geometry",
          },
        },
      ],
    },
    flowInstance: {
      id: "flow_inst_kernel_test",
      processFlowTemplateId: "flow_tpl_kernel_test",
      stepValueSets: [
        {
          stepRefId: "molding_1",
          processStepTemplateId: "step_tpl_test_molding",
          fieldValues: [
            { fieldId: "main_geometry", value: "geom_kernel_input" },
            { fieldId: "mold_compound", value: "EMC-A" },
            { fieldId: "mold_thickness", value: 5 },
          ],
        },
        {
          stepRefId: "molding_2",
          processStepTemplateId: "step_tpl_test_molding",
          fieldValues: [
            { fieldId: "main_geometry", value: null },
            { fieldId: "mold_compound", value: "EMC-B" },
            { fieldId: "mold_thickness", value: 7 },
          ],
        },
      ],
    },
  });

  const geometry = (await kernel.execute("flow_inst_kernel_test")).geometry();

  assert.equal(geometry.root.bodies.length, 3);
  assert.equal(geometry.root.bodies[2].material, "EMC-B");
  assert.deepEqual(geometry.root.bodies[2].geometry.bottom_left, [-50, -50, 15]);
  assert.equal(geometry.root.bodies[2].geometry.thk, 7);
});

test("geometry kernel normalizes repeater values before executing handler", async () => {
  const kernel = createTestKernel({
    processStepTemplates: [rdlStepTemplate()],
    flowTemplate: {
      id: "flow_tpl_kernel_test",
      stepRefs: [
        {
          stepRefId: "rdl",
          processStepTemplateId: "step_tpl_test_rdl",
        },
      ],
      flowEdges: [
        {
          edgeId: "edge_input_to_rdl",
          source: { sourceType: "geometryRef" },
          target: {
            stepRefId: "rdl",
            targetFieldId: "main_geometry",
          },
        },
      ],
    },
    flowInstance: {
      id: "flow_inst_kernel_test",
      processFlowTemplateId: "flow_tpl_kernel_test",
      stepValueSets: [
        {
          stepRefId: "rdl",
          processStepTemplateId: "step_tpl_test_rdl",
          fieldValues: [
            { fieldId: "main_geometry", value: "geom_kernel_input" },
            {
              fieldId: "rdl_layers",
              value: {
                items: [
                  {
                    itemId: "rdl_layer_1",
                    index: 1,
                    fieldValues: [
                      { fieldId: "pm_material", value: "PI" },
                      { fieldId: "metal_material", value: "Cu" },
                      { fieldId: "density", value: "0.25" },
                      { fieldId: "thk", value: "3" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  });

  const geometry = (await kernel.execute("flow_inst_kernel_test")).geometry();

  assert.equal(geometry.root.bodies.length, 2);
  assert.equal(geometry.root.bodies[1].material, "PI");
  assert.equal(geometry.root.vias.length, 1);
  assert.equal(geometry.root.vias[0].material, "Cu");
  assert.equal(geometry.root.vias[0].density, 0.25);
  assert.equal(geometry.root.vias[0].direction, "-z");
  assert.equal(geometry.root.vias[0].geometry.thk, 3);
});

test("geometry kernel reports unsupported process step modules clearly", async () => {
  const kernel = createTestKernel({
    processStepTemplates: [
      {
        ...moldingStepTemplate(),
        id: "missing_process_step",
        category: "missing.category",
        program: "missing/category/missing_process_step",
      },
    ],
    flowTemplate: {
      id: "flow_tpl_kernel_test",
      stepRefs: [
        {
          stepRefId: "missing",
          processStepTemplateId: "missing_process_step",
        },
      ],
      flowEdges: [
        {
          edgeId: "edge_input_to_missing",
          source: { sourceType: "geometryRef" },
          target: { stepRefId: "missing", targetFieldId: "main_geometry" },
        },
      ],
    },
    flowInstance: {
      id: "flow_inst_kernel_test",
      processFlowTemplateId: "flow_tpl_kernel_test",
      stepValueSets: [
        {
          stepRefId: "missing",
          processStepTemplateId: "missing_process_step",
          fieldValues: [
            { fieldId: "main_geometry", value: "geom_kernel_input" },
            { fieldId: "mold_compound", value: "EMC-A" },
            { fieldId: "mold_thickness", value: 5 },
          ],
        },
      ],
    },
  });

  await assert.rejects(
    () => kernel.execute("flow_inst_kernel_test"),
    /Unable to load process step module for missing_process_step/,
  );
});

test("geometry kernel glb exports output geometry", async () => {
  const result = await createTestKernel().execute("flow_inst_kernel_test");

  const glb = await result.glb();

  assert.ok(glb.byteLength > 0);
});

function createTestKernel({
  geometryEntities = [
    {
      id: "geom_kernel_input",
      category: "carrier.panel",
      name: "Kernel input panel",
      version: "v1",
      owner: "test",
      description: "Geometry kernel test input",
      structureFormat: "standard",
      structure: kernelInputGeometry(),
    },
  ],
  processStepTemplates = [moldingStepTemplate()],
  flowTemplate = kernelFlowTemplate(),
  flowInstance = kernelFlowInstance(),
  moduleResolver = new TestProcessModuleResolver(),
} = {}) {
  return new GeometryKernel({
    geometryRepository: new InMemoryRepository(geometryEntities),
    processFlowInstanceRepository: new InMemoryRepository([flowInstance]),
    processFlowTemplateRepository: new InMemoryRepository([flowTemplate]),
    processStepRepository: new InMemoryRepository(processStepTemplates),
    moduleResolver,
  });
}

class TestProcessModuleResolver {
  constructor() {
    this._resolver = new ProcessStepModuleResolver({
      importModule: async () => ({ execute() {} }),
    });
    this._handlers = new Map([
      ["test/molding", executeTestMolding],
      ["test/rdl", executeTestRdl],
    ]);
  }

  moduleSpecifier(stepTemplate) {
    return this._resolver.moduleSpecifier(stepTemplate);
  }

  async resolve(stepTemplate) {
    const execute = this._handlers.get(stepTemplate.program);
    if (!execute) {
      throw new Error(
        `Unable to load process step module for ${stepTemplate.id}`,
      );
    }
    return {
      execute,
      specifier: this.moduleSpecifier(stepTemplate),
    };
  }
}

function executeTestMolding({ state, values }) {
  state.depositLayer({
    material: values.mold_compound,
    thickness: values.mold_thickness,
  });
  return state;
}

function executeTestRdl({ state, values }) {
  for (const layer of values.rdl_layers ?? []) {
    state.depositLayer({
      material: layer.pm_material,
      thickness: layer.thk,
    });
    state.addViaBelowCursor({
      material: layer.metal_material,
      density: layer.density,
      thickness: layer.thk,
    });
  }
  return state;
}

function moldingStepTemplate() {
  return {
    id: "step_tpl_test_molding",
    version: "V1.0.0",
    name: "Molding encapsulation",
    category: "test.molding",
    program: "test/molding",
    description: "Define mold compound and mold thickness.",
    owner: "test",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        scope: "inputState",
        valueType: "geometry",
        controlType: "geometry",
        selectionMode: null,
        unit: null,
      },
      {
        id: "mold_compound",
        name: "Mold compound",
        scope: "processParameter",
        valueType: "materialRef",
        controlType: "select",
        selectionMode: "single",
        unit: null,
      },
      {
        id: "mold_thickness",
        name: "Mold thickness",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: null,
      },
    ],
  };
}

function realMoldingStepTemplate() {
  return {
    id: "step_tpl_molding_1_0_0",
    version: "V1.0.0",
    name: "molding",
    category: "layer",
    program: "layer/molding",
    description: "Deposit molding material over the current process footprint.",
    owner: "test",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "material",
        name: "material",
        scope: "processParameter",
        valueType: "materialRef",
        controlType: "text",
        selectionMode: null,
        unit: null,
      },
      {
        id: "thickness",
        name: "thickness",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
      },
    ],
  };
}

function realRdlStepTemplate() {
  return {
    id: "step_tpl_rdl_1_0_0",
    version: "V1.0.0",
    name: "RDL layer",
    category: "layer",
    program: "layer/rdl",
    description: "Build RDL dielectric layers with circuit and via features.",
    owner: "test",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "layers",
        name: "layers",
        scope: "processParameter",
        valueType: "fieldGroupArray",
        controlType: "repeater",
        selectionMode: null,
        unit: null,
        repeatDefinition: {
          itemNameTemplate: "RDL layer {{index}}",
          indexBase: 1,
          minItems: 1,
          itemFieldDefinitions: [
            {
              id: "Dielectric",
              name: "Dielectric",
              scope: "processParameter",
              valueType: "materialRef",
              controlType: "text",
              selectionMode: null,
              unit: null,
            },
            {
              id: "Conductivity",
              name: "Conductivity",
              scope: "processParameter",
              valueType: "materialRef",
              controlType: "text",
              selectionMode: null,
              unit: null,
            },
            {
              id: "thk",
              name: "thk",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: "um",
            },
            {
              id: "density",
              name: "density",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: null,
            },
          ],
        },
      },
    ],
  };
}

function realBumpStepTemplate({ id, name, program }) {
  return {
    id,
    version: "V1.0.0",
    name,
    category: "bounding",
    program,
    description: "Form downward bumps below the lowest body.",
    owner: "test",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "material",
        name: "material",
        scope: "processParameter",
        valueType: "materialRef",
        controlType: "text",
        selectionMode: null,
        unit: null,
      },
      {
        id: "thk",
        name: "thk",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
      },
      {
        id: "density",
        name: "density",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: null,
      },
      {
        id: "koz",
        name: "koz",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
      },
    ],
  };
}

function realGrindingStepTemplate() {
  return {
    id: "step_tpl_grinding_1_0_0",
    version: "V1.0.0",
    name: "Grinding",
    category: "grinding",
    program: "grinding/grinding",
    description: "Remove geometry from the full geometry top downward.",
    owner: "test",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "thk",
        name: "thk",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
      },
    ],
  };
}

function realFlipStepTemplate() {
  return {
    id: "step_tpl_flip_1_0_0",
    version: "V1.0.0",
    name: "Flip",
    category: "flip",
    program: "flip/flip",
    description: "Flip geometry around Z=0 and update cursor from root bodies.",
    owner: "test",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
    ],
  };
}

function realPnpStepTemplate() {
  return {
    id: "step_tpl_pnp_1_0_0",
    version: "V1.0.0",
    name: "PnP",
    category: "PnP",
    program: "pnp/pnp",
    description: "Place die geometry copies onto a main geometry state.",
    owner: "test",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "die_geometry",
        name: "die_geometry",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "coordinates",
        name: "coordinates",
        scope: "processParameter",
        valueType: "fieldGroupArray",
        controlType: "repeater",
        selectionMode: null,
        unit: null,
        repeatDefinition: {
          itemNameTemplate: "Die {{index}}",
          indexBase: 1,
          minItems: 1,
          itemFieldDefinitions: [
            {
              id: "bottemLeftX",
              name: "bottemLeftX",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: "um",
            },
            {
              id: "bottemLeftY",
              name: "bottemLeftY",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: "um",
            },
          ],
        },
      },
    ],
  };
}

function rdlStepTemplate() {
  return {
    id: "step_tpl_test_rdl",
    version: "V1.0.0",
    name: "RDL build up",
    category: "test.rdl",
    program: "test/rdl",
    description: "Define repeatable PM and RDL layer parameters.",
    owner: "test",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        scope: "inputState",
        valueType: "geometry",
        controlType: "geometry",
        selectionMode: null,
        unit: null,
      },
      {
        id: "rdl_layers",
        name: "RDL layers",
        scope: "processParameter",
        valueType: "fieldGroupArray",
        controlType: "repeater",
        selectionMode: null,
        unit: null,
        repeatDefinition: {
          itemNameTemplate: "RDL layer {{index}}",
          indexBase: 1,
          itemFieldDefinitions: [
            {
              id: "pm_material",
              name: "PM material",
              scope: "processParameter",
              valueType: "materialRef",
              controlType: "select",
              selectionMode: "single",
              unit: null,
            },
            {
              id: "metal_material",
              name: "Metal material",
              scope: "processParameter",
              valueType: "materialRef",
              controlType: "select",
              selectionMode: "single",
              unit: null,
            },
            {
              id: "density",
              name: "Density",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: null,
            },
            {
              id: "thk",
              name: "Thickness",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: null,
            },
          ],
        },
      },
    ],
  };
}

function kernelFlowTemplate() {
  return {
    id: "flow_tpl_kernel_test",
    stepRefs: [
      {
        stepRefId: "molding",
        processStepTemplateId: "step_tpl_test_molding",
      },
    ],
    flowEdges: [
      {
        edgeId: "edge_input_to_molding",
        source: { sourceType: "geometryRef" },
        target: {
          stepRefId: "molding",
          targetFieldId: "main_geometry",
        },
      },
    ],
  };
}

function kernelFlowInstance() {
  return {
    id: "flow_inst_kernel_test",
    processFlowTemplateId: "flow_tpl_kernel_test",
    stepValueSets: [
      {
        stepRefId: "molding",
        processStepTemplateId: "step_tpl_test_molding",
        fieldValues: [
          { fieldId: "main_geometry", value: "geom_kernel_input" },
          { fieldId: "mold_compound", value: "EMC-A" },
          { fieldId: "mold_thickness", value: 5 },
        ],
      },
    ],
  };
}

function singleBodyGeometryStructure(geometry) {
  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      key: "single-body",
      bodies: [
        {
          geometry,
          material: "test",
        },
      ],
      vias: [],
      circuits: [],
      bumps: [],
      children: [],
    },
  };
}

function kernelInputGeometry() {
  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      key: "kernel-input",
      bodies: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [-50, -50, 0],
            top_right: [50, 50, 0],
            thk: 10,
          },
          material: "carrier",
        },
      ],
      vias: [],
      circuits: [],
      bumps: [],
      children: [],
    },
  };
}

function kernelFlipGeometry() {
  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      key: "kernel-flip",
      bodies: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [-10, -10, 0],
            top_right: [10, 10, 0],
            thk: 10,
          },
          material: "carrier",
        },
      ],
      vias: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [-10, -10, 10],
            top_right: [10, 10, 10],
            thk: 2,
          },
          material: "Cu",
          density: 0.5,
          direction: "+z",
        },
      ],
      circuits: [],
      bumps: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [-5, -5, -2],
            top_right: [5, 5, -2],
            thk: 2,
          },
          material: "SnAg",
          density: 0.8,
          direction: "-z",
        },
      ],
      children: [
        {
          key: "die",
          bodies: [
            {
              geometry: {
                type: "BoxGeometry",
                bottom_left: [0, 0, 20],
                top_right: [4, 4, 20],
                thk: 5,
              },
              material: "Si",
            },
          ],
          vias: [],
          circuits: [],
          bumps: [],
          children: [],
        },
      ],
    },
  };
}

function kernelDieGeometry() {
  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      key: "kernel-die",
      bodies: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [0, 0, 2],
            top_right: [4, 3, 2],
            thk: 5,
          },
          material: "Si",
        },
      ],
      vias: [],
      circuits: [],
      bumps: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [1, 1, 0],
            top_right: [3, 2, 0],
            thk: 2,
          },
          material: "SnAg",
          density: 0.8,
          direction: "-z",
        },
      ],
      children: [],
    },
  };
}

function readGlbJson(glbBytes) {
  const buffer = Buffer.from(glbBytes);
  assert.equal(buffer.toString("utf8", 0, 4), "glTF");
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  assert.equal(jsonType, 0x4e4f534a);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").trim());
}

function linearBaseColorForHex(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  assert.ok(match);
  return [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    if (channel <= 0.04045) return channel / 12.92;
    return ((channel + 0.055) / 1.055) ** 2.4;
  });
}

function assertColorClose(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((channel, index) => {
    assert.ok(
      Math.abs(channel - expected[index]) < 1e-6,
      `color channel ${index} expected ${expected[index]} but received ${channel}`,
    );
  });
}
