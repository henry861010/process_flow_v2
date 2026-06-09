export const PROCESS_STEP_TEMPLATES_STORAGE_KEY = "processStepTemplates";
export const PROCESS_FLOW_TEMPLATES_STORAGE_KEY = "processFlowTemplates";
export const PROCESS_FLOW_INSTANCES_STORAGE_KEY = "processFlowInstances";
export const GEOMETRY_ENTITIES_STORAGE_KEY = "GeometryEntity";

type FieldScope = "inputState" | "outputState" | "processParameter";
type ValueType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "materialRef"
  | "geometryRef"
  | "geometry"
  | "coordinates"
  | "fieldGroupArray"
  | "string[]"
  | "integer[]"
  | "float[]"
  | "materialRef[]";
type ControlType =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "geometry"
  | "repeater"
  | "coordinateList"
  | null;
type SelectionMode = "single" | "multiple" | null;

type StaticOption = {
  value: string | number;
  name: string;
  description?: string;
};

type OptionSource = {
  type: "static";
  options: StaticOption[];
};

type ValidationRule = {
  regex?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
};

type RepeatDefinition = {
  itemNameTemplate: string;
  indexBase: number;
  minItems?: number;
  maxItems?: number;
  itemFieldDefinitions: FieldDefinition[];
};

type FieldDefinition = {
  id: string;
  name: string;
  description: string;
  scope: FieldScope;
  valueType: ValueType;
  controlType: ControlType;
  selectionMode: SelectionMode;
  unit: string | null;
  optionSource?: OptionSource;
  validation?: ValidationRule;
  repeatDefinition?: RepeatDefinition;
};

type ProcessStepTemplate = {
  id: string;
  version: string;
  name: string;
  category: string;
  program: string;
  description: string;
  owner: string;
  fieldDefinitions: FieldDefinition[];
};

type SavedFlowEdge = {
  edgeId: string;
  source:
    | { sourceType: "geometryRef" }
    | { sourceType: "stepOutput"; stepRefId: string };
  target: {
    stepRefId: string;
    targetFieldId: string;
  };
};

type ProcessFlowTemplate = {
  id: string;
  name: string;
  version: string;
  description: string;
  owner: string;
  stepRefs: Array<{
    stepRefId: string;
    processStepTemplateId: string;
  }>;
  flowEdges: SavedFlowEdge[];
};

type FieldValue = {
  fieldId: string;
  value: unknown;
};

type ProcessFlowInstance = {
  id: string;
  name: string;
  processFlowTemplateId: string;
  stepValueSets: Array<{
    stepRefId: string;
    processStepTemplateId: string;
    fieldValues: FieldValue[];
  }>;
};

type GeometryEntity = {
  id: string;
  category: string;
  name: string;
  version: string;
  owner: string;
  description: string;
  entityType: string;
  summary: string;
  structureFormat: "standard";
  structure?: unknown;
};

