"use client";

import * as React from "react";
import { ChevronDown, Eye, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { FlowInputDefinition, GeometryEntity } from "@/lib/process-flow/types";

type GeometrySummary = Pick<GeometryEntity, "id" | "name">;

export function FlowInputBindingControl({
  geometry,
  canEdit,
  onPick,
  onPreview,
}: {
  geometry: GeometrySummary | null | undefined;
  canEdit: boolean;
  onPick: () => void;
  onPreview: () => void;
}) {
  if (!geometry) {
    if (!canEdit) {
      return (
        <div className="flex min-h-14 items-center rounded-md border border-dashed bg-muted/10 px-3 py-3 text-sm text-muted-foreground">
          No geometry bound
        </div>
      );
    }

    return (
      <Button
        variant="outline"
        className="h-auto min-h-14 w-full justify-start px-3 py-3"
        onClick={onPick}
      >
        <Plus />
        Add geometry
      </Button>
    );
  }

  return (
    <div className="flex min-h-14 items-center gap-3 rounded-md border bg-white px-3 py-2 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{geometry.name}</div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {geometry.id}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          title="Preview geometry"
          aria-label="Preview geometry"
          onClick={onPreview}
        >
          <Eye />
        </Button>
        {canEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Change geometry"
            aria-label="Change geometry"
            onClick={onPick}
          >
            <Pencil />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function FlowInputAdvancedDisclosure({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <details className="group mt-3">
      <summary className="ml-auto flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm px-1 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20">
        <span>Advanced settings</span>
        <ChevronDown
          aria-hidden="true"
          className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function FlowInputAdvancedReadOnly({
  definition,
}: {
  definition: FlowInputDefinition;
}) {
  const entityTypes = definition.geometryConstraints?.entityTypes ?? [];
  const categories = definition.geometryConstraints?.categories ?? [];

  return (
    <dl className="grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2">
      <ReadOnlyValue label="Name" value={definition.name || "—"} />
      <ReadOnlyValue label="Required" value={definition.required ? "Yes" : "No"} />
      <div className="sm:col-span-2">
        <ReadOnlyValue label="Description" value={definition.description || "—"} />
      </div>
      <ReadOnlyValue
        label="Allowed entity types"
        value={entityTypes.length > 0 ? entityTypes.join(", ") : "Any"}
      />
      <ReadOnlyValue
        label="Allowed categories"
        value={categories.length > 0 ? categories.join(", ") : "Any"}
      />
      <div className="sm:col-span-2">
        <ReadOnlyValue label="Flow input ID" value={definition.flowInputId} mono />
      </div>
    </dl>
  );
}

function ReadOnlyValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words text-foreground ${mono ? "font-mono text-[10px]" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
