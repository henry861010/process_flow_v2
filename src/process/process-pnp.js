/**
 * Pick and place source geometry state copies onto the target process state.
 *
 * Each field group item places one copy of `sourceState` under `targetState`.
 * The placed geometry's lower-left XY bounds are aligned to the item's
 * `bottomLeft_x` / `bottomLeft_y`, and its bottom Z is aligned to
 * `targetState.cursorZ()`.
 *
 * @param {import("./process-geometry-state.js").ProcessGeometryState} targetState
 * @param {import("./process-geometry-state.js").ProcessGeometryState} sourceState
 * @param {Array<{bottomLeft_x: number, bottomLeft_y: number}>} fieldGroupArray
 * @returns {import("./process-geometry-state.js").ProcessGeometryState}
 */
export function processPnp(targetState, sourceState, fieldGroupArray = []) {
  if (!Array.isArray(fieldGroupArray)) {
    throw new Error("fieldGroupArray must be an array");
  }

  fieldGroupArray.forEach((fieldGroupItem) => {
    const { x, y } = fieldGroupPoint(fieldGroupItem);
    targetState.placeGeometryState(sourceState, {
      x,
      y,
      bottomZ: targetState.cursorZ(),
      anchor: "bottomLeft",
    });
  });

  return targetState;
}

export const process_pnp = processPnp;

function fieldGroupPoint(fieldGroupItem) {
  if (
    fieldGroupItem !== null &&
    typeof fieldGroupItem === "object" &&
    !Array.isArray(fieldGroupItem)
  ) {
    return requireFinitePoint(
      fieldGroupItem.bottomLeft_x,
      fieldGroupItem.bottomLeft_y,
    );
  }
  throw new Error(
    "fieldGroupArray items must provide bottomLeft_x and bottomLeft_y",
  );
}

function requireFinitePoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("bottomLeft_x and bottomLeft_y must be finite numbers");
  }
  return { x, y };
}
