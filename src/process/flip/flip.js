/**
 * Flip process step.
 *
 * Mirrors the main geometry around the XY plane at Z=0, normalizes the flipped
 * geometry so zMin becomes 0, and updates cursorZ to the highest direct root
 * body top.
 */
export function execute({ state, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );

  mainState.flipAroundZ({
    z: 0,
    normalizeZMinToZero: true,
    updateCursor: false,
  });
  mainState.setCursorZ(mainState.rootBodyZMax());

  return mainState;
}

function requiredGeometryState(value, label) {
  if (
    !value ||
    typeof value.flipAroundZ !== "function" ||
    typeof value.rootBodyZMax !== "function" ||
    typeof value.setCursorZ !== "function"
  ) {
    throw new Error(`Flip.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}