export const PROCESS_STEP_TEMPLATE_SEED: ProcessStepTemplate[] = [
  {
    id: "step_tpl_molding_1_0_0",
    version: "V1.0.0",
    name: "molding",
    category: "layer",
    program: "layer/molding",
    description:
      "Deposits a molding material layer over the current process footprint from cursorZ to cursorZ + thickness.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Complete geometry state consumed by molding. The state must already carry a process footprint.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "material",
        name: "material",
        description: "Molding material name or material entity id.",
        scope: "processParameter",
        valueType: "materialRef",
        controlType: "text",
        selectionMode: null,
        unit: null,
      },
      {
        id: "thickness",
        name: "thickness",
        description:
          "Molding thickness deposited from the current process cursor plane.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
          exclusiveMin: true,
        },
      },
    ],
  },
  {
    id: "step_tpl_rdl_1_0_0",
    version: "V1.0.0",
    name: "RDL layer",
    category: "layer",
    program: "layer/rdl",
    description:
      "Builds RDL dielectric layers with alternating circuit and downward via conductivity features over the current process footprint.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Complete geometry state consumed by RDL. The state must already carry a process footprint.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "layers",
        name: "layers",
        description:
          "RDL layer stack. Odd-numbered layers create circuit features before dielectric deposit; even-numbered layers create downward via features after dielectric deposit.",
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
              description: "Dielectric material name or material entity id.",
              scope: "processParameter",
              valueType: "materialRef",
              controlType: "text",
              selectionMode: null,
              unit: null,
            },
            {
              id: "Conductivity",
              name: "Conductivity",
              description: "Conductivity material name or material entity id.",
              scope: "processParameter",
              valueType: "materialRef",
              controlType: "text",
              selectionMode: null,
              unit: null,
            },
            {
              id: "thk",
              name: "thk",
              description:
                "Positive thickness for this dielectric layer and its conductivity feature envelope.",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: "um",
              validation: {
                min: 0,
                exclusiveMin: true,
              },
            },
            {
              id: "density",
              name: "density",
              description:
                "Conductivity feature density recorded as a 0 to 100 percentage value.",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: null,
              validation: {
                min: 0,
                max: 100,
              },
            },
          ],
        },
      },
    ],
  },
  {
    id: "step_tpl_grinding_1_0_0",
    version: "V1.0.0",
    name: "Grinding",
    category: "grinding",
    program: "grinding/grinding",
    description:
      "Removes geometry from the current full geometry top downward by thk while preserving the runtime process footprint.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Complete geometry state consumed by grinding. The operation uses the full geometry top, not cursorZ.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "thk",
        name: "thk",
        description:
          "Positive grinding thickness removed downward from the highest Z in the full geometry tree.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
          exclusiveMin: true,
        },
      },
    ],
  },
  {
    id: "step_tpl_debound_1_0_0",
    version: "V1.0.0",
    name: "Debound",
    category: "debound",
    program: "debound/debound",
    description:
      "Removes the highest direct root body or bodies from the main geometry, leaving child scopes and non-body features unchanged.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Complete geometry state consumed by Debound. The operation removes only direct root bodies at the highest direct root body top.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
    ],
  },
  {
    id: "step_tpl_flip_1_0_0",
    version: "V1.0.0",
    name: "Flip",
    category: "flip",
    program: "flip/flip",
    description:
      "Flips the main geometry around Z=0, normalizes the flipped structure to zMin 0, reverses directional via and bump features, and sets cursorZ to the highest direct root body top.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Complete geometry state consumed by Flip. The operation mirrors the full geometry tree but derives the output cursor only from direct root bodies.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
    ],
  },
  {
    id: "step_tpl_under_fill_1_0_0",
    version: "V1.0.0",
    name: "Under Fill",
    category: "UF",
    program: "uf/under_fill",
    description:
      "Fills underfill material into bump-side child cavities and root die-to-die gaps up to gap without moving cursorZ.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Main package geometry state containing root child die scopes to be underfilled.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "material",
        name: "material",
        description: "Underfill material name or material entity id.",
        scope: "processParameter",
        valueType: "materialRef",
        controlType: "text",
        selectionMode: null,
        unit: null,
      },
      {
        id: "thk",
        name: "thk",
        description:
          "Positive root die-to-die gap fill height deposited from cursorZ.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
          exclusiveMin: true,
        },
      },
      {
        id: "gap",
        name: "gap",
        description:
          "Maximum die-to-die XY gap distance that underfill is allowed to fill.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
        },
      },
    ],
  },
  {
    id: "step_tpl_ubump_formation_1_0_0",
    version: "V1.0.0",
    name: "Micro Bump",
    category: "bounding",
    program: "bump/uBump_formation",
    description:
      "Forms downward micro bump features below the lowest body using the current process footprint after applying koz.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Die geometry state consumed by micro bump formation. The state must already carry a process footprint.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "material",
        name: "material",
        description: "Micro bump material name or material entity id.",
        scope: "processParameter",
        valueType: "materialRef",
        controlType: "text",
        selectionMode: null,
        unit: null,
      },
      {
        id: "thk",
        name: "thk",
        description:
          "Positive micro bump thickness. The bump top is aligned to the lowest body bottom and extends downward.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
          exclusiveMin: true,
        },
      },
      {
        id: "density",
        name: "density",
        description:
          "Micro bump density recorded as a 0 to 100 percentage value.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: null,
        validation: {
          min: 0,
          max: 100,
        },
      },
      {
        id: "koz",
        name: "koz",
        description:
          "Keep out zone distance applied as an inward XY inset from the process footprint.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
        },
      },
    ],
  },
  {
    id: "step_tpl_bga_bump_formation_1_0_0",
    version: "V1.0.0",
    name: "BGA Bump",
    category: "bounding",
    program: "bump/bga_bump_formation",
    description:
      "Forms downward BGA bump features below the lowest body using the current process footprint after applying koz.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Die geometry state consumed by BGA bump formation. The state must already carry a process footprint.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "material",
        name: "material",
        description: "BGA bump material name or material entity id.",
        scope: "processParameter",
        valueType: "materialRef",
        controlType: "text",
        selectionMode: null,
        unit: null,
      },
      {
        id: "thk",
        name: "thk",
        description:
          "Positive BGA bump thickness. The bump top is aligned to the lowest body bottom and extends downward.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
          exclusiveMin: true,
        },
      },
      {
        id: "density",
        name: "density",
        description: "BGA bump density recorded as a 0 to 100 percentage value.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: null,
        validation: {
          min: 0,
          max: 100,
        },
      },
      {
        id: "koz",
        name: "koz",
        description:
          "Keep out zone distance applied as an inward XY inset from the process footprint.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
        },
      },
    ],
  },
  {
    id: "step_tpl_c4_bump_formation_1_0_0",
    version: "V1.0.0",
    name: "C4 Bump",
    category: "bounding",
    program: "bump/c4_bump_formation",
    description:
      "Forms downward C4 bump features below the lowest body using the current process footprint after applying koz.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Die geometry state consumed by C4 bump formation. The state must already carry a process footprint.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "material",
        name: "material",
        description: "C4 bump material name or material entity id.",
        scope: "processParameter",
        valueType: "materialRef",
        controlType: "text",
        selectionMode: null,
        unit: null,
      },
      {
        id: "thk",
        name: "thk",
        description:
          "Positive C4 bump thickness. The bump top is aligned to the lowest body bottom and extends downward.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
          exclusiveMin: true,
        },
      },
      {
        id: "density",
        name: "density",
        description: "C4 bump density recorded as a 0 to 100 percentage value.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: null,
        validation: {
          min: 0,
          max: 100,
        },
      },
      {
        id: "koz",
        name: "koz",
        description:
          "Keep out zone distance applied as an inward XY inset from the process footprint.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: "um",
        validation: {
          min: 0,
        },
      },
    ],
  },
  {
    id: "step_tpl_pnp_1_0_0",
    version: "V1.0.0",
    name: "PnP",
    category: "PnP",
    program: "pnp/pnp",
    description:
      "Places one or more copied die geometry states onto the main geometry at the main cursorZ plane.",
    owner: "integration.platform",
    fieldDefinitions: [
      {
        id: "main_geometry",
        name: "main_geometry",
        description:
          "Main package geometry state that receives placed die child scopes.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "die_geometry",
        name: "die_geometry",
        description:
          "Die geometry state copied once for each coordinate item before placement.",
        scope: "inputState",
        valueType: "geometryRef",
        controlType: null,
        selectionMode: null,
        unit: null,
      },
      {
        id: "coordinates",
        name: "coordinates",
        description:
          "Placement coordinates. Each item gives the target lower-left XY point for one die copy.",
        scope: "processParameter",
        valueType: "coordinates",
        controlType: "coordinateList",
        selectionMode: null,
        unit: "um",
      },
    ],
  },
];

