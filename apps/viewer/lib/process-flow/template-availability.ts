import type { FlowDefinition, ProcessStepTemplate, TemplateStatus } from "./types";

export function isTemplateEnabled(template: { status?: TemplateStatus } | null | undefined) {
  return template != null && template.status !== "disabled";
}

// Only new flows check step availability. Existing flows keep their references.
export function disabledStepsForNewFlow(
  template: Pick<FlowDefinition, "stepRefs">,
  stepTemplates: ProcessStepTemplate[],
) {
  const referencedIds = new Set(template.stepRefs.map((ref) => ref.processStepTemplateId));
  return stepTemplates.filter((step) => referencedIds.has(step.id) && !isTemplateEnabled(step));
}
