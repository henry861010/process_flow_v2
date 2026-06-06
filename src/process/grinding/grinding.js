/**
 * Grinding process step.
 *
 * Removes material from the full geometry top down by a requested thickness.
 * The cut target is based on geometryZMax(), not cursorZ().
 */
export function execute({ state, values, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );
  const thk = requiredPositiveNumber(values?.thk, "thk");
  const targetZ = mainState.geometryZMax() - thk;

  mainState.grindTo({ z: targetZ });

  return mainState;
}

function requiredGeometryState(value, label) {
  if (
    !value ||
    typeof value.geometryZMax !== "function" ||
    typeof value.grindTo !== "function"
  ) {
    throw new Error(`Grinding.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}

function requiredPositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Grinding.${label} must be a positive number`);
  }
  return number;
}
