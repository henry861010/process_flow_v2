"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Plus, Settings, Workflow } from "lucide-react";

import {
  catalogGeneratorHref,
  generatorDisplayName,
  generatorsForPlacement,
} from "@/components/geometry-generator/geometry-generator-placements";
import { GeometryGeneratorIcon } from "@/components/geometry-generator/geometry-generator-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateInstanceDialog } from "./create-instance-dialog";
import type { ProcessFlowInstance } from "@/lib/process-flow/types";
import type { BootstrapPayload } from "@/lib/process-flow-api";
import { isTemplateEnabled } from "@/lib/process-flow/template-availability";

export type HomeData = Pick<BootstrapPayload,
  "processFlowTemplates" | "processFlowInstances" | "processStepTemplates" | "geometryGenerators"
>;

type HomeWorkspaceProps = {
  data: HomeData | null;
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
  onCreated: (instance: ProcessFlowInstance, editAfterCreate: boolean) => void;
};

const rowClass = "group flex min-w-0 flex-col gap-3 rounded-md border border-transparent p-4 transition-colors hover:border-primary/25 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-20 sm:flex-row sm:items-center sm:justify-between sm:gap-6";
const metadataClass = "mt-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]";
const buttonClass = "min-h-10 h-auto px-4 py-2 text-sm leading-5";

function LoadingRows({ label }: { label: string }) {
  return (
    <div role="status" className="space-y-2 p-2">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((item) => (
        <div key={item} aria-hidden="true" className="space-y-3 rounded-md p-4 motion-safe:animate-pulse">
          <div className="h-5 w-2/3 rounded-sm bg-muted" />
          <div className="h-4 w-1/2 rounded-sm bg-muted" />
          <div className="h-4 w-1/3 rounded-sm bg-muted sm:hidden" />
        </div>
      ))}
    </div>
  );
}

function RowAction({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-sm font-medium leading-5 text-primary">
      {children}<ArrowRight aria-hidden="true" className="h-4 w-4" />
    </span>
  );
}

