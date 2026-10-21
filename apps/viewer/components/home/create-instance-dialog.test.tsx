import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateInstanceDialog } from "./create-instance-dialog";
import { createProcessFlowInstance } from "@/lib/process-flow-api";
import { buildProcessFlowInstanceCreate, configurationFromInstance, newInstanceIdentity } from "@/lib/process-flow/instance-editor";
import type { ProcessFlowTemplate, ProcessStepTemplate } from "@/lib/process-flow/types";

// Exercise form handlers without adding a DOM dependency, as in the viewer's action tests.
let hooks: { cursor: number; slots: unknown[] } | null = null;
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof React>();
  return { ...original,
    useId: () => hooks ? "create-test" : original.useId(),
    useEffect: (...args: Parameters<typeof React.useEffect>) => { if (!hooks) original.useEffect(...args); },
    useState: (initial: unknown) => {
      if (!hooks) return original.useState(initial);
      const current = hooks, index = current.cursor++;
      if (!(index in current.slots)) current.slots[index] = typeof initial === "function" ? initial() : initial;
      return [current.slots[index], (next: unknown) => {
        current.slots[index] = typeof next === "function" ? next(current.slots[index]) : next;
      }];
    },
    useRef: (initial: unknown) => {
      if (!hooks) return original.useRef(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
      return hooks.slots[index];
    },
  };
});
vi.mock("@/lib/process-flow-api", () => ({ createProcessFlowInstance: vi.fn() }));
afterEach(() => { hooks = null; vi.resetAllMocks(); });

function elements(node: React.ReactNode): React.ReactElement[] {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}

function formHarness() {
  hooks = { cursor: 0, slots: [] };
  const onCreated = vi.fn(), onClose = vi.fn();
  const render = () => {
    hooks!.cursor = 0;
    return CreateInstanceDialog({ templates: [template], stepTemplates, returnFocus: React.createRef(), onCreated, onClose });
  };
  for (const [name, value] of [["templateId", template.id], ["name", "Trial"], ["owner", "QA"]]) {
    elements(render().props.children).find((element) => element.props.name === name)!.props.onChange({ target: { value } });
  }
  const submit = (value?: string) => elements(render().props.children).find((element) => element.type === "form")!.props.onSubmit({
    preventDefault: vi.fn(), currentTarget: { querySelectorAll: () => [] },
    nativeEvent: { submitter: value ? { value } : null },
  });
  return { render, submit, onCreated, onClose };
}

const template: ProcessFlowTemplate = {
  schemaVersion: 2, id: "flow", name: "Test flow", version: "V1", status: "enabled",
  flowInputs: [], flowEdges: [], stepRefs: [
    { stepRefId: "mold", processStepTemplateId: "molding", parameterDefaults: { thickness: 180 } },
    { stepRefId: "place", processStepTemplateId: "pnp" },
    { stepRefId: "empty", processStepTemplateId: "empty" },
  ],
};
const stepTemplates: ProcessStepTemplate[] = [
  { schemaVersion: 2, id: "molding", status: "enabled", name: "Molding", version: "V1", category: "", program: "molding/molding", description: "", owner: "",
    inputPorts: [], outputPorts: [], parameterDefinitions: [
      { id: "thickness", name: "Thickness", valueType: "float", defaultValue: 1 },
      { id: "material", name: "Material", valueType: "string", required: true },
    ] },
  { schemaVersion: 2, id: "pnp", status: "enabled", name: "PnP", version: "V1", category: "", program: "pnp/pnp", description: "", owner: "",
    inputPorts: [], outputPorts: [], parameterDefinitions: [
      { id: "offset", name: "Offset", valueType: "float", defaultValue: 2 },
      { id: "placements", name: "Placements", valueType: "placements" },
    ] },
];

