/**
 * ECL process step.
 *
 * Deposits an ECL body layer above cursorZ using the current process footprint
 * after applying a keep-out-zone XY inset.
 */
export function execute({ state, values, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );
  const material = requiredNonEmptyString(values?.material, "material");
  const thk = requiredPositiveNumber(values?.thk, "thk");
  const koz = requiredNonNegativeNumber(values?.koz, "koz");

  mainState.depositLayer({
    material,
    thickness: thk,
    xyInset: koz,
  });

  return mainState;
}

function requiredGeometryState(value, label) {
  if (!value || typeof value.depositLayer !== "function") {
    throw new Error(`ECL.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}

function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`ECL.${label} must be a non-empty string`);
  }
  return value;
}

function requiredPositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`ECL.${label} must be a positive number`);
  }
  return number;
}

function requiredNonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`ECL.${label} must be a non-negative number`);
  }
  return number;
}
