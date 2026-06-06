/**
 * RDL layer process step.
 *
 * Builds alternating routing and via feature envelopes over the current
 * process footprint while depositing each dielectric layer at the process
 * cursor plane.
 */
export function execute({ state, values, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );
  const layers = requiredLayers(values?.layers);

  layers.forEach((layer, index) => {
    const layerNumber = index + 1;
    if (layerNumber % 2 === 1) {
      mainState.addCircuitAtCursor({
        material: layer.conductivity,
        density: layer.density,
        thickness: layer.thk,
      });
      mainState.depositLayer({
        material: layer.dielectric,
        thickness: layer.thk,
      });
      return;
    }

    mainState.depositLayer({
      material: layer.dielectric,
      thickness: layer.thk,
    });
    mainState.addViaBelowCursor({
      material: layer.conductivity,
      density: layer.density,
      thickness: layer.thk,
      direction: "-z",
    });
  });

  return mainState;
}

function requiredGeometryState(value, label) {
  if (
    !value ||
    typeof value.depositLayer !== "function" ||
    typeof value.addCircuitAtCursor !== "function" ||
    typeof value.addViaBelowCursor !== "function"
  ) {
    throw new Error(`RDL.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}

function requiredLayers(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("RDL.layers must include at least one layer");
  }
  return value.map((item, index) => ({
    dielectric: requiredNonEmptyString(item?.Dielectric, `layers[${index}].Dielectric`),
    conductivity: requiredNonEmptyString(
      item?.Conductivity,
      `layers[${index}].Conductivity`,
    ),
    thk: requiredPositiveNumber(item?.thk, `layers[${index}].thk`),
    density: requiredDensity(item?.density, `layers[${index}].density`),
  }));
}

function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`RDL.${label} must be a non-empty string`);
  }
  return value;
}

function requiredPositiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`RDL.${label} must be a positive number`);
  }
  return number;
}

function requiredDensity(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new Error(`RDL.${label} must be a finite number from 0 to 100`);
  }
  return number;
}
