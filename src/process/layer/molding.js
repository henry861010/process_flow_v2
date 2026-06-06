/**
 * Molding process step.
 *
 * Uses the current process footprint and cursor plane to deposit one molding
 * layer on the root scope through the ProcessGeometryState public API.
 */
export function execute({ state, values }) {
  const material = requiredNonEmptyString(values?.material, "material");
  const thickness = requiredPositiveNumber(values?.thickness, "thickness");

  state.depositLayer({
    material,
    thickness,
  });

  return state;
}

function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`molding.${label} must be a non-empty string`);
  }
  return value;
}

function requiredPositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`molding.${label} must be a positive number`);
  }
  return number;
}
