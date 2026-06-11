import { executeBumpFormation } from "./shared-bump-formation.js";

/**
 * Micro bump formation process step.
 *
 * Adds an upward bump feature above cursorZ in the main geometry state.
 * The bump XY envelope comes from the process footprint after applying koz.
 */
export function execute(context) {
  return executeBumpFormation(context, { name: "Micro Bump" });
}