describe("Create Instance from Home", () => {
  it("offers enabled templates without preselection and requires the existing identity fields", () => {
    const html = renderToStaticMarkup(<CreateInstanceDialog templates={[template, { ...template, id: "off", name: "Hidden flow", status: "disabled" }]}
      stepTemplates={stepTemplates} returnFocus={React.createRef()} onClose={() => {}} onCreated={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('<option value="" selected="">Choose a template</option>');
    expect(html).toContain("Test flow · V1");
    expect(html).not.toContain("Hidden flow");
    expect(html).toMatch(/name="templateId" required=""/);
    for (const name of ["name", "version", "owner"]) expect(html).toContain(`name="${name}" required=""`);
    expect(html).toContain('value="V0.0.0"');
    expect(html).toContain('<textarea');
    expect(html).not.toContain("Initial configuration");
    expect(html).not.toContain("Start from");
    const footer = html.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)![1];
    expect(footer).toContain('type="button"');
    expect(footer).toContain('>Cancel</button>');
    expect(footer).toMatch(/type="submit"[^>]*name="action" value="create"[^>]*>Create<\/button>/);
    expect(footer).toMatch(/type="submit"[^>]*name="action" value="edit"[^>]*>Create &amp; Edit<\/button>/);
    expect(footer.indexOf('value="create"')).toBeLessThan(footer.indexOf('value="edit"'));
  });

  it("disables both creation actions when no enabled templates are available", () => {
    const html = renderToStaticMarkup(<CreateInstanceDialog templates={[{ ...template, status: "disabled" }]}
      stepTemplates={stepTemplates} returnFocus={React.createRef()} onClose={() => {}} onCreated={() => {}} />);
    expect(html).toMatch(/value="create" disabled=""/);
    expect(html).toMatch(/value="edit"[^>]*disabled=""/);
    const cancel = html.match(/<button[^>]*>Cancel<\/button>/)![0];
    expect(cancel).not.toContain('disabled=""');
  });

  it.each([["create", false], ["edit", true], [undefined, false]] as const)(
    "creates with template defaults and forwards the selected action (%s)", async (action, editAfterCreate) => {
      const instance = { id: "server /?# instance" } as Awaited<ReturnType<typeof createProcessFlowInstance>>;
      vi.mocked(createProcessFlowInstance).mockResolvedValue(instance);
      const form = formHarness();
      form.submit(action);
      await vi.waitFor(() => expect(form.onCreated).toHaveBeenCalledWith(instance, editAfterCreate));
      expect(createProcessFlowInstance).toHaveBeenCalledExactlyOnceWith(buildProcessFlowInstanceCreate(
        template.id, { ...newInstanceIdentity(), name: "Trial", owner: "QA" }, configurationFromInstance(template, stepTemplates),
      ));
    },
  );

  it("blocks both actions during submission and allows a different action after failure", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(createProcessFlowInstance).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const form = formHarness();
    form.submit("create");
    form.submit("edit");
    expect(createProcessFlowInstance).toHaveBeenCalledTimes(1);
    const pending = form.render();
    expect(pending.props.busy).toBe(true);
    expect(elements(pending.props.footer).filter((element) => element.props.type).every((button) => button.props.disabled)).toBe(true);
    reject(new Error("Service unavailable"));
    await vi.waitFor(() => expect(form.render().props.busy).toBe(false));
    expect(form.onCreated).not.toHaveBeenCalled();
    expect(elements(form.render().props.children).find((element) => element.props.role === "alert")!.props.children).toBe("Service unavailable");
    const instance = { id: "retry" } as Awaited<ReturnType<typeof createProcessFlowInstance>>;
    vi.mocked(createProcessFlowInstance).mockResolvedValueOnce(instance);
    form.submit("edit");
    await vi.waitFor(() => expect(form.onCreated).toHaveBeenCalledWith(instance, true));
    expect(createProcessFlowInstance).toHaveBeenCalledTimes(2);
  });

  it("submits defaults for every station without copying an instance or generating server IDs", () => {
    const configuration = configurationFromInstance(template, stepTemplates);
    const payload = buildProcessFlowInstanceCreate(template.id, { ...newInstanceIdentity(), name: " Trial ", owner: " QA " }, configuration);
    expect(payload).toMatchObject({ name: "Trial", owner: "QA", version: "V0.0.0", processFlowTemplateId: "flow" });
    expect(payload.initialConfiguration).toEqual({
      inputBindings: {}, embeddedGeometries: {}, stepConfigurations: {
        mold: { parameterValues: { thickness: 180 } },
        place: { parameterValues: { offset: 2, placements: [] } },
        empty: { parameterValues: {} },
      },
    });
    expect(payload).not.toHaveProperty("id");
    expect(payload.initialConfiguration!.stepConfigurations.mold).not.toHaveProperty("recipes");
    expect(payload.initialConfiguration!.stepConfigurations.mold.parameterValues).not.toHaveProperty("material");
    configuration.stepConfigurations.mold.parameterValues.thickness = 5;
    expect(payload.initialConfiguration!.stepConfigurations.mold.parameterValues.thickness).toBe(180);
    expect(template.stepRefs[0].parameterDefaults!.thickness).toBe(180);
  });
});
