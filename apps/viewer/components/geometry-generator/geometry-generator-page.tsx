"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Boxes, Loader2 } from "lucide-react";

import { BackendGeometryGeneratorDialog } from "@/components/geometry-generator/backend-geometry-generator-dialog";
import { Button } from "@/components/ui/button";
import { listGeometryGenerators } from "@/lib/process-flow-api";
import type { GeometryGeneratorDefinition } from "@/components/geometry-generator/geometry-generator-contracts";

export function GeometryGeneratorPage({ generatorId }: { generatorId: "hbm" | "dram" }) {
  const router = useRouter();
  const [definition, setDefinition] = React.useState<GeometryGeneratorDefinition | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    listGeometryGenerators()
      .then((definitions) => {
        if (!active) return;
        const match = definitions.find((item) => item.id === generatorId);
        if (!match) throw new Error(`Geometry generator not found: ${generatorId}`);
        setDefinition(match);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Unable to load geometry generator.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [generatorId]);

  if (definition) {
    return (
      <BackendGeometryGeneratorDialog
        definition={definition}
        mode="catalog"
        presentation="page"
        onClose={() => router.push("/")}
      />
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
      <div className="w-full max-w-md rounded-md border bg-white p-6 text-center shadow-sm">
        {loading ? (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            <h1 className="mt-3 text-sm font-semibold">Loading geometry editor...</h1>
          </>
        ) : (
          <>
            <Boxes className="mx-auto h-6 w-6 text-destructive" />
            <h1 className="mt-3 text-sm font-semibold">Unable to open geometry editor</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Button className="mt-4" type="button" onClick={() => router.push("/")}>Return Home</Button>
          </>
        )}
      </div>
    </main>
  );
}
