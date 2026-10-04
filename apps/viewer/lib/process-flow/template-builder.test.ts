import { describe, expect, it } from "vitest";

import { buildTemplatePayload } from "./template-builder";

describe("template working generator binding", () => {
  it("saves the input contract without its generator recipe", () => {
    const template = buildTemplatePayload(
      { id: "flow", name: "Flow", version: "V0.0.0", owner: "test", description: "" },
      [{
        flowInputId: "incoming_hbm", name: "HBM input", dataType: "geometry",
        required: true, geometryConstraints: { categories: ["die.hbm"] },
      }],
      [],
      [],
      {
        inputBindings: { incoming_hbm: {
          kind: "generator", generatorId: "hbm", generatorVersion: 2,
          parameters: { topCoreDieThickness: 50 },
        } },
        stepConfigurations: {},
        embeddedGeometries: {},
      },
    );

    expect(template.flowInputs[0].geometryConstraints).toEqual({ categories: ["die.hbm"] });
    expect(JSON.stringify(template)).not.toContain("generatorId");
    expect(JSON.stringify(template)).not.toContain("inputBindings");
  });
});