export const PROCESS_FLOW_TEMPLATE_SEED: ProcessFlowTemplate[] = [
  {
    id: "flow_tpl_cowosl_demo_1_0_0",
    name: "CoWoS-L Demo",
    version: "V1.0.0",
    description:
      "Demo CoWoS-L style package flow with die placement, molding, RDL, and C4 bump formation.",
    owner: "demo.example",
    stepRefs: [
      {
        stepRefId: "pnp_hbm",
        processStepTemplateId: "step_tpl_pnp_1_0_0",
      },
      {
        stepRefId: "mold_cap",
        processStepTemplateId: "step_tpl_molding_1_0_0",
      },
      {
        stepRefId: "rdl_build",
        processStepTemplateId: "step_tpl_rdl_1_0_0",
      },
      {
        stepRefId: "c4_bump",
        processStepTemplateId: "step_tpl_c4_bump_formation_1_0_0",
      },
    ],
    flowEdges: [
      {
        edgeId: "edge_cowosl_panel_to_pnp_main",
        source: { sourceType: "geometryRef" },
        target: {
          stepRefId: "pnp_hbm",
          targetFieldId: "main_geometry",
        },
      },
      {
        edgeId: "edge_cowosl_hbm_to_pnp_die",
        source: { sourceType: "geometryRef" },
        target: {
          stepRefId: "pnp_hbm",
          targetFieldId: "die_geometry",
        },
      },
      {
        edgeId: "edge_cowosl_pnp_to_mold",
        source: {
          sourceType: "stepOutput",
          stepRefId: "pnp_hbm",
        },
        target: {
          stepRefId: "mold_cap",
          targetFieldId: "main_geometry",
        },
      },
      {
        edgeId: "edge_cowosl_mold_to_rdl",
        source: {
          sourceType: "stepOutput",
          stepRefId: "mold_cap",
        },
        target: {
          stepRefId: "rdl_build",
          targetFieldId: "main_geometry",
        },
      },
      {
        edgeId: "edge_cowosl_rdl_to_c4",
        source: {
          sourceType: "stepOutput",
          stepRefId: "rdl_build",
        },
        target: {
          stepRefId: "c4_bump",
          targetFieldId: "main_geometry",
        },
      },
    ],
  },
  {
    id: "flow_tpl_fanout_demo_1_0_0",
    name: "Fan-Out Demo",
    version: "V1.0.0",
    description:
      "Demo fan-out package flow with SoC placement, micro bump formation, flip, and BGA bump formation.",
    owner: "demo.example",
    stepRefs: [
      {
        stepRefId: "pnp_soc",
        processStepTemplateId: "step_tpl_pnp_1_0_0",
      },
      {
        stepRefId: "micro_bump",
        processStepTemplateId: "step_tpl_ubump_formation_1_0_0",
      },
      {
        stepRefId: "flip_package",
        processStepTemplateId: "step_tpl_flip_1_0_0",
      },
      {
        stepRefId: "bga_array",
        processStepTemplateId: "step_tpl_bga_bump_formation_1_0_0",
      },
    ],
    flowEdges: [
      {
        edgeId: "edge_fanout_panel_to_pnp_main",
        source: { sourceType: "geometryRef" },
        target: {
          stepRefId: "pnp_soc",
          targetFieldId: "main_geometry",
        },
      },
      {
        edgeId: "edge_fanout_soc_to_pnp_die",
        source: { sourceType: "geometryRef" },
        target: {
          stepRefId: "pnp_soc",
          targetFieldId: "die_geometry",
        },
      },
      {
        edgeId: "edge_fanout_pnp_to_micro_bump",
        source: {
          sourceType: "stepOutput",
          stepRefId: "pnp_soc",
        },
        target: {
          stepRefId: "micro_bump",
          targetFieldId: "main_geometry",
        },
      },
      {
        edgeId: "edge_fanout_micro_bump_to_flip",
        source: {
          sourceType: "stepOutput",
          stepRefId: "micro_bump",
        },
        target: {
          stepRefId: "flip_package",
          targetFieldId: "main_geometry",
        },
      },
      {
        edgeId: "edge_fanout_flip_to_bga",
        source: {
          sourceType: "stepOutput",
          stepRefId: "flip_package",
        },
        target: {
          stepRefId: "bga_array",
          targetFieldId: "main_geometry",
        },
      },
    ],
  },
];

