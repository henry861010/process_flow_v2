export const MAX_CORE_DIE_COUNT = 64;

export type HbmGeneratorParameters = {
  packageX: number;
  packageY: number;
  topMoldingThickness: number;
  moldingMaterial: string;
  baseDieThickness: number;
  coreDieX: number;
  coreDieY: number;
  coreDieThickness: number;
  coreDieCount: number;
  coreBaseGap: number;
  coreCoreGap: number;
  dieMaterial: string;
};

export type HbmParameterKey = keyof HbmGeneratorParameters;

export type HbmParameterErrors = Partial<Record<HbmParameterKey, string>>;

export type HbmDerivedDimensions = {
  totalThickness: number;
  sideMoldingX: number;
  sideMoldingY: number;
};

type Point3 = [number, number, number];

export type HbmBoxGeometry = {
  type: "BoxGeometry";
  bottom_left: Point3;
  top_right: Point3;
  thk: number;
};

export type HbmBody = {
  id: string;
  geometry: HbmBoxGeometry;
  material: string;
};

export type HbmContainer = {
  id: string;
  key: string;
  bodies: HbmBody[];
  vias: [];
  circuits: [];
  bumps: [];
  children: HbmContainer[];
};

export type HbmGeometryStructure = {
  schemaVersion: "1.0.0";
  unitSystem: "um";
  root: HbmContainer;
};

export const DEFAULT_HBM_PARAMETERS: HbmGeneratorParameters = {
  packageX: 12000,
  packageY: 8000,
  topMoldingThickness: 100,
  moldingMaterial: "EMC",
  baseDieThickness: 100,
  coreDieX: 8000,
  coreDieY: 6000,
  coreDieThickness: 50,
  coreDieCount: 4,
  coreBaseGap: 20,
  coreCoreGap: 20,
  dieMaterial: "Si-HBM",
};

export function deriveHbmDimensions(
  parameters: HbmGeneratorParameters,
): HbmDerivedDimensions {
  const coreCount = Number.isFinite(parameters.coreDieCount)
    ? parameters.coreDieCount
    : 0;
  return {
    totalThickness:
      parameters.baseDieThickness +
      parameters.coreBaseGap +
      coreCount * parameters.coreDieThickness +
      Math.max(0, coreCount - 1) * parameters.coreCoreGap +
      parameters.topMoldingThickness,
    sideMoldingX: (parameters.packageX - parameters.coreDieX) / 2,
    sideMoldingY: (parameters.packageY - parameters.coreDieY) / 2,
  };
}

export function validateHbmParameters(
  parameters: HbmGeneratorParameters,
): HbmParameterErrors {
  const errors: HbmParameterErrors = {};

  requirePositive(parameters.packageX, "Package X", "packageX", errors);
  requirePositive(parameters.packageY, "Package Y", "packageY", errors);
  requireNonNegative(
    parameters.topMoldingThickness,
    "Top molding thickness",
    "topMoldingThickness",
    errors,
  );
  requireText(parameters.moldingMaterial, "Molding material", "moldingMaterial", errors);
  requirePositive(
    parameters.baseDieThickness,
    "Base die thickness",
    "baseDieThickness",
    errors,
  );
  requirePositive(parameters.coreDieX, "Core die X", "coreDieX", errors);
  requirePositive(parameters.coreDieY, "Core die Y", "coreDieY", errors);
  requirePositive(
    parameters.coreDieThickness,
    "Core die thickness",
    "coreDieThickness",
    errors,
  );
  requireNonNegative(parameters.coreBaseGap, "Core-base gap", "coreBaseGap", errors);
  requireNonNegative(parameters.coreCoreGap, "Core-core gap", "coreCoreGap", errors);
  requireText(parameters.dieMaterial, "Die material", "dieMaterial", errors);

  if (
    !Number.isFinite(parameters.coreDieCount) ||
    !Number.isInteger(parameters.coreDieCount) ||
    parameters.coreDieCount < 1 ||
    parameters.coreDieCount > MAX_CORE_DIE_COUNT
  ) {
    errors.coreDieCount = `Core die count must be an integer from 1 to ${MAX_CORE_DIE_COUNT}.`;
  }

  if (!errors.coreDieX && !errors.packageX && parameters.coreDieX > parameters.packageX) {
    errors.coreDieX = "Core die X cannot exceed Package X.";
  }
  if (!errors.coreDieY && !errors.packageY && parameters.coreDieY > parameters.packageY) {
    errors.coreDieY = "Core die Y cannot exceed Package Y.";
  }

  return errors;
}

