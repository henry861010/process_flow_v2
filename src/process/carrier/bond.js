/**
 * Carrier bond process step.
 *
 * Copies the carrier geometry root direct bodies onto the top of the main
 * geometry tree as direct root bodies.
 */
export function execute({ state, geometryState }) {
  const mainState = requiredGeometryState(
    geometryState?.("main_geometry") ?? state,
    "main_geometry",
  );
  const carrierState = requiredGeometryState(
    geometryState?.("carrier_geometry"),
    "carrier_geometry",
  );

  mainState.bondCarrierGeometry(carrierState);

  return mainState;
}

function requiredGeometryState(value, label) {
  if (!value || typeof value.bondCarrierGeometry !== "function") {
    throw new Error(`CarrierBond.${label} must resolve to a ProcessGeometryState`);
  }
  return value;
}
