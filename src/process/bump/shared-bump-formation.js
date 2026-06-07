export function executeBumpFormation({ state, values, geometryState }, { name }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
    name,
  );
  const material = requiredNonEmptyString(values?.material, "material", name);
  const thk = requiredPositiveNumber(values?.thk, "thk", name);
  const density = requiredDensity(values?.density, "density", name);
  const koz = requiredNonNegativeNumber(values?.koz, "koz", name);

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

function requiredGeometryState(value, label, stepName) {
  if (!value || typeof value.addBumpBelowLowestBody !== "function") {
    throw new Error(`${stepName}.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}

function requiredNonEmptyString(value, label, stepName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${stepName}.${label} must be a non-empty string`);
  }
  return value;
}

function requiredPositiveNumber(value, label, stepName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${stepName}.${label} must be a positive number`);
  }
  return number;
}

function requiredNonNegativeNumber(value, label, stepName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${stepName}.${label} must be a non-negative number`);
  }
  return number;
}

function requiredDensity(value, label, stepName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error(`${stepName}.${label} must be a finite number from 0 to 100`);
  }
  return number;
}
