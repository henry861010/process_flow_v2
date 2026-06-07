import { executeBumpFormation } from "./shared-bump-formation.js";

/**
 * C4 bump formation process step.
 *
 * Adds a downward bump feature below the lowest body in the main geometry tree.
 * The bump XY envelope comes from the process footprint after applying koz.
 */
export function execute(context) {
  return executeBumpFormation(context, { name: "C4 Bump" });
}
