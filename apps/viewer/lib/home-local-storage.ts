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
              description:
                "Target X coordinate for the lower-left corner of the die copy.",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: "um",
            },
            {
              id: "bottemLeftY",
              name: "bottemLeftY",
              description:
                "Target Y coordinate for the lower-left corner of the die copy.",
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
  },
];

export const PROCESS_FLOW_TEMPLATE_SEED: ProcessFlowTemplate[] = [];

export const PROCESS_FLOW_INSTANCE_SEED: ProcessFlowInstance[] = [];

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
    structure: centeredCylinderStructure("example-wafer", "Si", 500, 775),
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
    structure: centeredBoxStructure("example-panel", "glass", 500, 500, 500),
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
