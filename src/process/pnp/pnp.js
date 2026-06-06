/**
 * PnP process step.
 *
 * Places copies of a die geometry state onto the main geometry root scope at
 * the main state's current cursor plane.
 */
export function execute({ state, values, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );
  const dieState = requiredGeometryState(
    geometryState?.("die_geometry"),
    "die_geometry",
  );
  const placements = requiredCoordinates(values?.coordinates);
  const bottomZ = mainState.cursorZ();

  mainState.placeGeometryStates(
    dieState,
    placements.map((placement) => ({
      x: placement.x,
      y: placement.y,
      bottomZ,
      anchor: "bottomLeft",
      clone: true,
    })),
  );

  return mainState;
}

function requiredGeometryState(value, label) {
  if (
    !value ||
    typeof value.cursorZ !== "function" ||
    typeof value.placeGeometryStates !== "function"
  ) {
    throw new Error(`PnP.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}

function requiredCoordinates(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("PnP.coordinates must include at least one placement coordinate");
  }
  return value.map((item, index) => ({
    x: coordinateNumber(item, "bottemLeftX", "bottomLeftX", index),
    y: coordinateNumber(item, "bottemLeftY", "bottomLeftY", index),
  }));
}

function coordinateNumber(item, primaryFieldId, fallbackFieldId, index) {
  if (!item || typeof item !== "object") {
    throw new Error(`PnP.coordinates[${index}] must be an object`);
  }
  const value = Object.hasOwn(item, primaryFieldId)
    ? item[primaryFieldId]
    : item[fallbackFieldId];
  if (value === null || value === undefined || value === "") {
    throw new Error(`PnP.coordinates[${index}].${primaryFieldId} is required`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`PnP.coordinates[${index}].${primaryFieldId} must be a finite number`);
  }
  return number;
}
