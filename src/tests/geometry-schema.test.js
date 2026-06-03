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
import { processBgaBump } from "../process/process-bgaBump.js";
import { processC4Bump } from "../process/process-c4Bump.js";
import { processMolding } from "../process/process-molding.js";
import { processPanel } from "../process/process-panel.js";
import { processPnp } from "../process/process-pnp.js";
import { processRdl } from "../process/process-rdl.js";
import { Status } from "../process/status.js";
import {
  CadExportError,
  OpenCascadeConverter,
  convertCad,
  materialColorHex,
} from "../exporters/cad.js";
import {
  GeometryKernel,
  InMemoryRepository,
  geometryStructureToStatus,
} from "../kernel/index.js";
import { parseExampleArgs } from "../examples/generate-json.js";

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
    new Via(new CylinderGeometry([0, 0, 0], 1, 2), 0.5, "via"),
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
    new Bump(new ConeGeometry([0, 0, 0], 2, 1, 3), 0.7, "bump"),
  );

  const output = root.json();

  assert.equal(output.root.bodies[0].geometry.type, "BoxGeometry");
  assert.equal(output.root.vias[0].geometry.type, "CylinderGeometry");
  assert.equal(output.root.circuits[0].geometry.type, "PolygonGeometry");
  assert.equal(output.root.bumps[0].geometry.type, "ConeGeometry");
});

