"use client";

import * as React from "react";
import type { TemplateStatus } from "@/lib/process-flow/types";

export function TemplateStatusField({
  value,
  disabled,
  description,
  onChange,
}: {
  value: TemplateStatus;
  disabled: boolean;
  description: string;
  onChange: (value: TemplateStatus) => void;
}) {
  const descriptionId = React.useId();
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>Status</span>
      <select
        aria-label="Status"
        aria-describedby={descriptionId}
        className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as TemplateStatus)}
      >
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
      </select>
      <span id={descriptionId} className="text-xs font-normal text-muted-foreground">{description}</span>
    </label>
  );
}
