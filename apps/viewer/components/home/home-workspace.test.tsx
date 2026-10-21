import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GeometryGeneratorDefinition } from "@/components/geometry-generator/geometry-generator-contracts";
import type { ProcessFlowInstance, ProcessFlowTemplate } from "@/lib/process-flow/types";
import { HomeWorkspace, type HomeData } from "./home-workspace";

// These tests cover Home navigation, not the generator dialog's client-only tree.
vi.mock("@/components/geometry-generator/geometry-generator-registry", () => ({
  GeometryGeneratorIcon: () => <svg aria-hidden="true" />,
}));

function template(overrides: Partial<ProcessFlowTemplate> = {}): ProcessFlowTemplate {
  return {
    schemaVersion: 2, id: "template /?#中文", status: "enabled", name: "Packaging flow",
    version: "V1", owner: "engineer", flowInputs: [], stepRefs: [], flowEdges: [], ...overrides,
  };
}

function instance(overrides: Partial<ProcessFlowInstance> = {}): ProcessFlowInstance {
  return {
    schemaVersion: 2, id: "instance /?#中文", name: "Alpha build", version: "V2", owner: "researcher",
    description: "", revision: 3, processFlowTemplateId: template().id,
    inputBindings: {}, stepConfigurations: {}, ...overrides,
  };
}

function generator(overrides: Partial<GeometryGeneratorDefinition> = {}): GeometryGeneratorDefinition {
  return {
    schemaVersion: 2, id: "custom /?#", version: 1, label: "Custom generator", description: "",
    entityType: "die", uiPlacements: ["home"], adaptationContract: { adapterId: "test", adapterVersion: 1 },
    defaultParameters: {}, parameterDefinitions: [], parameterGroups: [], previewViews: [], ...overrides,
  };
}

const data: HomeData = {
  processFlowTemplates: [template()], processFlowInstances: [instance()], processStepTemplates: [], geometryGenerators: [],
};
const empty: HomeData = { processFlowTemplates: [], processFlowInstances: [], processStepTemplates: [], geometryGenerators: [] };

function render(options: Partial<React.ComponentProps<typeof HomeWorkspace>> = {}) {
  return renderToStaticMarkup(<HomeWorkspace data={data} loading={false} loadError={null} onRetry={() => {}} onCreated={() => {}} {...options} />);
}

function sections(html: string) {
  return [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)].map((match) => match[0]);
}

function resources(html: string) { return sections(html).at(-1)!; }
function instanceLinks(html: string) { return links(html).filter((link) => link[1].startsWith("/flow-instance-editor?instanceId=")); }

function links(html: string) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
}

