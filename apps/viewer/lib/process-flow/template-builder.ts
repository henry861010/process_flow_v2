import { createFlowParameterDefaults } from "./parameter-values";
import type {
  FlowConfiguration,
  FlowInputDefinition,
  ProcessFlowTemplate,
  ProcessStepTemplate,
  SavedFlowEdge,
  StepRef,
} from "./types";

export function buildTemplatePayload(
  metadata: Pick<ProcessFlowTemplate, "id" | "name" | "version" | "owner" | "description">,
  flowInputs: FlowInputDefinition[],
  steps: Array<{ ref: StepRef; template: ProcessStepTemplate }>,
  flowEdges: SavedFlowEdge[],
  configuration: FlowConfiguration,
): ProcessFlowTemplate {
  return {
    schemaVersion: 2,
    ...metadata,
    flowInputs: structuredClone(flowInputs),
    stepRefs: steps.map(({ ref, template }) => ({
      ...structuredClone(ref),
      parameterDefaults: createFlowParameterDefaults(
        template.parameterDefinitions,
        configuration.stepConfigurations[ref.stepRefId]?.parameterValues ?? {},
      ),
    })),
    flowEdges: structuredClone(flowEdges),
  };
}
