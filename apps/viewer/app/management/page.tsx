"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Box,
  Braces,
  GitBranch,
  Layers3,
  Plus,
  RotateCcw,
  Workflow,
} from "lucide-react";

import { ProcessStepEditDialog } from "@/components/process-step-edit/process-step-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProcessStepTemplate } from "@/lib/process-flow/types";
import type { BootstrapPayload } from "@/lib/process-flow-api";
import { loadBootstrap, resetPocData } from "@/lib/process-flow-api";

const emptyData: BootstrapPayload = {
  processFlowTemplates: [],
  processFlowInstances: [],
  processStepTemplates: [],
  geometries: [],
  geometryGenerators: [],
};

export default function ManagementPage() {
  const [data, setData] = React.useState<BootstrapPayload>(emptyData);
  const [loading, setLoading] = React.useState(true);
  const [resetting, setResetting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editingStep, setEditingStep] = React.useState<ProcessStepTemplate | null>(null);

  React.useEffect(() => {
    let active = true;
    loadBootstrap()
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setError(null);
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Unable to load management data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const templateById = React.useMemo(
    () => new Map(data.processFlowTemplates.map((template) => [template.id, template])),
    [data.processFlowTemplates],
  );
  const instanceCountByTemplate = React.useMemo(() => {
    const counts = new Map<string, number>();
    data.processFlowInstances.forEach((instance) => {
      counts.set(instance.processFlowTemplateId, (counts.get(instance.processFlowTemplateId) ?? 0) + 1);
    });
    return counts;
  }, [data.processFlowInstances]);

  const resources = [
    { label: "Templates", count: data.processFlowTemplates.length, icon: Workflow },
    { label: "Instances", count: data.processFlowInstances.length, icon: GitBranch },
    { label: "Geometries", count: data.geometries.length, icon: Box },
    { label: "Process steps", count: data.processStepTemplates.length, icon: Braces },
  ];

  async function handleDatabaseReset() {
    if (!window.confirm("Reset the database and restore the default POC data?")) return;
    setResetting(true);
    try {
      setData(await resetPocData());
      setEditingStep(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset the database.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
          <div>
            <div className="flex items-center gap-2">
              <Layers3 className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">Management</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Review process resources and manage process step settings.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/"><ArrowLeft />Home</Link>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={resetting}
              onClick={() => void handleDatabaseReset()}
            >
              <RotateCcw className={resetting ? "animate-spin" : undefined} />
              {resetting ? "Resetting..." : "Reset Database"}
            </Button>
          </div>
        </header>

        {error ? (
          <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 py-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resource counts">
          {resources.map(({ label, count, icon: Icon }) => (
            <div key={label} className="rounded-md border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">{label}</span>
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{loading ? "–" : count}</div>
            </div>
          ))}
        </section>

        <Tabs defaultValue="templates">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="templates">Templates</TabsTrigger>
              <TabsTrigger value="instances">Instances</TabsTrigger>
              <TabsTrigger value="geometries">Geometries</TabsTrigger>
              <TabsTrigger value="steps">Process steps</TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm"><Link href="/flow-template-editor"><Plus />Template</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/hbm-editor"><Plus />HBM</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/dram-editor"><Plus />DRAM</Link></Button>
            </div>
          </div>

          <TabsContent value="templates">
            <ResourceTable headings={["Template", "Version", "Owner", "Instances", ""]}>
              {data.processFlowTemplates.map((template) => (
                <tr key={template.id} className="border-b last:border-b-0">
                  <IdentityCell name={template.name} id={template.id} description={template.description} />
                  <Cell>{template.version}</Cell>
                  <Cell>{template.owner}</Cell>
                  <Cell>{instanceCountByTemplate.get(template.id) ?? 0}</Cell>
                  <td className="px-4 py-3 text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/flow-instance-editor?templateId=${encodeURIComponent(template.id)}`}>Open</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </ResourceTable>
          </TabsContent>

          <TabsContent value="instances">
            <ResourceTable headings={["Instance", "Template", "Version", "Owner"]}>
              {data.processFlowInstances.map((instance) => (
                <tr key={instance.id} className="border-b last:border-b-0">
                  <IdentityCell name={instance.name} id={instance.id} description={instance.description} />
                  <Cell>{templateById.get(instance.processFlowTemplateId)?.name ?? instance.processFlowTemplateId}</Cell>
                  <Cell>{instance.version}</Cell>
                  <Cell>{instance.owner}</Cell>
                </tr>
              ))}
            </ResourceTable>
          </TabsContent>

          <TabsContent value="geometries">
            <ResourceTable
              headings={[
                "Geometry",
                "Entity type",
                "Category",
                "Dimensions",
                "Vendor",
                "Type 1",
                "Type 2",
                "Owner",
              ]}
            >
              {data.geometries.map((geometry) => (
                <tr key={geometry.id} className="border-b last:border-b-0">
                  <IdentityCell name={geometry.name} id={geometry.id} description={geometry.description} />
                  <Cell><Badge variant="outline">{geometry.entityType}</Badge></Cell>
                  <Cell>{geometry.category}</Cell>
                  <Cell>{geometry.dim || "—"}</Cell>
                  <Cell>{geometry.vendor || "—"}</Cell>
                  <Cell>{geometry.type1 || "—"}</Cell>
                  <Cell>{geometry.type2 || "—"}</Cell>
                  <Cell>{geometry.owner}</Cell>
                </tr>
              ))}
            </ResourceTable>
          </TabsContent>

          <TabsContent value="steps">
            <ResourceTable headings={["Process step", "Category", "Version", "Owner", "Program", "Actions"]}>
              {data.processStepTemplates.map((step) => (
                <tr key={step.id} className="border-b last:border-b-0">
                  <IdentityCell name={step.name} id={step.id} description={step.description} />
                  <Cell>{step.category}</Cell>
                  <Cell>{step.version}</Cell>
                  <Cell>{step.owner}</Cell>
                  <Cell><span className="font-mono text-xs">{step.program}</span></Cell>
                  <td className="px-4 py-3 text-right align-top">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingStep(step)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </ResourceTable>
          </TabsContent>
        </Tabs>
      </div>
      {editingStep ? (
        <ProcessStepEditDialog
          key={editingStep.id}
          template={editingStep}
          onClose={() => setEditingStep(null)}
          onSaved={(saved) => {
            setData((current) => ({
              ...current,
              processStepTemplates: current.processStepTemplates.map((step) =>
                step.id === saved.id ? saved : step,
              ),
            }));
            setEditingStep(null);
          }}
        />
      ) : null}
    </main>
  );
}

function ResourceTable({ headings, children }: { headings: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr className="border-b">
              {headings.map((heading, index) => (
                <th key={`${heading}-${index}`} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

function IdentityCell({ name, id, description }: { name: string; id: string; description?: string | null }) {
  return (
    <td className="max-w-sm px-4 py-3 align-top">
      <div className="font-medium">{name}</div>
      <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={id}>{id}</div>
      {description ? <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{description}</p> : null}
    </td>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top text-sm text-muted-foreground">{children || "—"}</td>;
}
