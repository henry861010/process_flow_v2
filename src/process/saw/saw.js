/**
 * Saw process step.
 *
 * Recursively keeps only the requested XY rectangle in the main geometry state
 * and updates the runtime process footprint to that retained box.
 */
export function execute({ state, values, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );

  mainState.sawToBox({
    bottomLeftX: requiredFiniteNumber(values?.bottomLeftX, "bottomLeftX"),
    bottomLeftY: requiredFiniteNumber(values?.bottomLeftY, "bottomLeftY"),
    topRightX: requiredFiniteNumber(values?.topRightX, "topRightX"),
    topRightY: requiredFiniteNumber(values?.topRightY, "topRightY"),
  });

  return mainState;
}

function requiredGeometryState(value, label) {
  if (!value || typeof value.sawToBox !== "function") {
    throw new Error(`saw.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}

function requiredFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`saw.${label} must be a finite number`);
  }
  return number;
}
