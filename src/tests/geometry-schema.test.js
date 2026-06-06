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
