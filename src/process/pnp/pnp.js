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
  const items = Array.isArray(value) ? value : legacyRepeaterItems(value);
  if (!Array.isArray(items)) {
    throw new Error("PnP.coordinates must be an array of placement coordinates");
  }
  return items.map((item, index) => coordinateItem(item, index));
}

function coordinateItem(item, index) {
  if (Array.isArray(item)) {
    if (item.length !== 2) {
      throw new Error(`PnP.coordinates[${index}] must be an [x, y] tuple`);
    }
    return {
      x: coordinateNumber(item[0], `coordinates[${index}][0]`),
      y: coordinateNumber(item[1], `coordinates[${index}][1]`),
    };
  }

  if (!item || typeof item !== "object") {
    throw new Error(`PnP.coordinates[${index}] must be an [x, y] tuple or object`);
  }
  return {
    x: coordinateObjectNumber(item, "bottemLeftX", "bottomLeftX", index),
    y: coordinateObjectNumber(item, "bottemLeftY", "bottomLeftY", index),
  };
}

function legacyRepeaterItems(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) {
    return null;
  }
  return value.items.map((item) => {
    const fieldValues = Array.isArray(item?.fieldValues) ? item.fieldValues : [];
    return {
      bottemLeftX: legacyFieldValue(fieldValues, "bottemLeftX", "bottomLeftX"),
      bottemLeftY: legacyFieldValue(fieldValues, "bottemLeftY", "bottomLeftY"),
    };
  });
}

function legacyFieldValue(fieldValues, primaryFieldId, fallbackFieldId) {
  const target = fieldValues.find(
    (fieldValue) =>
      fieldValue?.fieldId === primaryFieldId || fieldValue?.fieldId === fallbackFieldId,
  );
  return target?.value;
}

function coordinateObjectNumber(item, primaryFieldId, fallbackFieldId, index) {
  const value = Object.hasOwn(item, primaryFieldId)
    ? item[primaryFieldId]
    : item[fallbackFieldId];
  if (value === null || value === undefined || value === "") {
    throw new Error(`PnP.coordinates[${index}].${primaryFieldId} is required`);
  }
  return coordinateNumber(value, `coordinates[${index}].${primaryFieldId}`);
}

function coordinateNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`PnP.${label} must be a finite number`);
  }
  return number;
}
