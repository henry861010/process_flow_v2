import type { ProcessFlow, ProcessFlowCreate } from "./types";

/** Snapshot a source without carrying its identity or update revision into a new flow. */
export function createFlowBranch(source: ProcessFlow, flows: ProcessFlow[]): ProcessFlowCreate {
  const usedNames = new Set(flows.filter((flow) => flow.version === source.version).map((flow) => flow.name));
  let name = `${source.name} (branch)`;
  for (let index = 2; usedNames.has(name); index++) name = `${source.name} (branch ${index})`;
  return {
    schemaVersion: 3,
    name,
    version: source.version,
    owner: source.owner,
    description: source.description,
    definition: structuredClone(source.definition),
    configuration: structuredClone(source.configuration),
    origin: { flowId: source.id, revision: source.revision },
  };
}
