import * as React from "react";
import { cn } from "@/lib/utils";

export const valueFieldSelectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
export const valueFieldInputClass = `${valueFieldSelectClass} py-2`;
export const valueFieldUnitClass = "shrink-0 text-sm text-muted-foreground";

export function ValueFieldList({ children }: { children: React.ReactNode }) {
  return <div className="divide-y rounded-md border bg-white">{children}</div>;
}

export function ValueFieldRow({ label, children, compact = false, invalid = false }: {
  label: React.ReactNode;
  children: React.ReactNode;
  compact?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className={cn(
      compact
        ? "grid min-w-0 grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-start gap-3 text-sm"
        : "grid grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.2fr)] gap-4 px-4 py-4 text-sm max-md:grid-cols-1",
      invalid && "bg-destructive/5",
    )}>
      <div className={compact ? "pt-2" : undefined}>{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