export const PROCESS_FLOW_INSTANCE_SEED: ProcessFlowInstance[] = [
  {
    id: "flow_inst_cowosl_demo_hbm4_alpha",
    name: "HBM4 Alpha Build",
    processFlowTemplateId: "flow_tpl_cowosl_demo_1_0_0",
    stepValueSets: [
      {
        stepRefId: "pnp_hbm",
        processStepTemplateId: "step_tpl_pnp_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: "geom_example_panel" },
          { fieldId: "die_geometry", value: "geom_example_hbm" },
          {
            fieldId: "coordinates",
            value: [
              [-760, -520],
              [760, -520],
            ],
          },
        ],
      },
      {
        stepRefId: "mold_cap",
        processStepTemplateId: "step_tpl_molding_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "material", value: "EMC-G700" },
          { fieldId: "thickness", value: 180 },
        ],
      },
      {
        stepRefId: "rdl_build",
        processStepTemplateId: "step_tpl_rdl_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          {
            fieldId: "layers",
            value: {
              items: [
                {
                  itemId: "layers_item_1",
                  index: 1,
                  fieldValues: [
                    { fieldId: "Dielectric", value: "PI-2611" },
                    { fieldId: "Conductivity", value: "Cu" },
                    { fieldId: "thk", value: 8 },
                    { fieldId: "density", value: 0.62 },
                  ],
                },
                {
                  itemId: "layers_item_2",
                  index: 2,
                  fieldValues: [
                    { fieldId: "Dielectric", value: "PI-2611" },
                    { fieldId: "Conductivity", value: "Cu" },
                    { fieldId: "thk", value: 6 },
                    { fieldId: "density", value: 0.48 },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        stepRefId: "c4_bump",
        processStepTemplateId: "step_tpl_c4_bump_formation_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "material", value: "SAC305" },
          { fieldId: "thk", value: 65 },
          { fieldId: "density", value: 0.58 },
          { fieldId: "koz", value: 18 },
        ],
      },
    ],
  },
  {
    id: "flow_inst_cowosl_demo_hbm4_beta",
    name: "HBM4 Beta Reliability",
    processFlowTemplateId: "flow_tpl_cowosl_demo_1_0_0",
    stepValueSets: [
      {
        stepRefId: "pnp_hbm",
        processStepTemplateId: "step_tpl_pnp_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: "geom_example_panel" },
          { fieldId: "die_geometry", value: "geom_example_hbm" },
          {
            fieldId: "coordinates",
            value: [
              [-820, -560],
              [0, -560],
              [820, -560],
            ],
          },
        ],
      },
      {
        stepRefId: "mold_cap",
        processStepTemplateId: "step_tpl_molding_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "material", value: "EMC-R920" },
          { fieldId: "thickness", value: 210 },
        ],
      },
      {
        stepRefId: "rdl_build",
        processStepTemplateId: "step_tpl_rdl_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          {
            fieldId: "layers",
            value: {
              items: [
                {
                  itemId: "layers_item_1",
                  index: 1,
                  fieldValues: [
                    { fieldId: "Dielectric", value: "ABF-GX92" },
                    { fieldId: "Conductivity", value: "Cu" },
                    { fieldId: "thk", value: 10 },
                    { fieldId: "density", value: 0.56 },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        stepRefId: "c4_bump",
        processStepTemplateId: "step_tpl_c4_bump_formation_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "material", value: "SAC405" },
          { fieldId: "thk", value: 72 },
          { fieldId: "density", value: 0.53 },
          { fieldId: "koz", value: 20 },
        ],
      },
    ],
  },
  {
    id: "flow_inst_fanout_demo_soc_ev1",
    name: "SoC EV1",
    processFlowTemplateId: "flow_tpl_fanout_demo_1_0_0",
    stepValueSets: [
      {
        stepRefId: "pnp_soc",
        processStepTemplateId: "step_tpl_pnp_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: "geom_example_panel" },
          { fieldId: "die_geometry", value: "geom_example_soc" },
          {
            fieldId: "coordinates",
            value: [[-1000, -800]],
          },
        ],
      },
      {
        stepRefId: "micro_bump",
        processStepTemplateId: "step_tpl_ubump_formation_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "material", value: "Cu/Ni/SnAg" },
          { fieldId: "thk", value: 28 },
          { fieldId: "density", value: 0.42 },
          { fieldId: "koz", value: 12 },
        ],
      },
      {
        stepRefId: "flip_package",
        processStepTemplateId: "step_tpl_flip_1_0_0",
        fieldValues: [{ fieldId: "main_geometry", value: null }],
      },
      {
        stepRefId: "bga_array",
        processStepTemplateId: "step_tpl_bga_bump_formation_1_0_0",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "material", value: "SAC305" },
          { fieldId: "thk", value: 240 },
          { fieldId: "density", value: 0.36 },
          { fieldId: "koz", value: 35 },
        ],
      },
    ],
  },
];

