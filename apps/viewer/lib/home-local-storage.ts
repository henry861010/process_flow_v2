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
  | "geometry"
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
  | "repeater";
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
  unit: null;
  optionSource?: OptionSource;
  validation?: ValidationRule;
  repeatDefinition?: RepeatDefinition;
};

type ProcessStepTemplate = {
  id: string;
  version: string;
  name: string;
  category: string;
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

const MAIN_GEOMETRY_FIELD: FieldDefinition = {
  id: "main_geometry",
  name: "main_geometry",
  description: "Complete geometry state consumed by this process step.",
  scope: "inputState",
  valueType: "geometry",
  controlType: "geometry",
  selectionMode: null,
  unit: null,
};

const DIE_GEOMETRY_FIELD: FieldDefinition = {
  id: "die_geometry",
  name: "die_geometry",
  description: "Die geometry copied into the target package by pnp.",
  scope: "inputState",
  valueType: "geometry",
  controlType: "geometry",
  selectionMode: null,
  unit: null,
};

const DENSITY_FIELD: FieldDefinition = {
  id: "density",
  name: "Density",
  description: "Simple demo density parameter for this station.",
  scope: "processParameter",
  valueType: "float",
  controlType: "number",
  selectionMode: null,
  unit: null,
  validation: { min: 0, exclusiveMin: true },
};

const MATERIAL_FIELD: FieldDefinition = {
  id: "material",
  name: "Material",
  description: "Material used by this demo station.",
  scope: "processParameter",
  valueType: "materialRef",
  controlType: "select",
  selectionMode: "single",
  unit: null,
  optionSource: {
    type: "static",
    options: [
      { value: "EMC-A", name: "EMC-A" },
      { value: "EMC-B", name: "EMC-B" },
      { value: "SAC305", name: "SAC305" },
      { value: "Cu", name: "Cu" },
    ],
  },
};

export const PROCESS_STEP_TEMPLATE_SEED: ProcessStepTemplate[] = [
  {
    id: "molding1",
    version: "V1.0.0",
    name: "Molding 1",
    category: "example",
    description:
      "Demo molding station that adds a visible full-footprint layer above the current geometry.",
    owner: "demo.example",
    fieldDefinitions: [MAIN_GEOMETRY_FIELD, DENSITY_FIELD, MATERIAL_FIELD],
  },
  {
    id: "molding2",
    version: "V1.0.0",
    name: "Molding 2",
    category: "example",
    description:
      "Second demo molding/modeling station with the requested modeling2 process id.",
    owner: "demo.example",
    fieldDefinitions: [MAIN_GEOMETRY_FIELD, DENSITY_FIELD, MATERIAL_FIELD],
  },
  {
    id: "bump",
    version: "V1.0.0",
    name: "Bump",
    category: "example",
    description:
      "Demo bump station that adds a bump feature using geometry, density, thickness, and material.",
    owner: "demo.example",
    fieldDefinitions: [
      MAIN_GEOMETRY_FIELD,
      DENSITY_FIELD,
      {
        id: "thk",
        name: "Thickness",
        description: "Bump thickness.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: null,
        validation: { min: 0, exclusiveMin: true },
      },
      MATERIAL_FIELD,
    ],
  },
  {
    id: "pnp",
    version: "V1.0.0",
    name: "PnP",
    category: "example",
    description:
      "Demo pick-and-place station that copies one die geometry into a target geometry at coordinate rows.",
    owner: "demo.example",
    fieldDefinitions: [
      MAIN_GEOMETRY_FIELD,
      DIE_GEOMETRY_FIELD,
      {
        id: "coordinates",
        name: "Coordinates",
        description: "Bottom-left xy placement coordinates for copied die.",
        scope: "processParameter",
        valueType: "fieldGroupArray",
        controlType: "repeater",
        selectionMode: null,
        unit: null,
        repeatDefinition: {
          itemNameTemplate: "Coordinate {{index}}",
          indexBase: 1,
          minItems: 1,
          maxItems: 16,
          itemFieldDefinitions: [
            {
              id: "bottomLeft_x",
              name: "bottomLeft_x",
              description: "Placed die lower-left x coordinate.",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: null,
            },
            {
              id: "bottomLeft_y",
              name: "bottomLeft_y",
              description: "Placed die lower-left y coordinate.",
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
  },
];

export const PROCESS_FLOW_TEMPLATE_SEED: ProcessFlowTemplate[] = [
  {
    id: "flow_tpl_example_pnp_molding_demo",
    name: "Example PnP Molding Demo",
    version: "V1.0.0",
    description:
      "Linear demo flow for previewing pnp, molding1, bump, and modeling2 station outputs.",
    owner: "demo.example",
    stepRefs: [
      { stepRefId: "pnp_hbm", processStepTemplateId: "pnp" },
      { stepRefId: "pnp_soc", processStepTemplateId: "pnp" },
      { stepRefId: "molding1", processStepTemplateId: "molding1" },
      { stepRefId: "bump", processStepTemplateId: "bump" },
      { stepRefId: "modeling2", processStepTemplateId: "modeling2" },
    ],
    flowEdges: [
      {
        edgeId: "edge_panel_to_pnp_hbm_target",
        source: { sourceType: "geometryRef" },
        target: { stepRefId: "pnp_hbm", targetFieldId: "main_geometry" },
      },
      {
        edgeId: "edge_hbm_to_pnp_hbm_die",
        source: { sourceType: "geometryRef" },
        target: { stepRefId: "pnp_hbm", targetFieldId: "die_geometry" },
      },
      {
        edgeId: "edge_pnp_hbm_to_pnp_soc_target",
        source: { sourceType: "stepOutput", stepRefId: "pnp_hbm" },
        target: { stepRefId: "pnp_soc", targetFieldId: "main_geometry" },
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
        edgeId: "edge_bump_to_modeling2",
        source: { sourceType: "stepOutput", stepRefId: "bump" },
        target: { stepRefId: "modeling2", targetFieldId: "main_geometry" },
      },
    ],
  },
];

export const PROCESS_FLOW_INSTANCE_SEED: ProcessFlowInstance[] = [
  {
    id: "flow_inst_example_pnp_molding_demo",
    name: "Example PnP molding demo instance",
    processFlowTemplateId: "flow_tpl_example_pnp_molding_demo",
    stepValueSets: [
      {
        stepRefId: "pnp_hbm",
        processStepTemplateId: "pnp",
        fieldValues: [
          { fieldId: "main_geometry", value: "geom_example_panel" },
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
          { fieldId: "main_geometry", value: null },
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
        stepRefId: "modeling2",
        processStepTemplateId: "modeling2",
        fieldValues: [
          { fieldId: "main_geometry", value: null },
          { fieldId: "density", value: 1.75 },
          { fieldId: "material", value: "EMC-B" },
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
    summary: "Cylinder wafer, center at 0,0,0.",
    structureFormat: "standard",
    structure: centeredCylinderDocument("example-wafer", "Si", 500, 775),
  },
  {
    id: "geom_example_panel",
    category: "initial.panel",
    name: "Panel",
    version: "v1.0.0",
    owner: "demo.example",
    description: "Centered square panel geometry for demo flow roots.",
    entityType: "panel",
    summary: "10000 x 10000 x 500 um panel, center at 0,0,0.",
    structureFormat: "standard",
    structure: centeredBoxDocument("example-panel", "glass", 500, 500, 500),
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
    structure: centeredBoxDocument("example-hbm", "Si-HBM", 1400, 1000, 50),
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
    structure: centeredBoxDocument("example-soc", "Si-SoC", 2000, 1600, 70),
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

function coordinateItem(
  itemId: string,
  index: number,
  bottomLeftX: number,
  bottomLeftY: number,
) {
  return {
    itemId,
    index,
    fieldValues: [
      { fieldId: "bottomLeft_x", value: bottomLeftX },
      { fieldId: "bottomLeft_y", value: bottomLeftY },
    ],
  };
}

function centeredBoxDocument(
  key: string,
  material: string,
  width: number,
  height: number,
  thk: number,
) {
  return geometryDocument(key, [
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

function centeredCylinderDocument(
  key: string,
  material: string,
  radius: number,
  thk: number,
) {
  return geometryDocument(key, [
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

function geometryDocument(
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
