"use client";

import * as React from "react";

import { normalizePlacements } from "@/components/process-flow-fields/placement-list-control";
import { PlacementPreview } from "@/components/process-flow-fields/placement-preview";
import { formatRepeatItemName, isRepeatableGroupValue } from "@/lib/process-flow/parameter-values";
import { summarizePlacementValidation } from "@/lib/process-flow/placement-validation";
import type { ParameterDefinition, RecipeCandidate } from "@/lib/process-flow/types";

export function RecipeParameterSummary({ definitions, recipe }: {
  definitions: ParameterDefinition[];
  recipe: RecipeCandidate;
}) {
  if (!definitions.length) return <p className="mt-3 text-sm text-muted-foreground">No parameters</p>;
  return (
    <dl key={recipe.recipeId} className="mt-4 min-w-0 divide-y border-t">
      {definitions.map((definition) => (
        <div key={definition.id} className="min-w-0 py-3 first:pt-4 last:pb-0">
          <dt className="text-xs font-medium">{parameterHeading(definition)}</dt>
          <dd className="mt-2 min-w-0 text-sm text-foreground">
            <ParameterValueSummary definition={definition} value={recipe.parameterValues[definition.id]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ParameterValueSummary({ definition, value }: { definition: ParameterDefinition; value: unknown }) {
  if (definition.valueType === "placements" || definition.controlType === "placementList") {
    return <AppliedPlacementGraph value={value} unit={definition.unit} />;
  }
  if (value === undefined || value === null || value === "") return <SummaryText>Not set</SummaryText>;
  if (definition.valueType === "fieldGroupArray") {
    return <RepeatableGroupSummary definition={definition} value={value} />;
  }
  if (definition.valueType.endsWith("[]")) {
    if (!Array.isArray(value)) return <SummaryText>Invalid value</SummaryText>;
    if (!value.length) return <SummaryText>No items</SummaryText>;
    return (
      <ul className="list-disc space-y-1 pl-4">
        {value.map((item, index) => <li key={index}><SummaryText>{formatPrimitiveValue(item)}</SummaryText></li>)}
      </ul>
    );
  }
  return <SummaryText>{formatPrimitiveValue(value)}</SummaryText>;
}

function RepeatableGroupSummary({ definition, value }: { definition: ParameterDefinition; value: unknown }) {
  const repeat = definition.repeatDefinition;
  if (!repeat || !isRepeatableGroupValue(value) || value.items.some((item) => !Number.isFinite(item.index))) {
    return <SummaryText>Invalid value</SummaryText>;
  }
  if (!value.items.length) return <SummaryText>No items</SummaryText>;
  const columnWidths = repeat.itemParameterDefinitions.map((child) =>
    child.valueType === "fieldGroupArray" || child.valueType === "placements" || child.controlType === "placementList" ? 320 : 144,
  );
  return (
    <div
      role="region"
      aria-label={`${definition.name} items`}
      tabIndex={0}
      className="w-full min-w-0 max-w-full overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <table
        className="w-full table-fixed border-collapse text-left text-sm"
        style={{ minWidth: 144 + columnWidths.reduce((sum, width) => sum + width, 0) }}
      >
        <caption className="sr-only">{definition.name}</caption>
        <colgroup>
          <col style={{ width: 144 }} />
          {repeat.itemParameterDefinitions.map((child, index) => <col key={child.id} style={{ width: columnWidths[index] }} />)}
        </colgroup>
        <thead className="bg-muted/40">
          <tr>
            <th scope="col" className="px-3 py-2 align-top text-xs font-medium">Item</th>
            {repeat.itemParameterDefinitions.map((child) => (
              <th key={child.id} scope="col" className="break-words px-3 py-2 align-top text-xs font-medium [overflow-wrap:anywhere]">
                {parameterHeading(child)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {value.items.map((item) => (
            <tr key={item.itemId}>
              <th scope="row" className="break-words px-3 py-2 align-top font-medium [overflow-wrap:anywhere]">
                {formatRepeatItemName(definition, item.index)}
              </th>
              {repeat.itemParameterDefinitions.map((child) => (
                <td key={child.id} className="px-3 py-2 align-top">
                  <ParameterValueSummary definition={child} value={item.values[child.id]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AppliedPlacementGraph({ value, unit }: { value: unknown; unit?: string | null }) {
  const placements = React.useMemo(() => normalizePlacements(value), [value]);
  const validation = React.useMemo(() => summarizePlacementValidation(placements), [placements]);
  return <PlacementPreview placements={placements} validation={validation} unit={unit} selectedIndex={null} resetKey={0} onSelect={() => {}} readOnly />;
}

function SummaryText({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{children}</span>;
}

function parameterHeading(definition: ParameterDefinition) {
  return `${definition.name}${definition.unit ? ` / ${definition.unit}` : ""}`;
}

function formatPrimitiveValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not set";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  return "Invalid value";
}