function InstanceSection({ name, version, disabled, instances }: {
  name: string; version?: string; disabled?: boolean; instances: ProcessFlowInstance[];
}) {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="min-w-0 overflow-hidden rounded-lg border bg-card">
      <header className="flex items-start justify-between gap-4 border-b bg-muted/30 px-6 py-4 sm:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={headingId} className="min-w-0 text-base font-semibold leading-6 [overflow-wrap:anywhere]">{name}</h2>
          {version ? <span className="min-w-0 text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]">{version}</span> : null}
          {disabled ? <Badge variant="outline" className="min-h-6 leading-4">Disabled</Badge> : null}
        </div>
        <Badge variant="secondary" className="min-h-6 shrink-0 tabular-nums leading-4" aria-label={`${instances.length} ${instances.length === 1 ? "instance" : "instances"}`}>{instances.length}<span className="ml-1 hidden sm:inline">{instances.length === 1 ? "instance" : "instances"}</span></Badge>
      </header>
      {instances.length ? (
        <ul className="divide-y divide-border/50 p-2">
          {instances.map((instance) => (
            <li key={instance.id}>
              <Link href={`/flow-instance-editor?instanceId=${encodeURIComponent(instance.id)}`} className={rowClass}>
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <h3 className="text-base font-medium leading-6">{instance.name}</h3>
                  <div className={metadataClass}>
                    <span>{instance.version}</span>
                    <span>Owner: {instance.owner || "Unassigned"}</span>
                    <span className="tabular-nums">Revision {instance.revision}</span>
                  </div>
                </div>
                <RowAction>Open instance</RowAction>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="px-6 py-6 text-sm leading-6 text-muted-foreground">No instances yet</p>}
    </section>
  );
}

export function HomeWorkspace({ data, loading, loadError, onRetry, onCreated }: HomeWorkspaceProps) {
  const [creating, setCreating] = React.useState(false);
  const createButton = React.useRef<HTMLButtonElement>(null);
  const templates = data?.processFlowTemplates ?? [];
  const enabledTemplates = templates.filter(isTemplateEnabled);
  const grouped = new Map(templates.map((template) => [template.id, [] as ProcessFlowInstance[]]));
  const unavailable: ProcessFlowInstance[] = [];
  for (const instance of data?.processFlowInstances ?? []) {
    (grouped.get(instance.processFlowTemplateId) ?? unavailable).push(instance);
  }

  return (
    <main className="min-h-screen bg-background pb-24 text-sm leading-5 text-foreground">
      <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Workflow aria-hidden="true" className="h-5 w-5" />
            </span>
            <h1 className="text-xl font-semibold leading-7 tracking-tight">Process Flow</h1>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
            <Button asChild variant="default" className={`${buttonClass} whitespace-normal`}><Link href="/flow-template-editor"><Plus aria-hidden="true" />Create Template</Link></Button>
            <Button ref={createButton} type="button" variant="default" className={`${buttonClass} whitespace-normal`} disabled={!enabledTemplates.length}
              aria-describedby={data && !enabledTemplates.length ? "create-unavailable" : undefined}
              onClick={() => setCreating(true)}><Plus aria-hidden="true" />Create Instance</Button>
          </div>
        </header>
        {data && !enabledTemplates.length ? <p id="create-unavailable" className="mt-4 text-sm text-muted-foreground">
          No templates available for new instances. Create a template or enable one in Management.
        </p> : null}

        {loadError ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <div role="alert" className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
              <p className="font-medium text-destructive">Unable to load workspace</p>
              <p className="mt-1 text-muted-foreground">{loadError}</p>
              {data ? <p className="mt-1 text-sm text-muted-foreground">Showing previously loaded content.</p> : null}
            </div>
            <Button type="button" variant="outline" className={buttonClass} disabled={loading} onClick={onRetry}>
              {loading ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : null}

        <div aria-label="Instances by template" aria-busy={loading} className="mt-6 space-y-6">
          {!data ? loading ? <LoadingRows label="Loading templates and instances" /> : (
            <p className="py-6 text-sm text-muted-foreground">Templates and instances could not be loaded. Use Retry above to try again.</p>
          ) : <>
            {templates.map((template) => <InstanceSection key={template.id} name={template.name}
              version={template.version} disabled={!isTemplateEnabled(template)} instances={grouped.get(template.id)!} />)}
            {unavailable.length ? <InstanceSection name="Unavailable template" instances={unavailable} /> : null}
            {!templates.length && !unavailable.length ? <p className="py-6 text-sm text-muted-foreground">No templates or instances yet.</p> : null}
          </>}
        </div>

        <section aria-labelledby="create-heading" className="mt-8 border-t pt-6">
          <h2 id="create-heading" className="text-base font-semibold leading-6">Build reusable resources</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">Create catalog geometry for use in instances.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {generatorsForPlacement(data?.geometryGenerators ?? [], "home").map((definition) => (
              <Button key={definition.id} asChild variant="outline" className={`${buttonClass} max-w-full whitespace-normal text-left [overflow-wrap:anywhere]`}>
                <Link href={catalogGeneratorHref(definition)}>
                  <span aria-hidden="true" className="shrink-0"><GeometryGeneratorIcon definition={definition} /></span>
                  Create {generatorDisplayName(definition)}
                </Link>
              </Button>
            ))}
            <Button asChild variant="outline" className={buttonClass}><Link href="/geometry-editor"><Plus aria-hidden="true" />Geometry</Link></Button>
          </div>
        </section>
      </div>
      <nav aria-label="Workspace management" className="fixed bottom-5 right-5 z-20 sm:right-6 lg:right-8">
        <Button asChild variant="outline" className={`${buttonClass} bg-card shadow-sm`}>
          <Link href="/management"><Settings aria-hidden="true" />Management</Link>
        </Button>
      </nav>
      {creating && data ? <CreateInstanceDialog templates={templates} stepTemplates={data.processStepTemplates}
        returnFocus={createButton} onClose={() => setCreating(false)} onCreated={(instance, editAfterCreate) => {
          setCreating(false);
          onCreated(instance, editAfterCreate);
        }} /> : null}
    </main>
  );
}
