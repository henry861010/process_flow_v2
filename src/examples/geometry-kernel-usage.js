import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { GeometryKernel, InMemoryRepository } from "../kernel/index.js";

const DEFAULT_OUTPUT_BASE = "/Users/henry/Desktop/code/tmp/model";

export async function runGeometryKernelExample({
  outputBase = DEFAULT_OUTPUT_BASE,
  writeOutputs = true,
} = {}) {
  const kernel = createExampleKernel();
  const result = await kernel.execute("flow_inst_kernel_example");

  const geometry = result.geometry();
  const glb = await result.glb();

  if (writeOutputs) {
    await writeExampleOutputs(outputBase, geometry, glb);
  }

  return {
    geometry,
    glb,
    terminalStepRefIds: result.terminalStepRefIds(),
    outputPaths: writeOutputs
      ? {
          geometry: `${outputBase}.geometry.json`,
          glb: `${outputBase}.glb`,
        }
      : {},
  };
}

export function createExampleKernel() {
  return new GeometryKernel({
    geometryRepository: new InMemoryRepository([exampleGeometryEntity()]),
    processFlowInstanceRepository: new InMemoryRepository([exampleFlowInstance()]),
    processFlowTemplateRepository: new InMemoryRepository([exampleFlowTemplate()]),
    processStepRepository: new InMemoryRepository([
      moldingStepTemplate(),
      rdlStepTemplate(),
    ]),
  });
}

function exampleGeometryEntity() {
  return {
    id: "geom_kernel_input_panel",
    category: "carrier.panel",
    name: "Kernel input panel",
    version: "v1",
    owner: "example",
    description: "Starting panel geometry for the GeometryKernel example.",
    structureFormat: "standard",
    structure: {
      schemaVersion: "1.0.0",
      unitSystem: "um",
      root: {
        key: "kernel-example-panel",
        bodies: [
          {
            geometry: {
              type: "BoxGeometry",
              bottom_left: [-2500, -2500, 0],
              top_right: [2500, 2500, 0],
              thk: 300,
            },
            material: "BT substrate",
          },
        ],
        vias: [],
        circuits: [],
        bumps: [],
        children: [],
      },
    },
  };
}

function exampleFlowTemplate() {
  return {
    id: "flow_tpl_kernel_example",
    stepRefs: [
      {
        stepRefId: "molding",
        processStepTemplateId: "step_tpl_molding_encapsulation",
      },
      {
        stepRefId: "rdl",
        processStepTemplateId: "step_tpl_rdl_build_up",
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
      {
        edgeId: "edge_molding_to_rdl",
        source: {
          sourceType: "stepOutput",
          stepRefId: "molding",
        },
        target: {
          stepRefId: "rdl",
          targetFieldId: "main_geometry",
        },
      },
    ],
  };
}

function exampleFlowInstance() {
  return {
    id: "flow_inst_kernel_example",
    processFlowTemplateId: "flow_tpl_kernel_example",
    stepValueSets: [
      {
        stepRefId: "molding",
        processStepTemplateId: "step_tpl_molding_encapsulation",
        fieldValues: [
          { fieldId: "main_geometry", value: "geom_kernel_input_panel" },
          { fieldId: "mold_compound", value: "EMC-A" },
          { fieldId: "mold_thickness", value: 150 },
        ],
      },
      {
        stepRefId: "rdl",
        processStepTemplateId: "step_tpl_rdl_build_up",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
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
                    { fieldId: "thk", value: "8" },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function moldingStepTemplate() {
  return {
    id: "step_tpl_molding_encapsulation",
    version: "V1.0.0",
    name: "Molding encapsulation",
    category: "encapsulation.molding",
    description: "Adds a molding layer above the current geometry state.",
    owner: "example",
    fieldDefinitions: [
      geometryInputField(),
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
        unit: "um",
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
    description: "Adds repeatable RDL dielectric and metal regions.",
    owner: "example",
    fieldDefinitions: [
      geometryInputField(),
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
              unit: "um",
            },
          ],
        },
      },
    ],
  };
}

function geometryInputField() {
  return {
    id: "main_geometry",
    name: "main_geometry",
    scope: "inputState",
    valueType: "geometry",
    controlType: "geometry",
    selectionMode: null,
    unit: null,
  };
}

async function writeExampleOutputs(outputBase, geometry, glb) {
  await mkdir(dirname(outputBase), { recursive: true });
  await writeFile(
    `${outputBase}.geometry.json`,
    `${JSON.stringify(geometry, null, 2)}\n`,
    "utf8",
  );
  await writeFile(`${outputBase}.glb`, glb);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputBase = process.argv[2] ?? DEFAULT_OUTPUT_BASE;
  runGeometryKernelExample({ outputBase }).then((result) => {
    console.log(JSON.stringify(result.outputPaths, null, 2));
    console.log(
      JSON.stringify(
        {
          terminalStepRefIds: result.terminalStepRefIds,
          bodies: result.geometry.root.bodies.length,
          vias: result.geometry.root.vias.length,
          glbBytes: result.glb.byteLength,
        },
        null,
        2,
      ),
    );
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
