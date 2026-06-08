/**
 * Debound process step.
 *
 * Removes all direct root bodies whose top Z equals the highest direct root
 * body top. Child scopes and non-body features are intentionally untouched.
 */
export function execute({ state, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );

  mainState.removeTopRootBodies();

  return mainState;
}

function requiredGeometryState(value, label) {
  if (!value || typeof value.removeTopRootBodies !== "function") {
    throw new Error(`Debound.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}