export function buildHbmGeometry(
  parameters: HbmGeneratorParameters,
): HbmGeometryStructure {
  const errors = validateHbmParameters(parameters);
  if (Object.keys(errors).length > 0) {
    throw new Error("Cannot build HBM geometry from invalid parameters.");
  }

  const dimensions = deriveHbmDimensions(parameters);
  const packageBottomLeft: Point3 = [
    -parameters.packageX / 2,
    -parameters.packageY / 2,
    0,
  ];
  const packageTopRight: Point3 = [
    parameters.packageX / 2,
    parameters.packageY / 2,
    0,
  ];
  const coreBottomLeftXY = [
    -parameters.coreDieX / 2,
    -parameters.coreDieY / 2,
  ] as const;
  const coreTopRightXY = [
    parameters.coreDieX / 2,
    parameters.coreDieY / 2,
  ] as const;

  const children: HbmContainer[] = [
    makeBodyContainer(
      "container:hbm-base-die",
      "base-die",
      "body:hbm-base-die",
      packageBottomLeft,
      packageTopRight,
      parameters.baseDieThickness,
      parameters.dieMaterial.trim(),
    ),
  ];

  for (let index = 0; index < parameters.coreDieCount; index += 1) {
    const sequence = String(index + 1).padStart(2, "0");
    const bottomZ =
      parameters.baseDieThickness +
      parameters.coreBaseGap +
      index * (parameters.coreDieThickness + parameters.coreCoreGap);
    children.push(
      makeBodyContainer(
        `container:hbm-core-die-${sequence}`,
        `core-die-${sequence}`,
        `body:hbm-core-die-${sequence}`,
        [coreBottomLeftXY[0], coreBottomLeftXY[1], bottomZ],
        [coreTopRightXY[0], coreTopRightXY[1], bottomZ],
        parameters.coreDieThickness,
        parameters.dieMaterial.trim(),
      ),
    );
  }

  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      id: "container:hbm-root",
      key: "hbm-package",
      bodies: [
        {
          id: "body:hbm-molding",
          geometry: {
            type: "BoxGeometry",
            bottom_left: packageBottomLeft,
            top_right: packageTopRight,
            thk: dimensions.totalThickness,
          },
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

function makeBodyContainer(
  id: string,
  key: string,
  bodyId: string,
  bottomLeft: Point3,
  topRight: Point3,
  thickness: number,
  material: string,
): HbmContainer {
  return {
    id,
    key,
    bodies: [
      {
        id: bodyId,
        geometry: {
          type: "BoxGeometry",
          bottom_left: bottomLeft,
          top_right: topRight,
          thk: thickness,
        },
        material,
      },
    ],
    vias: [],
    circuits: [],
    bumps: [],
    children: [],
  };
}

function requirePositive(
  value: number,
  label: string,
  key: HbmParameterKey,
  errors: HbmParameterErrors,
) {
  if (!Number.isFinite(value) || value <= 0) {
    errors[key] = `${label} must be greater than 0.`;
  }
}

function requireNonNegative(
  value: number,
  label: string,
  key: HbmParameterKey,
  errors: HbmParameterErrors,
) {
  if (!Number.isFinite(value) || value < 0) {
    errors[key] = `${label} must be 0 or greater.`;
  }
}

function requireText(
  value: string,
  label: string,
  key: HbmParameterKey,
  errors: HbmParameterErrors,
) {
  if (value.trim().length === 0) {
    errors[key] = `${label} is required.`;
  }
}
