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

export const PROCESS_STEP_TEMPLATE_SEED: ProcessStepTemplate[] = [
  {
    id: "step_tpl_bonding_micro_bump",
    version: "V1.0.0",
    name: "Micro bump bonding",
    category: "bonding.micro_bump",
    description:
      "Define micro bump bonding process parameters and resulting bonded package state.",
    owner: "integration.platform",
    fieldDefinitions: [
      MAIN_GEOMETRY_FIELD,
      {
        id: "incoming_pad_finish",
        name: "Incoming pad finish",
        description: "Pad finish before micro bump bonding starts.",
        scope: "inputState",
        valueType: "string",
        controlType: "select",
        selectionMode: "single",
        unit: null,
        optionSource: {
          type: "static",
          options: [
            { value: "cu", name: "Cu" },
            { value: "ni_au", name: "Ni/Au" },
          ],
        },
      },
      {
        id: "bonding_profile",
        name: "Bonding profile",
        description: "Named bonding recipe or process profile family.",
        scope: "processParameter",
        valueType: "string",
        controlType: "select",
        selectionMode: "single",
        unit: null,
        optionSource: {
          type: "static",
          options: [
            {
              value: "baseline_thermal_compression",
              name: "Baseline thermal compression",
            },
            { value: "low_temperature", name: "Low temperature" },
          ],
        },
      },
      {
        id: "bump_pitch",
        name: "Bump pitch",
        description: "Nominal micro bump pitch used by this bonding process.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: null,
        validation: { min: 0 },
      },
    ],
  },
  {
    id: "step_tpl_molding_encapsulation",
    version: "V1.0.0",
    name: "Molding encapsulation",
    category: "encapsulation.molding",
    description: "Define mold compound, mold thickness, and cure condition.",
    owner: "assembly.process",
    fieldDefinitions: [
      MAIN_GEOMETRY_FIELD,
      {
        id: "mold_compound",
        name: "Mold compound",
        description: "Mold compound material used for encapsulation.",
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
          ],
        },
      },
      {
        id: "mold_thickness",
        name: "Mold thickness",
        description: "Target encapsulation thickness after molding.",
        scope: "processParameter",
        valueType: "float",
        controlType: "number",
        selectionMode: null,
        unit: null,
        validation: { min: 0 },
      },
      {
        id: "cure_required",
        name: "Cure required",
        description: "Whether the process requires a dedicated post mold cure step.",
        scope: "processParameter",
        valueType: "boolean",
        controlType: "checkbox",
        selectionMode: null,
        unit: null,
      },
    ],
  },
  {
    id: "step_tpl_rdl_build_up",
    version: "V1.0.0",
    name: "RDL build up",
    category: "interconnect.rdl",
    description: "Define repeatable PM and RDL layer parameters.",
    owner: "interconnect.integration",
    fieldDefinitions: [
      MAIN_GEOMETRY_FIELD,
      {
        id: "rdl_layers",
        name: "RDL layers",
        description: "Repeatable PM and RDL layer definitions.",
        scope: "processParameter",
        valueType: "fieldGroupArray",
        controlType: "repeater",
        selectionMode: null,
        unit: null,
        repeatDefinition: {
          itemNameTemplate: "RDL layer {{index}}",
          indexBase: 1,
          minItems: 1,
          maxItems: 12,
          itemFieldDefinitions: [
            {
              id: "pm_material",
              name: "PM material",
              description: "Photo-material used before this RDL layer.",
              scope: "processParameter",
              valueType: "materialRef",
              controlType: "select",
              selectionMode: "single",
              unit: null,
              optionSource: {
                type: "static",
                options: [
                  { value: "PM-001", name: "Baseline photo-material" },
                  { value: "PM-002", name: "Low-stress photo-material" },
                ],
              },
            },
            {
              id: "pm_thickness",
              name: "PM thickness",
              description: "Photo-material thickness for this layer.",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: null,
              validation: { min: 0 },
            },
            {
              id: "rdl_thickness",
              name: "RDL thickness",
              description: "Copper RDL thickness for this layer.",
              scope: "processParameter",
              valueType: "float",
              controlType: "number",
              selectionMode: null,
              unit: null,
              validation: { min: 0 },
            },
          ],
        },
      },
    ],
  },
];

