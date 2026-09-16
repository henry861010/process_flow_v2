import { describe, expect, it } from "vitest";

import { computeTemplateLayout } from "./template-layout";
import type {
  GeometryInputPort,
  ProcessFlowTemplate,
  ProcessStepTemplate,
  SavedFlowEdge,
} from "./types";

const primaryPort = geometryPort("main_geometry", "primary");

describe("computeTemplateLayout", () => {
  it("keeps a linear primary geometry flow on one row", () => {
    const steps = [stepTemplate("linear", [primaryPort])];
    const layout = computeTemplateLayout(
      flowTemplate(
        ["main"],
        [
          ["first", "linear"],
          ["last", "linear"],
        ],
        [
          inputEdge("main-first", "main", "first", "main_geometry"),
          stepEdge("first-last", "first", "last", "main_geometry"),
        ],
      ),
      steps,
    );

    expect(layout.flowInputPositions.get("main")).toEqual({ x: 40, y: 70 });
    expect(layout.stepPositions.get("first")).toEqual({ x: 370, y: 70 });
    expect(layout.stepPositions.get("last")).toEqual({ x: 700, y: 70 });
  });

  it("uses port roles rather than step identity or metadata", () => {
    const ports = [
      primaryPort,
      geometryPort("component_geometry", "auxiliary"),
    ];
    const firstTemplate = stepTemplate("arbitrary-alpha", ports, {
      name: "First name",
      category: "first.category",
      program: "first/program",
    });
    const firstFlow = flowTemplate(
      ["base", "component"],
      [["merge", firstTemplate.id]],
      [
        inputEdge("base-merge", "base", "merge", "main_geometry"),
        inputEdge(
          "component-merge",
          "component",
          "merge",
          "component_geometry",
        ),
      ],
    );

    const secondTemplate = stepTemplate("unrelated-beta", ports, {
      name: "Completely different",
      category: "unrelated.category",
      program: "unrelated/program",
    });
    const secondFlow = structuredClone(firstFlow);
    secondFlow.stepRefs[0].processStepTemplateId = secondTemplate.id;

    const firstLayout = computeTemplateLayout(firstFlow, [firstTemplate]);
    const secondLayout = computeTemplateLayout(secondFlow, [secondTemplate]);

    expect(serializedLayout(secondLayout)).toEqual(serializedLayout(firstLayout));
    expect(firstLayout.flowInputPositions.get("base")?.y).toBe(
      firstLayout.stepPositions.get("merge")?.y,
    );
    expect(firstLayout.flowInputPositions.get("component")?.y).toBeGreaterThan(
      firstLayout.stepPositions.get("merge")?.y ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("keeps branches farther from the terminal closer to the main row", () => {
    const multiInput = stepTemplate("multi-input", [
      primaryPort,
      geometryPort("part_geometry", "auxiliary"),
    ]);
    const layout = computeTemplateLayout(
      flowTemplate(
        ["main", "early-part", "late-part"],
        [
          ["early-merge", multiInput.id],
          ["late-merge", multiInput.id],
        ],
        [
          inputEdge("main-early", "main", "early-merge", "main_geometry"),
          inputEdge(
            "early-part-merge",
            "early-part",
            "early-merge",
            "part_geometry",
          ),
          stepEdge(
            "early-late",
            "early-merge",
            "late-merge",
            "main_geometry",
          ),
          inputEdge(
            "late-part-merge",
            "late-part",
            "late-merge",
            "part_geometry",
          ),
        ],
      ),
      [multiInput],
    );

    const mainY = layout.flowInputPositions.get("main")?.y;
    expect(layout.stepPositions.get("early-merge")?.y).toBe(mainY);
    expect(layout.stepPositions.get("late-merge")?.y).toBe(mainY);
    expect(layout.flowInputPositions.get("early-part")?.y).toBe(260);
    expect(layout.flowInputPositions.get("late-part")?.y).toBe(450);
    expect(
      new Set(
        [...layout.flowInputPositions.values()].map((position) => position.y),
      ).size,
    ).toBe(3);
  });

  it("keeps an auxiliary upstream chain together and nests its auxiliary input", () => {
    const multiInput = stepTemplate("recursive-multi-input", [
      primaryPort,
      geometryPort("part_geometry", "auxiliary"),
    ]);
    const layout = computeTemplateLayout(
      flowTemplate(
        ["base", "sub-base", "nested-part"],
        [
          ["inner", multiInput.id],
          ["outer", multiInput.id],
        ],
        [
          inputEdge("base-outer", "base", "outer", "main_geometry"),
          stepEdge("inner-outer", "inner", "outer", "part_geometry"),
          inputEdge("sub-inner", "sub-base", "inner", "main_geometry"),
          inputEdge(
            "nested-inner",
            "nested-part",
            "inner",
            "part_geometry",
          ),
        ],
      ),
      [multiInput],
    );

    expect(layout.flowInputPositions.get("base")?.y).toBe(70);
    expect(layout.stepPositions.get("outer")?.y).toBe(70);
    expect(layout.flowInputPositions.get("sub-base")?.y).toBe(260);
    expect(layout.stepPositions.get("inner")?.y).toBe(260);
    expect(layout.flowInputPositions.get("nested-part")?.y).toBe(450);
  });

  it("orders multiple auxiliary branches by input port declaration", () => {
    const multiAux = stepTemplate("many-inputs", [
      primaryPort,
      geometryPort("z_geometry", "auxiliary"),
      geometryPort("a_geometry", "auxiliary"),
    ]);
    const layout = computeTemplateLayout(
      flowTemplate(
        ["main", "z-part", "a-part"],
        [["merge", multiAux.id]],
        [
          inputEdge("a-edge", "a-part", "merge", "a_geometry"),
          inputEdge("main-edge", "main", "merge", "main_geometry"),
          inputEdge("z-edge", "z-part", "merge", "z_geometry"),
        ],
      ),
      [multiAux],
    );

    expect(layout.flowInputPositions.get("main")?.y).toBe(70);
    expect(layout.flowInputPositions.get("z-part")?.y).toBe(260);
    expect(layout.flowInputPositions.get("a-part")?.y).toBe(450);
  });

  it("places the longest disconnected flow on the first row", () => {
    const linear = stepTemplate("disconnected-linear", [primaryPort]);
    const layout = computeTemplateLayout(
      flowTemplate(
        ["short-input", "long-input"],
        [
          ["short-terminal", linear.id],
          ["long-first", linear.id],
          ["long-middle", linear.id],
          ["long-terminal", linear.id],
        ],
        [
          inputEdge(
            "short-input-edge",
            "short-input",
            "short-terminal",
            "main_geometry",
          ),
          inputEdge(
            "long-input-edge",
            "long-input",
            "long-first",
            "main_geometry",
          ),
          stepEdge(
            "long-first-middle",
            "long-first",
            "long-middle",
            "main_geometry",
          ),
          stepEdge(
            "long-middle-terminal",
            "long-middle",
            "long-terminal",
            "main_geometry",
          ),
        ],
      ),
      [linear],
    );

    expect(layout.flowInputPositions.get("long-input")?.y).toBe(70);
    expect(layout.stepPositions.get("long-terminal")?.y).toBe(70);
    expect(layout.flowInputPositions.get("short-input")?.y).toBe(260);
    expect(layout.stepPositions.get("short-terminal")?.y).toBe(260);
  });

  it("places unresolved and disconnected inputs on independent fallback rows", () => {
    const layout = computeTemplateLayout(
      flowTemplate(
        ["first", "second", "disconnected"],
        [["unknown-step", "missing-template"]],
        [
          inputEdge("first-edge", "first", "unknown-step", "unknown-one"),
          inputEdge("second-edge", "second", "unknown-step", "unknown-two"),
        ],
      ),
      [],
    );

    expect(layout.stepPositions.has("unknown-step")).toBe(true);
    expect(layout.flowInputPositions.size).toBe(3);
    expect(
      new Set(
        [...layout.flowInputPositions.values()].map((position) => position.y),
      ).size,
    ).toBe(3);
  });

  it("terminates and positions every node when an invalid draft contains a cycle", () => {
    const multiInput = stepTemplate("cycle-step", [
      primaryPort,
      geometryPort("part_geometry", "auxiliary"),
    ]);
    const layout = computeTemplateLayout(
      flowTemplate(
        ["part"],
        [
          ["first", multiInput.id],
          ["second", multiInput.id],
        ],
        [
          stepEdge("first-second", "first", "second", "main_geometry"),
          stepEdge("second-first", "second", "first", "main_geometry"),
          inputEdge("part-first", "part", "first", "part_geometry"),
        ],
      ),
      [multiInput],
    );

    expect([...layout.stepPositions.keys()].sort()).toEqual(["first", "second"]);
    expect([...layout.flowInputPositions.keys()]).toEqual(["part"]);
  });
});

function geometryPort(
  portId: string,
  role: GeometryInputPort["role"],
): GeometryInputPort {
  return {
    portId,
    name: portId,
    dataType: "geometry",
    role,
    required: true,
  };
}

function stepTemplate(
  id: string,
  inputPorts: GeometryInputPort[],
  metadata: Partial<Pick<ProcessStepTemplate, "name" | "category" | "program">> = {},
): ProcessStepTemplate {
  return {
    schemaVersion: 2,
    id,
    version: "V0.0.0",
    name: metadata.name ?? id,
    category: metadata.category ?? "test",
    program: metadata.program ?? "test/step",
    description: "",
    owner: "test",
    inputPorts,
    outputPorts: [
      {
        portId: "result_geometry",
        name: "Result geometry",
        dataType: "geometry",
      },
    ],
    parameterDefinitions: [],
  };
}

function flowTemplate(
  flowInputIds: string[],
  steps: Array<[stepRefId: string, processStepTemplateId: string]>,
  flowEdges: SavedFlowEdge[],
): ProcessFlowTemplate {
  return {
    schemaVersion: 2,
    id: "layout-test",
    name: "Layout test",
    version: "V0.0.0",
    flowInputs: flowInputIds.map((flowInputId) => ({
      flowInputId,
      name: flowInputId,
      dataType: "geometry",
      required: true,
    })),
    stepRefs: steps.map(([stepRefId, processStepTemplateId]) => ({
      stepRefId,
      processStepTemplateId,
    })),
    flowEdges,
  };
}

function inputEdge(
  edgeId: string,
  flowInputId: string,
  targetStepRefId: string,
  inputPortId: string,
): SavedFlowEdge {
  return {
    edgeId,
    source: { kind: "flowInput", flowInputId },
    target: { stepRefId: targetStepRefId, inputPortId },
  };
}

function stepEdge(
  edgeId: string,
  sourceStepRefId: string,
  targetStepRefId: string,
  inputPortId: string,
): SavedFlowEdge {
  return {
    edgeId,
    source: {
      kind: "stepOutput",
      stepRefId: sourceStepRefId,
      outputPortId: "result_geometry",
    },
    target: { stepRefId: targetStepRefId, inputPortId },
  };
}

function serializedLayout(layout: ReturnType<typeof computeTemplateLayout>) {
  return {
    steps: Object.fromEntries(layout.stepPositions),
    inputs: Object.fromEntries(layout.flowInputPositions),
  };
}
