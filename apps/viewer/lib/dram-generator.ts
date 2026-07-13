export const MAX_DRAM_CORE_DIE_COUNT = 64;
export const MAX_DRAM_BUILDUP_LAYER_COUNT = 63;

export type DramBuildupLayer = {
  id: string;
  thickness: number;
  density: number;
};

export type DramGeneratorParameters = {
  packageX: number;
  packageY: number;
  topMoldingThickness: number;
  moldingMaterial: string;
  coreDieX: number;
  coreDieY: number;
  coreDieThickness: number;
  coreDieCount: number;
  dieGapThickness: number;
  dieMaterial: string;
  topSolderMaskThickness: number;
  bottomSolderMaskThickness: number;
  solderMaskMaterial: string;
  sbtCoreLayerThickness: number;
  sbtCoreMaterial: string;
  buildupDielectricMaterial: string;
  buildupConductiveMaterial: string;
  topBuildupLayers: DramBuildupLayer[];
  bottomBuildupLayers: DramBuildupLayer[];
};

export type DramScalarParameterKey = Exclude<
  keyof DramGeneratorParameters,
  "topBuildupLayers" | "bottomBuildupLayers"
>;

export type DramStackSide = "top" | "bottom";
export type DramLayerField = "thickness" | "density";
export type DramParameterErrors = Record<string, string>;

export type DramDerivedDimensions = {
  topBuildupThickness: number;
  bottomBuildupThickness: number;
  sbtThickness: number;
  moldedBodyThickness: number;
  totalThickness: number;
  sideMoldingX: number;
  sideMoldingY: number;
};

type Point3 = [number, number, number];

export type DramBoxGeometry = {
  type: "BoxGeometry";
  bottom_left: Point3;
  top_right: Point3;
  thk: number;
};

export type DramBody = {
  id: string;
  geometry: DramBoxGeometry;
  material: string;
};

export type DramCircuit = {
  id: string;
  geometry: DramBoxGeometry;
  material: string;
  density: number;
  koz: number;
};

export type DramContainer = {
  id: string;
  key: string;
  bodies: DramBody[];
  vias: [];
  circuits: DramCircuit[];
  bumps: [];
  children: DramContainer[];
};

export type DramGeometryStructure = {
  schemaVersion: "1.0.0";
  unitSystem: "um";
  root: DramContainer;
};

export const DEFAULT_DRAM_PARAMETERS: DramGeneratorParameters = {
  packageX: 12000,
  packageY: 8000,
  topMoldingThickness: 100,
  moldingMaterial: "EMC",
  coreDieX: 8000,
  coreDieY: 6000,
  coreDieThickness: 50,
  coreDieCount: 3,
  dieGapThickness: 20,
  dieMaterial: "Si-DRAM",
  topSolderMaskThickness: 20,
  bottomSolderMaskThickness: 20,
  solderMaskMaterial: "Solder-Mask",
  sbtCoreLayerThickness: 100,
  sbtCoreMaterial: "BT-Core",
  buildupDielectricMaterial: "ABF",
  buildupConductiveMaterial: "Cu",
  topBuildupLayers: createDefaultBuildupLayers("top", 5),
  bottomBuildupLayers: createDefaultBuildupLayers("bottom", 5),
};