export const GEOMETRY_ENTITY_SEED: GeometryEntity[] = [
  {
    id: "geom_wafer_aaatv_rev_a",
    category: "carrier.wafer.glass",
    name: "SKH HBM4 incoming wafer",
    version: "v1.0.0",
    owner: "integration-team",
    description: "Incoming glass wafer geometry for aaaTV process flow.",
    entityType: "wafer",
    summary: "300 mm glass carrier, standard stack, um coordinates.",
    structureFormat: "standard",
  },
  {
    id: "geom_die_hbm4_logic_rev_b",
    category: "die.silicon.logic",
    name: "HBM4 logic die",
    version: "v2.1.0",
    owner: "die-integration",
    description: "Logic die outline and bump keepout model.",
    entityType: "die",
    summary: "Reticle-sized silicon die with bump density features.",
    structureFormat: "standard",
  },
  {
    id: "geom_die_hbm4_memory_rev_c",
    category: "die.silicon.memory",
    name: "HBM4 memory die",
    version: "v1.4.2",
    owner: "memory-platform",
    description: "Memory die geometry with TSV via density.",
    entityType: "die",
    summary: "Thin silicon memory die with via/circuit density.",
    structureFormat: "standard",
  },
  {
    id: "geom_substrate_abf_55x55_rev_a",
    category: "substrate.organic.abf",
    name: "55x55 ABF substrate",
    version: "v1.0.0",
    owner: "substrate-team",
    description: "Organic substrate for package assembly flow.",
    entityType: "substrate",
    summary: "ABF package substrate with coarse routing density.",
    structureFormat: "standard",
  },
  {
    id: "geom_interposer_silicon_bridge_rev_a",
    category: "interposer.silicon.bridge",
    name: "Silicon bridge interposer",
    version: "v0.9.0",
    owner: "advanced-packaging",
    description: "Bridge interposer geometry for fan-in assembly.",
    entityType: "interposer",
    summary: "Bridge with circuit density regions and copper vias.",
    structureFormat: "standard",
  },
  {
    id: "geom_panel_temp_carrier_rev_a",
    category: "carrier.panel.temporary",
    name: "Temporary process panel",
    version: "v1.0.0",
    owner: "panel-process",
    description: "Panel-level temporary carrier geometry.",
    entityType: "panel",
    summary: "Large-format carrier used during panel build-up.",
    structureFormat: "standard",
  },
];

export function initializeHomeLocalStorage(storage: Storage = window.localStorage) {
  ensureStorageArray(
    storage,
    PROCESS_STEP_TEMPLATES_STORAGE_KEY,
    PROCESS_STEP_TEMPLATE_SEED,
  );
  ensureStorageArray(storage, PROCESS_FLOW_TEMPLATES_STORAGE_KEY, []);
  ensureStorageArray(storage, PROCESS_FLOW_INSTANCES_STORAGE_KEY, []);
  ensureStorageArray(storage, GEOMETRY_ENTITIES_STORAGE_KEY, GEOMETRY_ENTITY_SEED);
}

export function resetHomeLocalStorage(storage: Storage = window.localStorage) {
  storage.clear();
  writeStorageArray(
    storage,
    PROCESS_STEP_TEMPLATES_STORAGE_KEY,
    PROCESS_STEP_TEMPLATE_SEED,
  );
  writeStorageArray(storage, PROCESS_FLOW_TEMPLATES_STORAGE_KEY, []);
  writeStorageArray(storage, PROCESS_FLOW_INSTANCES_STORAGE_KEY, []);
  writeStorageArray(storage, GEOMETRY_ENTITIES_STORAGE_KEY, GEOMETRY_ENTITY_SEED);
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
