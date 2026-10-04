import { describe, expect, it } from "vitest";

import type { GeneratorParameterDefinition } from "./geometry-generator-contracts";
import {
  fromGeneratorEditorValues,
  toGeneratorEditorValues,
  visibleGeneratorParameters,
} from "./geometry-generator-parameters";

const definitions: GeneratorParameterDefinition[] = [
  {
    id: "generation",
    name: "Generation",
    valueType: "string",
    controlType: "select",
    optionSource: {
      type: "static",
      options: [
        { value: "gen1", name: "Gen 1" },
        { value: "gen2", name: "Gen 2" },
      ],
    },
  },
  {
    id: "bsmcMaterial",
    name: "Material",
    valueType: "materialRef",
    controlType: "text",
    visibleWhen: { parameterId: "generation", equals: "gen2" },
  },
  {
    id: "bsmcThickness",
    name: "Thickness",
    valueType: "float",
    controlType: "number",
    visibleWhen: { parameterId: "generation", equals: "gen2" },
  },
  {
    id: "siMaterial",
    name: "Material",
    valueType: "materialRef",
    controlType: "text",
  },
  {
    id: "siThickness",
    name: "Thickness",
    valueType: "float",
    controlType: "number",
  },
  {
    id: "usgMaterial",
    name: "Material",
    valueType: "materialRef",
    controlType: "text",
  },
  {
    id: "usgThickness",
    name: "Thickness",
    valueType: "float",
    controlType: "number",
  },
  {
    id: "lsiTopMoldingMaterial",
    name: "Material",
    valueType: "materialRef",
    controlType: "text",
    visibleWhen: { parameterId: "generation", equals: "gen1" },
  },
  {
    id: "lsiTopMoldingThickness",
    name: "Thickness",
    valueType: "float",
    controlType: "number",
    visibleWhen: { parameterId: "generation", equals: "gen1" },
  },
  {
    id: "prePm0Material",
    name: "Material",
    valueType: "materialRef",
    controlType: "text",
    visibleWhen: { parameterId: "generation", equals: "gen2" },
  },
  {
    id: "prePm0Thickness",
    name: "Thickness",
    valueType: "float",
    controlType: "number",
    visibleWhen: { parameterId: "generation", equals: "gen2" },
  },
];

describe("generator parameter visibility", () => {
  it("shows only the active layer fields and omits hidden values from preview", () => {
    const values = toGeneratorEditorValues(definitions, {
      generation: "gen2",
      bsmcMaterial: "BSMC",
      bsmcThickness: 15,
      siMaterial: "Si",
      siThickness: 10,
      usgMaterial: "USG",
      usgThickness: 15.5,
      lsiTopMoldingMaterial: "Mold",
      lsiTopMoldingThickness: 26,
      prePm0Material: "PrePm0",
      prePm0Thickness: 15,
    });
    expect(visibleGeneratorParameters(definitions, values).map((item) => item.id)).toEqual([
      "generation",
      "bsmcMaterial",
      "bsmcThickness",
      "siMaterial",
      "siThickness",
      "usgMaterial",
      "usgThickness",
      "prePm0Material",
      "prePm0Thickness",
    ]);
    expect(fromGeneratorEditorValues(definitions, values)).toEqual({
      generation: "gen2",
      bsmcMaterial: "BSMC",
      bsmcThickness: 15,
      siMaterial: "Si",
      siThickness: 10,
      usgMaterial: "USG",
      usgThickness: 15.5,
      prePm0Material: "PrePm0",
      prePm0Thickness: 15,
    });

    const gen1Values: Record<string, unknown> = { ...values, generation: "gen1" };
    expect(visibleGeneratorParameters(definitions, gen1Values).map((item) => item.id)).toEqual([
      "generation",
      "siMaterial",
      "siThickness",
      "usgMaterial",
      "usgThickness",
      "lsiTopMoldingMaterial",
      "lsiTopMoldingThickness",
    ]);
    expect(fromGeneratorEditorValues(definitions, gen1Values)).toEqual({
      generation: "gen1",
      siMaterial: "Si",
      siThickness: 10,
      usgMaterial: "USG",
      usgThickness: 15.5,
      lsiTopMoldingMaterial: "Mold",
      lsiTopMoldingThickness: 26,
    });
    expect(gen1Values.bsmcMaterial).toBe("BSMC");
    expect(gen1Values.prePm0Material).toBe("PrePm0");
    expect(fromGeneratorEditorValues(definitions, { ...gen1Values, generation: "gen2" })).toEqual({
      generation: "gen2",
      bsmcMaterial: "BSMC",
      bsmcThickness: 15,
      siMaterial: "Si",
      siThickness: 10,
      usgMaterial: "USG",
      usgThickness: 15.5,
      prePm0Material: "PrePm0",
      prePm0Thickness: 15,
    });
  });

  it("keeps existing generator fields without conditions visible", () => {
    const unconditional = definitions.filter((definition) => !definition.visibleWhen);
    expect(visibleGeneratorParameters(unconditional, {})).toEqual(unconditional);
  });
});
