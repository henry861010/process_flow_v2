export function addExampleMoldingLayer(state, { material, density, thk }) {
  requireFinitePositive(thk, "molding thickness");
  requireFinitePositive(density, "density");
  state.depositLayer({ material, thickness: thk });
  return state;
}

export function addExampleBump(state, { material, density, thk }) {
  requireFinitePositive(thk, "bump thickness");
  requireFinitePositive(density, "density");
  state.addBumpBelowLowestBody({
    material,
    density,
    thickness: thk,
    direction: "-z",
  });
  return state;
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}
