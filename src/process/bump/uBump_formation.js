/**
 * Micro bump formation process step.
 *
 * Adds a downward bump feature below the lowest body in the main geometry tree.
 * The bump XY envelope comes from the process footprint after applying koz.
 */
export function execute({ state, values, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );
  const material = requiredNonEmptyString(values?.material, "material");
  const thk = requiredPositiveNumber(values?.thk, "thk");
  const density = requiredDensity(values?.density, "density");
  const koz = requiredNonNegativeNumber(values?.koz, "koz");

  mainState.addBumpBelowLowestBody({
    material,
    density,
    thickness: thk,
    direction: "-z",
    footprintSource: "processFootprint",
    xyInset: koz,
  });

  return mainState;
}

function requiredGeometryState(value, label) {
  if (!value || typeof value.addBumpBelowLowestBody !== "function") {
    throw new Error(`Micro Bump.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}

function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Micro Bump.${label} must be a non-empty string`);
  }
  return value;
}

function requiredPositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Micro Bump.${label} must be a positive number`);
  }
  return number;
}

function requiredNonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Micro Bump.${label} must be a non-negative number`);
  }
  return number;
}

function requiredDensity(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error(`Micro Bump.${label} must be a finite number from 0 to 100`);
  }
  return number;
}
