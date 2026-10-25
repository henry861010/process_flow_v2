"use client";

import * as React from "react";
import Link from "next/link";
import {
  Plus,
  Settings,
  Workflow,
} from "lucide-react";

import type { GeometryGeneratorDefinition } from "@/components/geometry-generator/geometry-generator-contracts";
import {
  catalogGeneratorHref,
  generatorDisplayName,
  generatorsForPlacement,
} from "@/components/geometry-generator/geometry-generator-placements";
import { GeometryGeneratorIcon } from "@/components/geometry-generator/geometry-generator-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProcessFlow } from "@/lib/process-flow/types";
import { loadBootstrap } from "@/lib/process-flow-api";

type HomeData = {
  flows: ProcessFlow[];
  geometryGenerators: GeometryGeneratorDefinition[];
};

const emptyHomeData: HomeData = { flows: [], geometryGenerators: [] };

export default function Home() {
  const [homeData, setHomeData] = React.useState<HomeData>(emptyHomeData);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const loadHomeData = React.useCallback(async () => {
    setLoading(true);
    try {
      const payload = await loadBootstrap();
      setHomeData({
        flows: payload.processFlows,
        geometryGenerators: payload.geometryGenerators,
      });
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load API data.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadHomeData();
  }, [loadHomeData]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Workflow className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold tracking-normal">Process Flow</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Open a flow to edit its topology and recipe candidates.
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" className="text-muted-foreground">
            <Link href="/management">
              <Settings />
              Management
            </Link>
          </Button>
        </header>

        <section className="flex-1 py-6" aria-labelledby="flows-heading">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="flows-heading" className="text-sm font-semibold">
                Process flows
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Open a flow to edit its topology and recipe candidates.
              </p>
            </div>
            {!loading ? <Badge variant="outline">{homeData.flows.length} flows</Badge> : null}
          </div>

          {loadError ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <span>{loadError}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void loadHomeData()}>
                Retry
              </Button>
            </div>
          ) : null}

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading flows">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-28 animate-pulse rounded-md border bg-white/60" />
              ))}
            </div>
          ) : homeData.flows.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {homeData.flows.map((template) => (
                <Link
                  key={template.id}
                  href={`/flow-editor?flowId=${encodeURIComponent(template.id)}`}
                  className="group grid min-h-28 grid-cols-[minmax(0,7fr)_minmax(0,3fr)] items-center rounded-md border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <div className="min-w-0 pr-4">
                    <h3 className="truncate text-base font-semibold" title={template.name}>
                      {template.name}
                    </h3>
                    <Badge variant="outline" className="mt-2">r{template.revision}</Badge>
                  </div>
                  <div className="min-w-0 text-right">
                    <Badge variant="outline">{template.version}</Badge>
                    <p className="mt-2 truncate text-xs text-muted-foreground" title={template.owner}>
                      {template.owner || "Unassigned"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid min-h-56 place-items-center rounded-md border border-dashed bg-white/70 px-6 text-center">
              <div>
                <Workflow className="mx-auto h-7 w-7 text-primary" />
                <h3 className="mt-3 text-sm font-semibold">No process flows</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create a flow to define its topology and recipes.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="border-t py-5" aria-labelledby="create-heading">
          <div className="mb-3">
            <h2 id="create-heading" className="text-sm font-semibold">Create resources</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Create process flows and catalog geometry.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/flow-editor"><Plus />Create Flow</Link>
            </Button>
            {generatorsForPlacement(homeData.geometryGenerators, "home").map((definition) => (
              <Button key={definition.id} asChild variant="outline">
                <Link href={catalogGeneratorHref(definition)}>
                  <GeometryGeneratorIcon definition={definition} />
                  Create {generatorDisplayName(definition)}
                </Link>
              </Button>
            ))}
            <Button asChild variant="outline">
              <Link href="/geometry-editor"><Plus />Geometry</Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