export const GEOMETRY_ENTITY_SEED: GeometryEntity[] = [
  {
    id: "geom_example_wafer",
    category: "initial.wafer",
    name: "Wafer",
    version: "v1.0.0",
    owner: "demo.example",
    description: "Centered circular wafer geometry for demo flow roots.",
    entityType: "wafer",
    summary: "300000 x 500 um wafer, center at 0,0,0.",
    structureFormat: "standard",
    structure: centeredCylinderStructure("example-wafer", "Si", 300000, 500),
  },
  {
    id: "geom_example_panel",
    category: "initial.panel",
    name: "Panel",
    version: "v1.0.0",
    owner: "demo.example",
    description: "Centered square panel geometry for demo flow roots.",
    entityType: "panel",
    summary: "310000 x 310000 x 500 um panel, center at 0,0,0.",
    structureFormat: "standard",
    structure: centeredBoxStructure("example-panel", "glass", 310000, 310000, 500),
  },
  {
    id: "geom_example_hbm",
    category: "initial.die.hbm",
    name: "HBM",
    version: "v1.0.0",
    owner: "demo.example",
    description: "Simple block placeholder for HBM die.",
    entityType: "die",
    summary: "1400 x 1000 x 50 um HBM block, center at 0,0,0.",
    structureFormat: "standard",
    structure: centeredBoxStructure("example-hbm", "Si-HBM", 1400, 1000, 50),
  },
  {
    id: "geom_example_soc",
    category: "initial.die.soc",
    name: "SoC",
    version: "v1.0.0",
    owner: "demo.example",
    description: "Simple block placeholder for SoC die.",
    entityType: "die",
    summary: "2000 x 1600 x 70 um SoC block, center at 0,0,0.",
    structureFormat: "standard",
    structure: centeredBoxStructure("example-soc", "Si-SoC", 2000, 1600, 70),
  },
];

