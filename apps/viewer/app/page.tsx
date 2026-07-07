"use client";

import * as React from "react";
import Link from "next/link";
import {
  Filter,
  GitBranch,
  ListChecks,
  RotateCcw,
  Table2,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ProcessFlowInstance,
  ProcessFlowTemplate,
  ProcessStepTemplate,
} from "@/lib/process-flow/types";
import { loadBootstrap, resetPocData } from "@/lib/process-flow-api";

const ALL_TEMPLATE_TYPES = "__all_template_types__";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

type HomeData = {
  flowTemplates: ProcessFlowTemplate[];
  flowInstances: ProcessFlowInstance[];
  stepTemplates: ProcessStepTemplate[];
};

type FlowInstanceRow = {
  key: string;
  templateType: string;
  templateId: string;
  templateVersion: string | null;
  flowInstanceName: string;
  flowInstanceId: string;
  populatedFieldCount: number;
  expectedFieldCount: number;
  referenceStatus: "resolved" | "missing-template" | "missing-step-template";
};

const emptyHomeData: HomeData = {
  flowTemplates: [],
  flowInstances: [],
  stepTemplates: [],
};

export default function Home() {
  const [homeData, setHomeData] = React.useState<HomeData>(emptyHomeData);
  const [selectedTemplateType, setSelectedTemplateType] =
    React.useState(ALL_TEMPLATE_TYPES);
  const [hydrated, setHydrated] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    loadBootstrap()
      .then((payload) => {
        if (!active) return;
        setHomeData({
          flowTemplates: payload.processFlowTemplates as ProcessFlowTemplate[],
          flowInstances: payload.processFlowInstances as ProcessFlowInstance[],
          stepTemplates: payload.processStepTemplates as ProcessStepTemplate[],
        });
        setLoadError(null);
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load API data.");
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const flowRows = React.useMemo(() => buildFlowInstanceRows(homeData), [homeData]);

  const templateTypeOptions = React.useMemo(
    () =>
      Array.from(new Set(flowRows.map((row) => row.templateType))).sort((left, right) =>
        left.localeCompare(right),
      ),
    [flowRows],
  );

  React.useEffect(() => {
    if (
      selectedTemplateType !== ALL_TEMPLATE_TYPES &&
      !templateTypeOptions.includes(selectedTemplateType)
    ) {
      setSelectedTemplateType(ALL_TEMPLATE_TYPES);
    }
  }, [selectedTemplateType, templateTypeOptions]);

  const filteredFlowRows = React.useMemo(
    () =>
      selectedTemplateType === ALL_TEMPLATE_TYPES
        ? flowRows
        : flowRows.filter((row) => row.templateType === selectedTemplateType),
    [selectedTemplateType, flowRows],
  );

  const templateCount = new Set(
    homeData.flowInstances.map((instance) => instance.processFlowTemplateId),
  ).size;

  async function handlePocReset() {
    const payload = await resetPocData();
    setHomeData({
      flowTemplates: payload.processFlowTemplates as ProcessFlowTemplate[],
      flowInstances: payload.processFlowInstances as ProcessFlowInstance[],
      stepTemplates: payload.processStepTemplates as ProcessStepTemplate[],
    });
    setSelectedTemplateType(ALL_TEMPLATE_TYPES);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-5 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Table2 className="h-5 w-5 shrink-0 text-primary" />
              <h1 className="truncate text-xl font-semibold tracking-normal">
                Flow Instances
              </h1>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">
                {homeData.flowInstances.length} flow instances
              </Badge>
              <Badge variant="outline">{templateCount} template types</Badge>
            </div>
          </div>

          <nav aria-label="Process flow tools" className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/flow-template-editor" prefetch={false}>
                <Workflow />
                Flow Template
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/flow-instance-editor">
                <GitBranch />
                Flow Instance
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/admin/processstepeditor">
                <ListChecks />
                Process Step
              </Link>
            </Button>
          </nav>
        </header>

        <section className="overflow-hidden rounded-md border bg-white shadow-sm">
          {loadError ? (
            <div className="border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {loadError}
            </div>
          ) : null}
          <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-white px-4 py-3">
            <label className="grid min-w-[240px] flex-1 max-w-md gap-1 text-sm font-medium">
              <span className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                Template type
              </span>
              <select
                className={selectClass}
                value={selectedTemplateType}
                disabled={!hydrated || templateTypeOptions.length === 0}
                onChange={(event) => setSelectedTemplateType(event.target.value)}
              >
                <option value={ALL_TEMPLATE_TYPES}>All template types</option>
                {templateTypeOptions.map((templateType) => (
                  <option key={templateType} value={templateType}>
                    {templateType}
                  </option>
                ))}
              </select>
            </label>

            <div className="text-sm text-muted-foreground">
              {filteredFlowRows.length} shown
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="w-[28%] px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                    Template type
                  </th>
                  <th className="w-[42%] px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                    Flow instance
                  </th>
                  <th className="w-[15%] px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                    Values
                  </th>
                  <th className="w-[15%] px-4 py-3 text-left text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredFlowRows.length > 0 ? (
                  filteredFlowRows.map((row) => (
                    <tr key={row.key} className="border-b last:border-b-0">
                      <td className="px-4 py-3 align-top">
                        <div className="min-w-0">
                          <div className="truncate font-medium" title={row.templateType}>
                            {row.templateType}
                          </div>
                          <div
                            className="mt-1 truncate text-xs text-muted-foreground"
                            title={row.templateId}
                          >
                            {row.templateVersion
                              ? `version ${row.templateVersion}`
                              : row.templateId}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="min-w-0">
                          <div
                            className="truncate font-medium"
                            title={row.flowInstanceName}
                          >
                            {row.flowInstanceName}
                          </div>
                          <div
                            className="mt-1 truncate font-mono text-xs text-muted-foreground"
                            title={row.flowInstanceId}
                          >
                            {row.flowInstanceId}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="font-mono text-xs">
                          {row.populatedFieldCount}/{row.expectedFieldCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Badge
                          variant={
                            row.referenceStatus === "resolved" ? "signal" : "outline"
                          }
                        >
                          {statusLabel(row.referenceStatus)}
                        </Badge>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="h-52 px-4 py-8 text-center">
                      <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                        <div className="text-sm font-medium">
                          No flow instances
                        </div>
                        <Button asChild size="sm">
                          <Link href="/flow-instance-editor">
                            <GitBranch />
                            Create instance
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <button
        type="button"
        aria-label="Reset POC Data"
        title="Reset API data and restore default JSON"
        className="fixed bottom-3 left-3 inline-flex h-7 items-center gap-1 rounded border border-foreground/20 bg-background/70 px-2 font-mono text-[11px] text-muted-foreground shadow-none backdrop-blur-sm transition hover:border-foreground/35 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={handlePocReset}
      >
        <RotateCcw className="h-3 w-3" />
        cmd: reset-poc-data
      </button>
    </main>
  );
}

function buildFlowInstanceRows(data: HomeData): FlowInstanceRow[] {
  const flowTemplateById = new Map(
    data.flowTemplates.map((template) => [template.id, template]),
  );
  const stepTemplateById = new Map(
    data.stepTemplates.map((template) => [template.id, template]),
  );

  return data.flowInstances.map((instance) => {
    const flowTemplate = flowTemplateById.get(instance.processFlowTemplateId);
    const templateType = flowTemplate?.name ?? "Unknown template";
    const templateId = flowTemplate?.id ?? instance.processFlowTemplateId;
    let populatedFieldCount = 0;
    let expectedFieldCount = 0;
    let hasMissingStepTemplate = false;

    for (const stepValueSet of instance.stepValueSets) {
      const stepRef = flowTemplate?.stepRefs.find(
        (candidate) => candidate.stepRefId === stepValueSet.stepRefId,
      );
      const processStepTemplateId =
        stepValueSet.processStepTemplateId || stepRef?.processStepTemplateId || "";
      const stepTemplate = stepTemplateById.get(processStepTemplateId);
      if (flowTemplate && !stepTemplate) {
        hasMissingStepTemplate = true;
      }
      expectedFieldCount +=
        stepTemplate?.fieldDefinitions.length ?? stepValueSet.fieldValues.length;
      populatedFieldCount += stepValueSet.fieldValues.filter((fieldValue) =>
        isMeaningfulValue(fieldValue.value),
      ).length;
    }

    const referenceStatus: FlowInstanceRow["referenceStatus"] = !flowTemplate
      ? "missing-template"
      : hasMissingStepTemplate
        ? "missing-step-template"
        : "resolved";

    return {
      key: instance.id,
      templateType,
      templateId,
      templateVersion: flowTemplate?.version ?? null,
      flowInstanceName: instance.name,
      flowInstanceId: instance.id,
      populatedFieldCount,
      expectedFieldCount,
      referenceStatus,
    };
  });
}

function isMeaningfulValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    const candidate = value as { items?: unknown[] };
    if (Array.isArray(candidate.items)) {
      return candidate.items.length > 0;
    }
    return Object.keys(value).length > 0;
  }
  return false;
}

function statusLabel(status: FlowInstanceRow["referenceStatus"]) {
  if (status === "missing-template") {
    return "Missing template";
  }
  if (status === "missing-step-template") {
    return "Missing step";
  }
  return "Resolved";
}