export function createDefaultBuildupLayers(
  side: DramStackSide,
  count: number,
): DramBuildupLayer[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${side}-layer-${String(index + 1).padStart(2, "0")}`,
    thickness: 20,
    density: 50,
  }));
}

export function resizeBuildupLayers(
  layers: DramBuildupLayer[],
  side: DramStackSide,
  count: number,
): DramBuildupLayer[] {
  if (!Number.isInteger(count) || count < 0 || count > MAX_DRAM_BUILDUP_LAYER_COUNT) {
    return layers;
  }
  return Array.from({ length: count }, (_, index) =>
    layers[index]
      ? { ...layers[index] }
      : {
          id: `${side}-layer-${String(index + 1).padStart(2, "0")}`,
          thickness: layers.at(-1)?.thickness ?? 20,
          density: layers.at(-1)?.density ?? 50,
        },
  );
}

export function dramLayerErrorKey(
  side: DramStackSide,
  index: number,
  field: DramLayerField,
) {
  return `${side}BuildupLayers.${index}.${field}`;
}

export function deriveDramDimensions(
  parameters: DramGeneratorParameters,
): DramDerivedDimensions {
  const coreCount = Number.isFinite(parameters.coreDieCount)
    ? parameters.coreDieCount
    : 0;
  const topBuildupThickness = sumLayerThickness(parameters.topBuildupLayers);
  const bottomBuildupThickness = sumLayerThickness(parameters.bottomBuildupLayers);
  const sbtThickness =
    finiteOrZero(parameters.bottomSolderMaskThickness) +
    bottomBuildupThickness +
    finiteOrZero(parameters.sbtCoreLayerThickness) +
    topBuildupThickness +
    finiteOrZero(parameters.topSolderMaskThickness);
  const moldedBodyThickness =
    Math.max(0, coreCount) * finiteOrZero(parameters.coreDieThickness) +
    Math.max(0, coreCount) * finiteOrZero(parameters.dieGapThickness) +
    finiteOrZero(parameters.topMoldingThickness);

  return {
    topBuildupThickness,
    bottomBuildupThickness,
    sbtThickness,
    moldedBodyThickness,
    totalThickness: sbtThickness + moldedBodyThickness,
    sideMoldingX: (parameters.packageX - parameters.coreDieX) / 2,
    sideMoldingY: (parameters.packageY - parameters.coreDieY) / 2,
  };
}

export function validateDramParameters(
  parameters: DramGeneratorParameters,
): DramParameterErrors {
  const errors: DramParameterErrors = {};

  requirePositive(parameters.packageX, "Package X", "packageX", errors);
  requirePositive(parameters.packageY, "Package Y", "packageY", errors);
  requireNonNegative(
    parameters.topMoldingThickness,
    "Top molding thickness",
    "topMoldingThickness",
    errors,
  );
  requireText(parameters.moldingMaterial, "Molding material", "moldingMaterial", errors);
  requirePositive(parameters.coreDieX, "Core die X", "coreDieX", errors);
  requirePositive(parameters.coreDieY, "Core die Y", "coreDieY", errors);
  requirePositive(
    parameters.coreDieThickness,
    "Core die thickness",
    "coreDieThickness",
    errors,
  );
  requireNonNegative(
    parameters.dieGapThickness,
    "Die gap thickness",
    "dieGapThickness",
    errors,
  );
  requireText(parameters.dieMaterial, "Die material", "dieMaterial", errors);
  requirePositive(
    parameters.topSolderMaskThickness,
    "Top solder mask thickness",
    "topSolderMaskThickness",
    errors,
  );
  requirePositive(
    parameters.bottomSolderMaskThickness,
    "Bottom solder mask thickness",
    "bottomSolderMaskThickness",
    errors,
  );
  requireText(
    parameters.solderMaskMaterial,
    "Solder mask material",
    "solderMaskMaterial",
    errors,
  );
  requirePositive(
    parameters.sbtCoreLayerThickness,
    "SBT core layer thickness",
    "sbtCoreLayerThickness",
    errors,
  );
  requireText(parameters.sbtCoreMaterial, "SBT core material", "sbtCoreMaterial", errors);
  requireText(
    parameters.buildupDielectricMaterial,
    "Buildup dielectric material",
    "buildupDielectricMaterial",
    errors,
  );
  requireText(
    parameters.buildupConductiveMaterial,
    "Buildup conductive material",
    "buildupConductiveMaterial",
    errors,
  );

  if (
    !Number.isFinite(parameters.coreDieCount) ||
    !Number.isInteger(parameters.coreDieCount) ||
    parameters.coreDieCount < 1 ||
    parameters.coreDieCount > MAX_DRAM_CORE_DIE_COUNT
  ) {
    errors.coreDieCount = `Core die count must be an integer from 1 to ${MAX_DRAM_CORE_DIE_COUNT}.`;
  }

  if (!errors.coreDieX && !errors.packageX && parameters.coreDieX > parameters.packageX) {
    errors.coreDieX = "Core die X cannot exceed Package X.";
  }
  if (!errors.coreDieY && !errors.packageY && parameters.coreDieY > parameters.packageY) {
    errors.coreDieY = "Core die Y cannot exceed Package Y.";
  }

  validateBuildupStack("top", parameters.topBuildupLayers, errors);
  validateBuildupStack("bottom", parameters.bottomBuildupLayers, errors);
  return errors;
}

export function buildDramGeometry(
  parameters: DramGeneratorParameters,
): DramGeometryStructure {
  const errors = validateDramParameters(parameters);
  if (Object.keys(errors).length > 0) {
    throw new Error("Cannot build DRAM geometry from invalid parameters.");
  }

  const dimensions = deriveDramDimensions(parameters);
  const packageBounds = makeBounds(parameters.packageX, parameters.packageY);
  const coreBounds = makeBounds(parameters.coreDieX, parameters.coreDieY);
  const sbtChildren: DramContainer[] = [];
  let cursorZ = 0;

  sbtChildren.push(
    makeBodyContainer(
      "bottom-solder-mask",
      packageBounds,
      cursorZ,
      parameters.bottomSolderMaskThickness,
      parameters.solderMaskMaterial,
    ),
  );
  cursorZ += parameters.bottomSolderMaskThickness;

  const bottomLayerZ = new Map<number, number>();
  for (let index = parameters.bottomBuildupLayers.length - 1; index >= 0; index -= 1) {
    bottomLayerZ.set(index, cursorZ);
    cursorZ += parameters.bottomBuildupLayers[index].thickness;
  }
  parameters.bottomBuildupLayers.forEach((layer, index) => {
    sbtChildren.push(
      makeBuildupLayerContainer(
        "bottom",
        index,
        layer,
        packageBounds,
        bottomLayerZ.get(index) ?? 0,
        parameters.buildupDielectricMaterial,
        parameters.buildupConductiveMaterial,
      ),
    );
  });

  sbtChildren.push(
    makeBodyContainer(
      "sbt-core-layer",
      packageBounds,
      cursorZ,
      parameters.sbtCoreLayerThickness,
      parameters.sbtCoreMaterial,
    ),
  );
  cursorZ += parameters.sbtCoreLayerThickness;

  parameters.topBuildupLayers.forEach((layer, index) => {
    sbtChildren.push(
      makeBuildupLayerContainer(
        "top",
        index,
        layer,
        packageBounds,
        cursorZ,
        parameters.buildupDielectricMaterial,
        parameters.buildupConductiveMaterial,
      ),
    );
    cursorZ += layer.thickness;
  });

  sbtChildren.push(
    makeBodyContainer(
      "top-solder-mask",
      packageBounds,
      cursorZ,
      parameters.topSolderMaskThickness,
      parameters.solderMaskMaterial,
    ),
  );

  const children: DramContainer[] = [
    {
      id: "container:dram-sbt",
      key: "sbt",
      bodies: [],
      vias: [],
      circuits: [],
      bumps: [],
      children: sbtChildren,
    },
  ];

  for (let index = 0; index < parameters.coreDieCount; index += 1) {
    const sequence = String(index + 1).padStart(2, "0");
    const bottomZ =
      dimensions.sbtThickness +
      parameters.dieGapThickness +
      index * (parameters.coreDieThickness + parameters.dieGapThickness);
    children.push(
      makeBodyContainer(
        `core-die-${sequence}`,
        coreBounds,
        bottomZ,
        parameters.coreDieThickness,
        parameters.dieMaterial,
      ),
    );
  }

  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      id: "container:dram-root",
      key: "dram-package",
      bodies: [
        {
          id: "body:dram-molding",
          geometry: makeBoxGeometry(
            packageBounds,
            dimensions.sbtThickness,
            dimensions.moldedBodyThickness,
          ),
          material: parameters.moldingMaterial.trim(),
        },
      ],
      vias: [],
      circuits: [],
      bumps: [],
      children,
    },
  };
}

function validateBuildupStack(
  side: DramStackSide,
  layers: DramBuildupLayer[],
  errors: DramParameterErrors,
) {
  const label = side === "top" ? "Top" : "Bottom";
  if (
    layers.length < 1 ||
    layers.length > MAX_DRAM_BUILDUP_LAYER_COUNT ||
    layers.length % 2 === 0
  ) {
    errors[`${side}BuildupLayers`] =
      `${label} buildup layer count must be an odd integer from 1 to ${MAX_DRAM_BUILDUP_LAYER_COUNT}.`;
  }
  layers.forEach((layer, index) => {
    requirePositive(
      layer.thickness,
      `${label} layer ${index + 1} thickness`,
      dramLayerErrorKey(side, index, "thickness"),
      errors,
    );
    if ((index + 1) % 2 === 0) {
      requireDensity(
        layer.density,
        `${label} layer ${index + 1} circuit density`,
        dramLayerErrorKey(side, index, "density"),
        errors,
      );
    }
  });
}

function makeBuildupLayerContainer(
  side: DramStackSide,
  index: number,
  layer: DramBuildupLayer,
  bounds: readonly [number, number, number, number],
  bottomZ: number,
  dielectricMaterial: string,
  conductiveMaterial: string,
): DramContainer {
  const layerNumber = index + 1;
  const sequence = String(layerNumber).padStart(2, "0");
  const key = `${side}-buildup-layer-${sequence}`;
  const geometry = makeBoxGeometry(bounds, bottomZ, layer.thickness);
  return {
    id: `container:dram-${key}`,
    key,
    bodies: [
      {
        id: `body:dram-${key}-dielectric`,
        geometry,
        material: dielectricMaterial.trim(),
      },
    ],
    vias: [],
    circuits:
      layerNumber % 2 === 0
        ? [
            {
              id: `circuit:dram-${key}`,
              geometry: { ...geometry },
              material: conductiveMaterial.trim(),
              density: layer.density,
              koz: 0,
            },
          ]
        : [],
    bumps: [],
    children: [],
  };
}

function makeBodyContainer(
  key: string,
  bounds: readonly [number, number, number, number],
  bottomZ: number,
  thickness: number,
  material: string,
): DramContainer {
  return {
    id: `container:dram-${key}`,
    key,
    bodies: [
      {
        id: `body:dram-${key}`,
        geometry: makeBoxGeometry(bounds, bottomZ, thickness),
        material: material.trim(),
      },
    ],
    vias: [],
    circuits: [],
    bumps: [],
    children: [],
  };
}

function makeBounds(x: number, y: number) {
  return [-x / 2, -y / 2, x / 2, y / 2] as const;
}

function makeBoxGeometry(
  bounds: readonly [number, number, number, number],
  bottomZ: number,
  thickness: number,
): DramBoxGeometry {
  return {
    type: "BoxGeometry",
    bottom_left: [bounds[0], bounds[1], bottomZ],
    top_right: [bounds[2], bounds[3], bottomZ],
    thk: thickness,
  };
}

function sumLayerThickness(layers: DramBuildupLayer[]) {
  return layers.reduce((sum, layer) => sum + finiteOrZero(layer.thickness), 0);
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function requirePositive(
  value: number,
  label: string,
  key: string,
  errors: DramParameterErrors,
) {
  if (!Number.isFinite(value) || value <= 0) {
    errors[key] = `${label} must be a positive number.`;
  }
}

function requireNonNegative(
  value: number,
  label: string,
  key: string,
  errors: DramParameterErrors,
) {
  if (!Number.isFinite(value) || value < 0) {
    errors[key] = `${label} must be zero or greater.`;
  }
}

function requireDensity(
  value: number,
  label: string,
  key: string,
  errors: DramParameterErrors,
) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    errors[key] = `${label} must be from 0 to 100%.`;
  }
}

function requireText(
  value: string,
  label: string,
  key: string,
  errors: DramParameterErrors,
) {
  if (typeof value !== "string" || value.trim() === "") {
    errors[key] = `${label} is required.`;
  }
}