export function initializeHomeLocalStorage(storage: Storage = window.localStorage) {
  ensureStorageArray(
    storage,
    PROCESS_STEP_TEMPLATES_STORAGE_KEY,
    PROCESS_STEP_TEMPLATE_SEED,
  );
  ensureStorageArray(
    storage,
    PROCESS_FLOW_TEMPLATES_STORAGE_KEY,
    PROCESS_FLOW_TEMPLATE_SEED,
  );
  ensureStorageArray(
    storage,
    PROCESS_FLOW_INSTANCES_STORAGE_KEY,
    PROCESS_FLOW_INSTANCE_SEED,
  );
  ensureStorageArray(storage, GEOMETRY_ENTITIES_STORAGE_KEY, GEOMETRY_ENTITY_SEED);
}

export function resetHomeLocalStorage(storage: Storage = window.localStorage) {
  storage.clear();
  writeStorageArray(
    storage,
    PROCESS_STEP_TEMPLATES_STORAGE_KEY,
    PROCESS_STEP_TEMPLATE_SEED,
  );
  writeStorageArray(
    storage,
    PROCESS_FLOW_TEMPLATES_STORAGE_KEY,
    PROCESS_FLOW_TEMPLATE_SEED,
  );
  writeStorageArray(
    storage,
    PROCESS_FLOW_INSTANCES_STORAGE_KEY,
    PROCESS_FLOW_INSTANCE_SEED,
  );
  writeStorageArray(storage, GEOMETRY_ENTITIES_STORAGE_KEY, GEOMETRY_ENTITY_SEED);
}

function centeredBoxStructure(
  key: string,
  material: string,
  width: number,
  height: number,
  thk: number,
) {
  return geometryStructure(key, [
    {
      geometry: {
        type: "BoxGeometry",
        bottom_left: [-width / 2, -height / 2, -thk / 2],
        top_right: [width / 2, height / 2, -thk / 2],
        thk,
      },
      material,
    },
  ]);
}

function centeredCylinderStructure(
  key: string,
  material: string,
  radius: number,
  thk: number,
) {
  return geometryStructure(key, [
    {
      geometry: {
        type: "CylinderGeometry",
        center: [0, 0, -thk / 2],
        bottom_radius: radius,
        thk,
      },
      material,
    },
  ]);
}

function geometryStructure(
  key: string,
  bodies: Array<{ geometry: unknown; material: string }>,
) {
  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      key,
      bodies,
      vias: [],
      circuits: [],
      bumps: [],
      children: [],
    },
  };
}

function ensureStorageArray<T>(storage: Storage, key: string, seed: T[]) {
  if (storage.getItem(key) !== null) {
    return;
  }

  writeStorageArray(storage, key, seed);
}

function writeStorageArray<T>(storage: Storage, key: string, seed: T[]) {
  storage.setItem(key, JSON.stringify(clone(seed)));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
