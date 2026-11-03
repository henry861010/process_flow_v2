import * as React from "react";
import { AlertTriangle } from "lucide-react";

import type { ExecutionWarning } from "./geometry-preview-client";

export function ProcessExecutionWarnings({
  warnings = [],
}: {
  warnings?: ExecutionWarning[];
}) {
  if (warnings.length === 0) return null;

  return (
    <section
      role="status"
      aria-label="Process warnings"
      tabIndex={0}
      className="max-h-[30%] min-h-0 shrink-0 overflow-y-auto border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:px-5"
    >
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Process warnings
      </h3>
      <ul className="space-y-2">
        {warnings.map((warning, index) => (
          <li
            key={`${warning.stepRefId}:${warning.code}:${index}`}
            className="min-w-0 [overflow-wrap:anywhere]"
          >
            <p className="font-semibold">{warning.stepLabel || warning.stepRefId}</p>
            <p>{warning.message}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
