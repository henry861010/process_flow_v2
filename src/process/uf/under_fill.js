/**
 * Under Fill process step.
 *
 * Fills bump-side child cavities and die-to-die root gaps without moving the
 * root process cursor.
 */
export function execute({ state, values, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );
  const material = requiredNonEmptyString(values?.material, "material");
  const thk = requiredPositiveNumber(values?.thk, "thk");
  const gap = requiredNonNegativeNumber(values?.gap, "gap");

  mainState.applyUnderFill({
    material,
    thk,
    gap,
  });

  return mainState;
}

function requiredGeometryState(value, label) {
  if (!value || typeof value.applyUnderFill !== "function") {
    throw new Error(`Under Fill.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}

function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Under Fill.${label} must be a non-empty string`);
  }
  return value;
}

function requiredPositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Under Fill.${label} must be a positive number`);
  }
  return number;
}

function requiredNonNegativeNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Under Fill.${label} must be a non-negative number`);
  }
  return number;
}

