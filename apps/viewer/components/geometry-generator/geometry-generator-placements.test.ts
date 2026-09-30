import { describe, expect, it } from "vitest";

import type {
  GeometryGeneratorDefinition,
  GeometryGeneratorUiPlacement,
} from "./geometry-generator-contracts";
import {
  canEditGeneratorBinding,
  catalogGeneratorHref,
  generatorsForFlowInput,
  generatorsForPlacement,
} from "./geometry-generator-placements";
import type { FlowInputDefinition } from "@/lib/process-flow/types";

function definition(
  id: string,
  category: string,
  uiPlacements: GeometryGeneratorUiPlacement[],
): GeometryGeneratorDefinition {
  return {
    schemaVersion: 2,
    id,
    version: 1,
    label: `${id.toUpperCase()} generator`,
    description: "",
    uiPlacements,
    entityType: "die",
    category,
    adaptationContract: { adapterId: "box-rescale", adapterVersion: 1 },
    defaultParameters: {},
    parameterDefinitions: [],
    parameterGroups: [],
    previewViews: [],
  };
}

const definitions = [
  definition("hbm", "die.hbm", ["home"]),
  definition("dram", "die.dram", ["home"]),
  definition("soc", "die.soc", ["templateGeometryLibrary", "flowInputPicker"]),
  definition("lsi", "die.lsi", ["management", "templateGeometryLibrary", "flowInputPicker"]),
];

function input(category: string): FlowInputDefinition {
  return {
    flowInputId: "incoming_die",
    name: "Incoming die",
    dataType: "geometry",
    required: true,
    geometryConstraints: { categories: [category] },
  };
}

describe("generator UI placements", () => {
  it("filters Home, Management, and Template geometry library independently", () => {
    expect(generatorsForPlacement(definitions, "home").map((item) => item.id)).toEqual(["hbm", "dram"]);
    expect(generatorsForPlacement(definitions, "management").map((item) => item.id)).toEqual(["lsi"]);
    expect(generatorsForPlacement(definitions, "templateGeometryLibrary").map((item) => item.id))
      .toEqual(["soc", "lsi"]);
    expect(catalogGeneratorHref(definitions[0])).toBe("/geometry-generator?generatorId=hbm");
  });

  it("combines picker placement with flow input category constraints", () => {
    expect(generatorsForFlowInput(definitions, input("die.hbm"))).toEqual([]);
    expect(generatorsForFlowInput(definitions, input("die.dram"))).toEqual([]);
    expect(generatorsForFlowInput(definitions, input("die.soc")).map((item) => item.id)).toEqual(["soc"]);
    expect(generatorsForFlowInput(definitions, input("die.lsi")).map((item) => item.id)).toEqual(["lsi"]);
  });

  it("hides recipe editing when a generator is absent from the flow input picker", () => {
    expect(canEditGeneratorBinding(definitions, {
      kind: "generator", generatorId: "hbm", generatorVersion: 2, parameters: {},
    })).toBe(false);
    expect(canEditGeneratorBinding(definitions, {
      kind: "generator", generatorId: "soc", generatorVersion: 1, parameters: {},
    })).toBe(true);
  });
});
