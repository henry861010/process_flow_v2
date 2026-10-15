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
  generatorDisplayName,
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
  {
    ...definition("wafer-carrier", "carrier.wafer", ["templateGeometryLibrary", "flowInputPicker"]),
    entityType: "wafer",
  },
  {
    ...definition("panel-carrier", "carrier.panel", ["templateGeometryLibrary", "flowInputPicker"]),
    entityType: "panel",
  },
  definition("lsi", "die.lsi", ["management", "templateGeometryLibrary", "flowInputPicker"]),
  definition("soc", "die.soc", ["templateGeometryLibrary", "flowInputPicker"]),
  {
    ...definition("wafer-dmy", "die.wafer-dmy", ["templateGeometryLibrary", "flowInputPicker"]),
    label: "DMY die generator",
  },
  definition("vrm", "die.vrm", ["templateGeometryLibrary", "flowInputPicker"]),
  {
    ...definition("frame", "frame", ["templateGeometryLibrary", "flowInputPicker"]),
    entityType: "frame",
  },
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
      .toEqual(["wafer-carrier", "panel-carrier", "lsi", "soc", "wafer-dmy", "vrm", "frame"]);
    expect(catalogGeneratorHref(definitions[0])).toBe("/geometry-generator?generatorId=hbm");
  });

  it("combines picker placement with flow input category constraints", () => {
    expect(generatorsForFlowInput(definitions, input("die.hbm"))).toEqual([]);
    expect(generatorsForFlowInput(definitions, input("die.dram"))).toEqual([]);
    expect(generatorsForFlowInput(definitions, input("die.soc")).map((item) => item.id)).toEqual(["soc"]);
    expect(generatorsForFlowInput(definitions, input("die.vrm")).map((item) => item.id)).toEqual(["vrm"]);
    expect(generatorsForFlowInput(definitions, input("die.lsi")).map((item) => item.id)).toEqual(["lsi"]);
    expect(generatorsForFlowInput(definitions, input("die.wafer-dmy")).map((item) => item.id)).toEqual(["wafer-dmy"]);
    expect(generatorsForFlowInput(definitions, input("die")).map((item) => item.id))
      .toEqual(["lsi", "soc", "wafer-dmy", "vrm"]);
  });

  it("hides recipe editing when a generator is absent from the flow input picker", () => {
    expect(canEditGeneratorBinding(definitions, {
      kind: "generator", generatorId: "hbm", generatorVersion: 2, parameters: {},
    })).toBe(false);
    expect(canEditGeneratorBinding(definitions, {
      kind: "generator", generatorId: "soc", generatorVersion: 1, parameters: {},
    })).toBe(true);
    expect(canEditGeneratorBinding(definitions, {
      kind: "generator", generatorId: "wafer-dmy", generatorVersion: 1,
      parameters: { siThickness: 200, siMaterial: "si" },
    })).toBe(true);
    expect(generatorDisplayName(definitions.find((item) => item.id === "wafer-dmy")!)).toBe("DMY die");
  });

  it("offers carrier and frame generators only to matching geometry inputs and allows reopening", () => {
    for (const [id, category, entityType] of [
      ["wafer-carrier", "carrier.wafer", "wafer"],
      ["panel-carrier", "carrier.panel", "panel"],
      ["frame", "frame", "frame"],
    ]) {
      const flowInput = input(category);
      flowInput.geometryConstraints!.entityTypes = [entityType];
      expect(generatorsForFlowInput(definitions, flowInput).map((item) => item.id)).toEqual([id]);
      expect(canEditGeneratorBinding(definitions, {
        kind: "generator", generatorId: id, generatorVersion: 1, parameters: {},
      })).toBe(true);
      flowInput.geometryConstraints!.entityTypes = ["die"];
      expect(generatorsForFlowInput(definitions, flowInput)).toEqual([]);
    }
    expect(generatorsForFlowInput(definitions, input("carrier")).map((item) => item.id))
      .toEqual(["wafer-carrier", "panel-carrier"]);
  });
});