test("geometry hydration requires explicit primitive type", () => {
  assert.throws(
    () =>
      geometryStructureToStatus(
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
      geometryStructureToStatus(
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

test("status fill and add containers track process z", () => {
  const status = new Status();
  status.initialBody(
    new Body(new BoxGeometry([0, 0, 2], [10, 10, 2], 3), "template"),
  );

  status.fillThk("base", 5);
  const die = new Container({ key: "die" });
  die.addBodyBox("silicon", [2, 2, 1], [8, 8, 1], 2);
  status.addContainers([die]);

  assert.equal(status.zNow(), 5);
  assert.equal(status.container().zMin(), 0);
  assert.equal(status.container().zMax(), 7);
  assert.equal(status.container().children()[0].zMin(), 5);
});

test("process step modules compose status independently", () => {
  const status = processPanel(new Status(), "panel", 10, 100);
  processMolding(status, "dielectric", 5);
  processRdl(status, [
    {
      pm_material: "PI",
      metal_material: "Cu",
      density: 0.2,
      thk: 3,
    },
  ]);

  assert.equal(status.zNow(), 18);
  assert.equal(status.container().bodies().length, 3);
  assert.equal(status.container().vias().length, 1);
});

test("process pnp places die copies at fieldGroupArray bottom-left points", () => {
  const targetStatus = processPanel(new Status(), "carrier", 10, 1000);
  const dieStatus = processPanel(new Status(), "silicon", 20, 100);

  processPnp(targetStatus, dieStatus, [
    { bottomLeft_x: 100, bottomLeft_y: 200 },
    { bottomLeft_x: -25, bottomLeft_y: 50 },
  ]);

  const children = targetStatus.container().children();
  assert.equal(children.length, 2);
  assert.deepEqual(children[0].bodies()[0].geometry().bottomLeft(), [
    100,
    200,
    10,
  ]);
  assert.deepEqual(children[1].bodies()[0].geometry().bottomLeft(), [
    -25,
    50,
    10,
  ]);
  assert.equal(targetStatus.zNow(), 10);
  assert.deepEqual(dieStatus.container().bodies()[0].geometry().bottomLeft(), [
    -50,
    -50,
    0,
  ]);
});

test("example pnp demo flow runs through station outputs", async () => {
  const kernel = createExampleDemoKernel();

  const pnpPreview = await kernel.execute("flow_inst_example_demo", {
    outputStepRefId: "pnp_hbm",
  });
  const pnpGeometry = pnpPreview.geometry();
  assert.equal(pnpGeometry.root.children.length, 2);
  assert.deepEqual(
    pnpGeometry.root.children[0].bodies[0].geometry.bottom_left,
    [-1750, -700, 250],
  );

  const result = await kernel.execute("flow_inst_example_demo");
  const geometry = result.geometry();

  assert.equal(geometry.root.bodies.length, 3);
  assert.equal(geometry.root.children.length, 3);
  assert.equal(geometry.root.bumps.length, 1);
  assert.equal(geometry.root.bodies[1].material, "EMC-A");
  assert.equal(geometry.root.bodies[1].geometry.bottom_left[2], 370);
  assert.equal(geometry.root.bodies[1].geometry.thk, 120);
  assert.equal(geometry.root.bodies[2].material, "EMC-B");
  assert.equal(geometry.root.bodies[2].geometry.bottom_left[2], 490);
  assert.equal(geometry.root.bodies[2].geometry.thk, 80);
  assert.equal(geometry.root.bumps[0].material, "SAC305");
  assert.equal(geometry.root.bumps[0].density, 0.55);
  assert.equal(geometry.root.bumps[0].geometry.thk, 40);

  const terminalPreview = await kernel.executePreview({
    processFlowTemplate: exampleFlowTemplate(),
    processFlowInstance: exampleFlowInstance(),
    previewTarget: { type: "stepOutput", stepRefId: "molding2" },
  });
  assert.equal(terminalPreview.sourceKind, "stepOutput");
  assert.equal(terminalPreview.outputStepRefId, "molding2");
  assert.equal(terminalPreview.geometryStructure.root.bodies.length, 3);
  assert.equal(terminalPreview.geometryStructure.root.bumps.length, 1);
});

test("bga and c4 bump processes overlap existing uncontained bumps", () => {
  const status = processPanel(new Status(), "silicon", 20, 100);
  status.container().addBump(
    new Bump(
      new BoxGeometry([-80, -80, -20], [80, 80, -20], 20),
      0.1,
      "old bump",
    ),
  );

  processBgaBump(status, "BGA", 0.2);
  processC4Bump(status, "C4", 0.3);

  const bumps = status.container().bumps();
  assert.equal(bumps.length, 3);
  assert.deepEqual(
    bumps.map((bump) => [bump.material(), bump.zMin(), bump.zMax()]),
    [
      ["old bump", -20, 0],
      ["BGA", -20, 0],
      ["C4", -20, 0],
    ],
  );
  assert.deepEqual(bumps[1].geometry().bottomLeft(), [-50, -50, -20]);
  assert.deepEqual(bumps[2].geometry().bottomLeft(), [-50, -50, -20]);
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

test("example CLI parses output format options", () => {
  assert.deepEqual(
    parseExampleArgs(["--format", "stp", "--output", "/tmp/example"]),
    {
      format: "step",
      output: "/tmp/example",
      help: false,
    },
  );
  assert.deepEqual(parseExampleArgs(["all"]), {
    format: "all",
    output: null,
    help: false,
  });
  assert.throws(() => parseExampleArgs(["--format", "iges"]), /Unsupported/);
});

test("geometry hydration restores process status from geometry structure", () => {
  const status = geometryStructureToStatus(kernelInputGeometry());

  processMolding(status, "EMC-A", 5);

  const output = status.container().json();
  assert.equal(output.root.bodies.length, 2);
  assert.deepEqual(output.root.bodies[1].geometry.bottom_left, [-50, -50, 10]);
  assert.equal(output.root.bodies[1].geometry.thk, 5);
});

test("geometry kernel resolves step definition by id and category path", async () => {
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

test("geometry kernel passes step output geometry to downstream steps", async () => {
  const kernel = createTestKernel({
    flowTemplate: {
      id: "flow_tpl_kernel_test",
      stepRefs: [
        {
          stepRefId: "molding_1",
          processStepTemplateId: "step_tpl_molding_encapsulation",
        },
        {
          stepRefId: "molding_2",
          processStepTemplateId: "step_tpl_molding_encapsulation",
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
          processStepTemplateId: "step_tpl_molding_encapsulation",
          fieldValues: [
            { fieldId: "main_geometry", value: "geom_kernel_input" },
            { fieldId: "mold_compound", value: "EMC-A" },
            { fieldId: "mold_thickness", value: 5 },
          ],
        },
        {
          stepRefId: "molding_2",
          processStepTemplateId: "step_tpl_molding_encapsulation",
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
          processStepTemplateId: "step_tpl_rdl_build_up",
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
          processStepTemplateId: "step_tpl_rdl_build_up",
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
  assert.equal(geometry.root.vias[0].geometry.thk, 3);
});

test("geometry kernel reports unsupported process step modules clearly", async () => {
  const kernel = createTestKernel({
    processStepTemplates: [
      {
        ...moldingStepTemplate(),
        id: "missing_process_step",
        category: "missing.category",
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
} = {}) {
  return new GeometryKernel({
    geometryRepository: new InMemoryRepository(geometryEntities),
    processFlowInstanceRepository: new InMemoryRepository([flowInstance]),
    processFlowTemplateRepository: new InMemoryRepository([flowTemplate]),
    processStepRepository: new InMemoryRepository(processStepTemplates),
  });
}

function moldingStepTemplate() {
  return {
    id: "step_tpl_molding_encapsulation",
    version: "V1.0.0",
    name: "Molding encapsulation",
    category: "encapsulation.molding",
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
    id: "step_tpl_rdl_build_up",
    version: "V1.0.0",
    name: "RDL build up",
    category: "interconnect.rdl",
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
        processStepTemplateId: "step_tpl_molding_encapsulation",
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
        processStepTemplateId: "step_tpl_molding_encapsulation",
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

function createExampleDemoKernel() {
  const geometryEntities = [
    {
      id: "geom_example_panel",
      structure: centeredBoxStructure("example-panel", "glass", 10000, 10000, 500),
    },
    {
      id: "geom_example_hbm",
      structure: centeredBoxStructure("example-hbm", "Si-HBM", 1400, 1000, 50),
    },
    {
      id: "geom_example_soc",
      structure: centeredBoxStructure("example-soc", "Si-SoC", 2000, 1600, 70),
    },
  ];

  return new GeometryKernel({
    geometryRepository: new InMemoryRepository(geometryEntities),
    processStepRepository: new InMemoryRepository(exampleStepTemplates()),
    processFlowTemplateRepository: new InMemoryRepository([exampleFlowTemplate()]),
    processFlowInstanceRepository: new InMemoryRepository([exampleFlowInstance()]),
  });
}

function exampleStepTemplates() {
  return [
    {
      id: "pnp",
      category: "example",
      fieldDefinitions: [
        geometryField("target_geometry"),
        geometryField("die_geometry"),
        {
          id: "coordinates",
          valueType: "fieldGroupArray",
          repeatDefinition: {
            itemFieldDefinitions: [
              floatField("bottomLeft_x"),
              floatField("bottomLeft_y"),
            ],
          },
        },
      ],
    },
    {
      id: "molding1",
      category: "example",
      fieldDefinitions: [
        geometryField("main_geometry"),
        floatField("density"),
        materialField("material"),
      ],
    },
    {
      id: "bump",
      category: "example",
      fieldDefinitions: [
        geometryField("main_geometry"),
        floatField("density"),
        floatField("thk"),
        materialField("material"),
      ],
    },
    {
      id: "molding2",
      category: "example",
      fieldDefinitions: [
        geometryField("main_geometry"),
        floatField("density"),
        materialField("material"),
      ],
    },
  ];
}

function exampleFlowTemplate() {
  return {
    id: "flow_tpl_example_demo",
    stepRefs: [
      { stepRefId: "pnp_hbm", processStepTemplateId: "pnp" },
      { stepRefId: "pnp_soc", processStepTemplateId: "pnp" },
      { stepRefId: "molding1", processStepTemplateId: "molding1" },
      { stepRefId: "bump", processStepTemplateId: "bump" },
      { stepRefId: "molding2", processStepTemplateId: "molding2" },
    ],
    flowEdges: [
      {
        edgeId: "edge_panel_to_pnp_hbm_target",
        source: { sourceType: "geometryRef" },
        target: { stepRefId: "pnp_hbm", targetFieldId: "target_geometry" },
      },
      {
        edgeId: "edge_hbm_to_pnp_hbm_die",
        source: { sourceType: "geometryRef" },
        target: { stepRefId: "pnp_hbm", targetFieldId: "die_geometry" },
      },
      {
        edgeId: "edge_pnp_hbm_to_pnp_soc_target",
        source: { sourceType: "stepOutput", stepRefId: "pnp_hbm" },
        target: { stepRefId: "pnp_soc", targetFieldId: "target_geometry" },
      },
      {
        edgeId: "edge_soc_to_pnp_soc_die",
        source: { sourceType: "geometryRef" },
        target: { stepRefId: "pnp_soc", targetFieldId: "die_geometry" },
      },
      {
        edgeId: "edge_pnp_soc_to_molding1",
        source: { sourceType: "stepOutput", stepRefId: "pnp_soc" },
        target: { stepRefId: "molding1", targetFieldId: "main_geometry" },
      },
      {
        edgeId: "edge_molding1_to_bump",
        source: { sourceType: "stepOutput", stepRefId: "molding1" },
        target: { stepRefId: "bump", targetFieldId: "main_geometry" },
      },
      {
        edgeId: "edge_bump_to_molding2",
        source: { sourceType: "stepOutput", stepRefId: "bump" },
        target: { stepRefId: "molding2", targetFieldId: "main_geometry" },
      },
    ],
  };
}

function exampleFlowInstance() {
  return {
    id: "flow_inst_example_demo",
    processFlowTemplateId: "flow_tpl_example_demo",
    stepValueSets: [
      {
        stepRefId: "pnp_hbm",
        processStepTemplateId: "pnp",
        fieldValues: [
          { fieldId: "target_geometry", value: "geom_example_panel" },
          { fieldId: "die_geometry", value: "geom_example_hbm" },
          {
            fieldId: "coordinates",
            value: {
              items: [
                coordinateItem("coordinates_item_1", 1, -1750, -700),
                coordinateItem("coordinates_item_2", 2, 350, -700),
              ],
            },
          },
        ],
      },
      {
        stepRefId: "pnp_soc",
        processStepTemplateId: "pnp",
        fieldValues: [
          { fieldId: "target_geometry", value: null },
          { fieldId: "die_geometry", value: "geom_example_soc" },
          {
            fieldId: "coordinates",
            value: {
              items: [coordinateItem("coordinates_item_1", 1, -1000, 550)],
            },
          },
        ],
      },
      {
        stepRefId: "molding1",
        processStepTemplateId: "molding1",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "density", value: 1.85 },
          { fieldId: "material", value: "EMC-A" },
        ],
      },
      {
        stepRefId: "bump",
        processStepTemplateId: "bump",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "density", value: 0.55 },
          { fieldId: "thk", value: 40 },
          { fieldId: "material", value: "SAC305" },
        ],
      },
      {
        stepRefId: "molding2",
        processStepTemplateId: "molding2",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "density", value: 1.75 },
          { fieldId: "material", value: "EMC-B" },
        ],
      },
    ],
  };
}

function geometryField(id) {
  return { id, valueType: "geometry" };
}

function floatField(id) {
  return { id, valueType: "float" };
}

function materialField(id) {
  return { id, valueType: "materialRef" };
}

function coordinateItem(itemId, index, bottomLeftX, bottomLeftY) {
  return {
    itemId,
    index,
    fieldValues: [
      { fieldId: "bottomLeft_x", value: bottomLeftX },
      { fieldId: "bottomLeft_y", value: bottomLeftY },
    ],
  };
}

function centeredBoxStructure(key, material, width, height, thk) {
  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      key,
      bodies: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: [-width / 2, -height / 2, -thk / 2],
            top_right: [width / 2, height / 2, -thk / 2],
            thk,
          },
          material,
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
