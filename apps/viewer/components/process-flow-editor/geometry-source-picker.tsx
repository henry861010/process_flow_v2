"use client";

import * as React from "react";
import { CategoryLibraryBrowser } from "@/components/category-library/category-library-browser";
import type { GeometryGeneratorDefinition } from "@/components/geometry-generator/geometry-generator-contracts";
import { generatorsForFlowInputPicker } from "@/components/geometry-generator/geometry-generator-placements";
import { GeometryCardDetails, geometrySearchText } from "@/components/process-flow-fields/geometry-card-details";
import { Button } from "@/components/ui/button";
import { formatCategoryPath } from "@/lib/category-library";
import { geometryMatchesFlowInput } from "@/lib/process-flow/configuration";
import type { FlowInputDefinition, GeometryBinding, GeometryEntity } from "@/lib/process-flow/types";
import { cn } from "@/lib/utils";

/** Content only: the owning geometry session provides the dialog and transaction. */
export function GeometrySourcePicker({ flowInput, binding, geometries, generatorDefinitions,
  loadingGeneratorId, error, onSelect, onSelectGenerator }: {
  flowInput: FlowInputDefinition;
  binding?: GeometryBinding;
  geometries: GeometryEntity[];
  generatorDefinitions: GeometryGeneratorDefinition[];
  loadingGeneratorId: string | null;
  error: string | null;
  onSelect: (geometryId: string) => void;
  onSelectGenerator: (definition: GeometryGeneratorDefinition) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [categoryPath, setCategoryPath] = React.useState<string[]>([]);
  const generators = generatorsForFlowInputPicker(generatorDefinitions, flowInput, binding);
  const busy = loadingGeneratorId !== null;
  return (
    <section aria-label="Choose geometry source" className="space-y-4">
      <h3 data-source-heading tabIndex={-1} className="text-base font-semibold outline-none">Choose geometry source</h3>
      {generators.length ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Generators</h4>
          {generators.map((definition) => (
            <Button key={definition.id} type="button" variant="outline" className="w-full justify-start whitespace-normal text-left"
              disabled={busy} aria-busy={loadingGeneratorId === definition.id}
              onClick={() => onSelectGenerator(definition)}>{definition.label}</Button>
          ))}
        </div>
      ) : null}
      {busy ? <p role="status" className="text-sm text-muted-foreground">Loading generator…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Geometry catalog</h4>
        <CategoryLibraryBrowser items={geometries.filter((geometry) => geometryMatchesFlowInput(geometry, flowInput))}
          path={categoryPath} search={query} searchPlaceholder="Search geometry"
          emptyLabel="No matching geometry" noSearchResultsLabel="No geometry matched the search"
          noCategoryItemsLabel="No geometry in this category" getSearchText={geometrySearchText}
          itemKey={(geometry) => geometry.id} itemListClassName="grid gap-2"
          onPathChange={setCategoryPath} onSearchChange={setQuery}
          renderItem={(geometry, { showCategoryPath }) => (
            <button type="button" disabled={busy}
              className={cn("rounded-md border bg-white p-3 text-left text-sm shadow-sm transition hover:border-primary hover:bg-muted/20 disabled:cursor-not-allowed disabled:opacity-50",
                binding?.kind === "catalog" && binding.geometryId === geometry.id && "border-primary ring-2 ring-primary/20")}
              onClick={() => onSelect(geometry.id)}>
              <GeometryCardDetails geometry={geometry} categoryPath={showCategoryPath ? formatCategoryPath(geometry.category) : null} />
            </button>
          )} />
      </div>
    </section>
  );
}
