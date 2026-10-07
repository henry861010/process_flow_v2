"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Box,
  Braces,
  Database,
  Download,
  GitBranch,
  Layers3,
  RotateCcw,
  Upload,
  Workflow,
} from "lucide-react";

import { ProcessFlowTemplateEditDialog } from "@/components/process-flow-template-edit/process-flow-template-edit-dialog";
import { ProcessStepEditDialog } from "@/components/process-step-edit/process-step-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProcessFlowTemplate, ProcessStepTemplate } from "@/lib/process-flow/types";
import type { BootstrapPayload } from "@/lib/process-flow-api";
import {
  ApiRequestError,
  deleteProcessFlowInstance,
  deleteProcessFlowTemplate,
  exportFixtureArchive,
  loadBootstrap,
  resetPocData,
  resetPocDataFromZip,
} from "@/lib/process-flow-api";

type DeletableCollection = "processFlowTemplates" | "processFlowInstances";

const deletionActions = {
  processFlowTemplates: {
    label: "flow template",
    remove: deleteProcessFlowTemplate,
    consequence: "All workspace drafts referencing this template will also be permanently deleted.",
  },
  processFlowInstances: {
    label: "instance",
    remove: deleteProcessFlowInstance,
    consequence: "Any committed workspace that produced this instance will also be permanently deleted.",
  },
};

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
  const [exporting, setExporting] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [fixtureMenuOpen, setFixtureMenuOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<{ collection: DeletableCollection; id: string } | null>(null);
  const deletionInProgressRef = React.useRef(false);
  const [editingTemplate, setEditingTemplate] = React.useState<ProcessFlowTemplate | null>(null);
  const [editingStep, setEditingStep] = React.useState<ProcessStepTemplate | null>(null);
  const fixtureMenuRef = React.useRef<HTMLDivElement>(null);
  const fixtureFileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!fixtureMenuOpen) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!fixtureMenuRef.current?.contains(event.target as Node)) setFixtureMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setFixtureMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [fixtureMenuOpen]);

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
  const fixtureBusy = exporting || resetting || importing;
  const resourceBusy = loading || fixtureBusy || deleting !== null;

  async function handleDelete(collection: DeletableCollection, resource: { id: string; name: string }) {
    if (deletionInProgressRef.current || resourceBusy || editingTemplate || editingStep) return;
    const action = deletionActions[collection];
    if (!window.confirm(`Permanently delete ${action.label} "${resource.name}" (${resource.id})?\n\n${action.consequence}`)) return;
    deletionInProgressRef.current = true;
    setDeleting({ collection, id: resource.id });
    setFixtureMenuOpen(false);
    setError(null);
    setSuccess(null);
    try {
      await action.remove(resource.id);
      setData((current) => ({
        ...current,
        [collection]: current[collection].filter((item) => item.id !== resource.id),
      }));
      setSuccess(`Deleted ${action.label} "${resource.name}" (${resource.id}).`);
    } catch (reason) {
      let message = reason instanceof Error ? reason.message : `Unable to delete ${action.label}.`;
      if (reason instanceof ApiRequestError && (reason.status === 409 || reason.status === 404)) {
        try {
          setData(await loadBootstrap());
        } catch {
          message += " Unable to refresh resources. Reload the page to see current references.";
        }
      }
      setError(message);
    } finally {
      deletionInProgressRef.current = false;
      setDeleting(null);
    }
  }

  const resources = [
    { label: "Templates", count: data.processFlowTemplates.length, icon: Workflow },
    { label: "Instances", count: data.processFlowInstances.length, icon: GitBranch },
    { label: "Geometries", count: data.geometries.length, icon: Box },
    { label: "Process steps", count: data.processStepTemplates.length, icon: Braces },
  ];

  async function handleDatabaseReset() {
    if (resourceBusy || deletionInProgressRef.current) return;
    setFixtureMenuOpen(false);
    if (!window.confirm("Reset the database and restore the default POC data?")) return;
    setResetting(true);
    setSuccess(null);
    try {
      setData(await resetPocData());
      setEditingTemplate(null);
      setEditingStep(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset the database.");
      setFixtureMenuOpen(true);
    } finally {
      setResetting(false);
    }
  }

  async function handleFixtureExport() {
    if (resourceBusy || deletionInProgressRef.current) return;
    setFixtureMenuOpen(false);
    setExporting(true);
    try {
      await exportFixtureArchive();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to export fixture snapshot.");
      setFixtureMenuOpen(true);
    } finally {
      setExporting(false);
    }
  }

  async function handleZipReset(file: File) {
    if (resourceBusy || deletionInProgressRef.current) return;
    if (!window.confirm(`Reset the database using ${file.name}? Current data will be replaced.`)) return;
    setImporting(true);
    setSuccess(null);
    try {
      setData(await resetPocDataFromZip(file));
      setEditingTemplate(null);
      setEditingStep(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reset from fixture ZIP.");
      setFixtureMenuOpen(true);
    } finally {
      setImporting(false);
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
              Review process resources and manage template defaults and process step settings.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/"><ArrowLeft />Home</Link>
          </Button>
        </header>

        {error ? (
          <div role="alert" className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {success ? (
          <div role="status" className="mt-5 rounded-md border bg-muted/30 px-4 py-3 text-sm">
            {success}
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
          </div>

          <TabsContent value="templates">
            <ResourceTable headings={["Template", "Version", "Owner", "Status", "Instances", "Actions"]}>
              {data.processFlowTemplates.map((template) => (
                <tr key={template.id} className="border-b last:border-b-0">
                  <IdentityCell name={template.name} id={template.id} description={template.description} />
                  <Cell>{template.version}</Cell>
                  <Cell>{template.owner}</Cell>
                  <Cell><Badge variant="outline">{template.status === "disabled" ? "Disabled" : "Enabled"}</Badge></Cell>
                  <Cell>{instanceCountByTemplate.get(template.id) ?? 0}</Cell>
                  <td className="px-4 py-3 align-top">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={resourceBusy}
                        onClick={() => setEditingTemplate(template)}
                      >
                        Edit
                      </Button>
                      <DeleteButton
                        name={template.name}
                        disabled={resourceBusy || (instanceCountByTemplate.get(template.id) ?? 0) > 0}
                        deleting={deleting?.collection === "processFlowTemplates" && deleting.id === template.id}
                        onClick={() => void handleDelete("processFlowTemplates", template)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </ResourceTable>
          </TabsContent>

          <TabsContent value="instances">
            <ResourceTable headings={["Instance", "Template", "Version", "Owner", "Actions"]}>
              {data.processFlowInstances.map((instance) => (
                <tr key={instance.id} className="border-b last:border-b-0">
                  <IdentityCell name={instance.name} id={instance.id} description={instance.description} />
                  <Cell>{templateById.get(instance.processFlowTemplateId)?.name ?? instance.processFlowTemplateId}</Cell>
                  <Cell>{instance.version}</Cell>
                  <Cell>{instance.owner}</Cell>
                  <td className="px-4 py-3 align-top">
                    <div className="flex justify-end">
                      <DeleteButton
                        name={instance.name}
                        disabled={resourceBusy}
                        deleting={deleting?.collection === "processFlowInstances" && deleting.id === instance.id}
                        onClick={() => void handleDelete("processFlowInstances", instance)}
                      />
                    </div>
                  </td>
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
            <ResourceTable headings={["Process step", "Category", "Version", "Owner", "Status", "Program", "Actions"]}>
              {data.processStepTemplates.map((step) => (
                <tr key={step.id} className="border-b last:border-b-0">
                  <IdentityCell name={step.name} id={step.id} description={step.description} />
                  <Cell>{step.category}</Cell>
                  <Cell>{step.version}</Cell>
                  <Cell>{step.owner}</Cell>
                  <Cell><Badge variant="outline">{step.status === "disabled" ? "Disabled" : "Enabled"}</Badge></Cell>
                  <Cell><span className="font-mono text-xs">{step.program}</span></Cell>
                  <td className="px-4 py-3 text-right align-top">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={resourceBusy}
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
      <div ref={fixtureMenuRef} className="fixed bottom-5 right-5 z-50">
        <input
          ref={fixtureFileRef}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          tabIndex={-1}
          aria-label="Select fixture ZIP"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void handleZipReset(file);
          }}
        />
        {fixtureMenuOpen ? (
          <div id="fixture-actions" className="mb-2 w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
            <p className="px-3 py-2 text-xs font-medium text-muted-foreground">Fixture actions</p>
            {error ? (
              <p role="alert" className="mx-2 mb-2 max-h-28 overflow-auto rounded bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              disabled={resourceBusy}
              onClick={() => void handleFixtureExport()}
            >
              <Download className="h-4 w-4" />Export fixture
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              disabled={resourceBusy}
              onClick={() => {
                setFixtureMenuOpen(false);
                fixtureFileRef.current?.click();
              }}
            >
              <Upload className="h-4 w-4" />Reset from ZIP
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              disabled={resourceBusy}
              onClick={() => void handleDatabaseReset()}
            >
              <RotateCcw className="h-4 w-4" />Reset
            </button>
          </div>
        ) : null}
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          className="ml-auto flex rounded-full bg-background shadow-md"
          disabled={resourceBusy}
          aria-label={
            importing ? "Resetting from fixture ZIP"
              : resetting ? "Resetting database"
                : exporting ? "Exporting fixture" : "Fixture actions"
          }
          aria-expanded={fixtureMenuOpen}
          aria-controls="fixture-actions"
          title="Fixture actions"
          onClick={() => setFixtureMenuOpen((open) => !open)}
        >
          <Database className={fixtureBusy ? "animate-pulse" : undefined} />
        </Button>
      </div>
      {editingTemplate ? (
        <ProcessFlowTemplateEditDialog
          key={editingTemplate.id}
          template={editingTemplate}
          stepTemplates={data.processStepTemplates}
          onClose={() => setEditingTemplate(null)}
          onSaved={(saved) => {
            setData((current) => ({
              ...current,
              processFlowTemplates: current.processFlowTemplates.map((template) =>
                template.id === saved.id ? saved : template,
              ),
            }));
            setEditingTemplate(null);
          }}
        />
      ) : null}
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

function DeleteButton({ name, disabled, deleting, onClick }: {
  name: string;
  disabled: boolean;
  deleting: boolean;
  onClick: () => void;
}) {
  return (
    <div className="max-w-xs text-right">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={disabled}
        aria-label={`Delete ${name}`}
        onClick={onClick}
      >
        {deleting ? "Deleting…" : "Delete"}
      </Button>
    </div>
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
  return <td className="px-4 py-3 align-top text-sm text-muted-foreground">{children === 0 ? 0 : children || "—"}</td>;
}
