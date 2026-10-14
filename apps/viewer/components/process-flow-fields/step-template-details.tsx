import * as React from "react";
import type { ProcessStepTemplate } from "@/lib/process-flow/types";

export function StepTemplateDetails({
  template,
}: {
  template: Pick<ProcessStepTemplate, "name" | "description">;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/20 p-3 [overflow-wrap:anywhere]">
      <div className="text-sm font-medium">{template.name}</div>
      {template.description.trim() ? (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {template.description}
        </p>
      ) : null}
    </div>
  );
}