describe("Home workspace", () => {
  it("groups instances under template headers with one named row link", () => {
    const html = render();
    expect(html).toContain("Create Instance");
    expect(html.indexOf("Create Template")).toBeLessThan(html.indexOf("Create Instance"));
    expect(links(html).filter((link) => link[1] === "/flow-template-editor")).toHaveLength(1);
    expect(resources(html)).not.toContain("Create Template");
    expect(html).not.toContain("Start a new flow");
    expect(html).not.toContain("Continue a flow");
    expect(html).not.toContain("How it works");
    expect(html).not.toContain("?templateId=");
    expect(html.indexOf("Packaging flow")).toBeLessThan(html.indexOf("Alpha build"));
    expect(html.indexOf("Alpha build")).toBeLessThan(html.indexOf("Build reusable resources"));
    const rows = instanceLinks(html);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe(`/flow-instance-editor?instanceId=${encodeURIComponent(instance().id)}`);
    expect(rows[0][2]).toContain("Open instance");
    expect(rows[0][2]).toContain("Owner: researcher");
    expect(rows[0][2]).toContain("Revision 3");
    expect(html).toContain('aria-label="1 instance"');
    for (const link of links(html)) expect(link[2]).not.toContain("<button");
  });

  it("shows every template, including disabled and empty groups", () => {
    const html = render({ data: { ...data, processFlowTemplates: [template({ status: "disabled" }), template({ id: "empty", name: "Empty flow" })] } });
    const groups = sections(html);
    expect(groups[0]).toContain("Packaging flow");
    expect(groups[0]).toContain("Disabled");
    expect(instanceLinks(groups[0])).toHaveLength(1);
    expect(groups[1]).toContain("Empty flow");
    expect(groups[1]).toContain("No instances yet");
    expect(groups[1]).toContain('aria-label="0 instances"');
    const disabled = render({ data: { ...data, processFlowTemplates: [template({ status: "disabled" })] } });
    expect(disabled).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Create Instance<\/button>/);
    expect(disabled).toContain("No templates available for new instances");
    expect(disabled).toContain('aria-describedby="create-unavailable"');
    expect(instanceLinks(disabled)).toHaveLength(1);
  });

  it("preserves API order within and across groups and collects every orphan in the last group", () => {
    const html = render({ data: { ...data,
      processFlowTemplates: [template({ id: "z", name: "Z flow" }), template({ id: "a", name: "A flow" })],
      processFlowInstances: [instance({ id: "a1", processFlowTemplateId: "a" }),
        instance({ id: "z2", name: "Z build", processFlowTemplateId: "z" }),
        instance({ id: "o1", processFlowTemplateId: "missing1" }),
        instance({ id: "z1", name: "A build", processFlowTemplateId: "z" }),
        instance({ id: "o2", processFlowTemplateId: "missing2" })],
    } });
    const groups = sections(html);
    expect(groups[0]).toContain("Z flow");
    expect(groups[1]).toContain("A flow");
    expect(groups[2]).toContain("Unavailable template");
    expect(instanceLinks(html).map((link) => link[1].split("=")[1])).toEqual(["z2", "z1", "a1", "o1", "o2"]);
    const orphanOnly = render({ data: { ...empty, processFlowInstances: [instance()] } });
    expect(orphanOnly).toContain("Unavailable template");
    expect(orphanOnly).not.toContain("No templates or instances yet");
  });

  it("keeps all records and wraps long identities with a missing owner fallback", () => {
    const longName = "VeryLongName".repeat(50);
    const templates = Array.from({ length: 30 }, (_, index) => template({ id: `template-${index}`, name: index === 0 ? longName : `Template ${index}` }));
    const instances = Array.from({ length: 40 }, (_, index) => instance({ id: `instance-${index}`, name: index === 0 ? longName : `Instance ${index}`, processFlowTemplateId: "template-0", owner: "" }));
    const html = render({ data: { ...data, processFlowTemplates: templates, processFlowInstances: instances } });
    expect(sections(html)).toHaveLength(31);
    expect(instanceLinks(html)).toHaveLength(40);
    expect(html).toContain(longName);
    expect(html.indexOf("Template 2<")).toBeLessThan(html.indexOf("Template 10<"));
    expect(html).toContain("Owner: Unassigned");
    expect(html).toContain("[overflow-wrap:anywhere]");
  });

  it("distinguishes initial loading, load failure and a successful empty response", () => {
    const loading = render({ data: null, loading: true });
    expect(loading).toContain("Loading templates and instances");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("motion-safe:animate-pulse");
    expect(loading).not.toContain("No templates");
    expect(loading).not.toContain("No instances yet");
    const failure = render({ data: null, loadError: "Service unavailable" });
    expect(failure).toContain('role="alert"');
    expect(failure).toContain("Service unavailable");
    expect(failure).toContain("Templates and instances could not be loaded");
    expect(failure).toContain(">Retry</button>");
    expect(failure).not.toContain("No templates");
    const success = render({ data: empty });
    expect(success).toContain("No templates or instances yet");
    expect(success).toContain("No templates available for new instances");
    expect(success).not.toContain("could not be loaded");
    for (const html of [loading, failure, success]) {
      expect(html).toContain('href="/flow-template-editor"');
      expect(resources(html)).toContain('href="/geometry-editor"');
      expect(html).toContain('href="/management"');
    }
  });

  it("retains groups and tools during refresh failures and prevents duplicate retry", () => {
    for (const loading of [false, true]) {
      const html = render({ data: { ...data, geometryGenerators: [generator()] }, loading, loadError: "Refresh failed" });
      expect(html).toContain("Alpha build");
      expect(html).toContain("Packaging flow");
      expect(html).toContain('aria-label="1 instance"');
      expect(html).toContain("Create Custom");
      expect(html).not.toContain("Loading templates and instances");
      expect(html).toContain("Showing previously loaded content.");
      if (loading) expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Retrying…<\/button>/);
      else expect(html).toContain(">Retry</button>");
    }
  });

  it("preserves the existing home resource placement, tool ordering and encoded generator IDs", () => {
    const html = resources(render({ data: { ...data, geometryGenerators: [generator(),
      generator({ id: "hidden", label: "Hidden generator", uiPlacements: ["management"] }),
      generator({ id: "dram", label: "DRAM generator" }),
    ] } }));
    expect(links(html).map((link) => link[1])).toEqual([
      `/geometry-generator?generatorId=${encodeURIComponent(generator().id)}`,
      "/geometry-generator?generatorId=dram", "/geometry-editor",
    ]);
    expect(html).toContain("Create Custom");
    expect(html).toContain("Create DRAM");
    expect(html).not.toContain("Hidden");
    expect(html).not.toContain("<button");
  });
});
