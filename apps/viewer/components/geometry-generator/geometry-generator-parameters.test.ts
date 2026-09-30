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
    id: "layer1Material",
    name: "Layer 1 material",
    valueType: "materialRef",
    controlType: "text",
  },
  {
    id: "layer1Thickness",
    name: "Layer 1 thickness",
    valueType: "float",
    controlType: "number",
  },
  ...[2, 3, 4].flatMap((index): GeneratorParameterDefinition[] => [
    {
      id: `layer${index}Material`,
      name: `Layer ${index} material`,
      valueType: "materialRef",
      controlType: "text",
      visibleWhen: { parameterId: "generation", equals: "gen2" },
    },
    {
      id: `layer${index}Thickness`,
      name: `Layer ${index} thickness`,
      valueType: "float",
      controlType: "number",
      visibleWhen: { parameterId: "generation", equals: "gen2" },
    },
  ]),
];

describe("generator parameter visibility", () => {
  it("shows only the active layer fields and omits hidden values from preview", () => {
    const values = toGeneratorEditorValues(definitions, {
      generation: "gen2",
      layer1Material: "Si",
      layer1Thickness: 10,
      layer2Material: "Oxide",
      layer2Thickness: 20,
      layer3Material: "Cu",
      layer3Thickness: 30,
      layer4Material: "Nitride",
      layer4Thickness: 40,
    });
    expect(visibleGeneratorParameters(definitions, values).map((item) => item.id)).toEqual(
      definitions.map((item) => item.id),
    );
    expect(fromGeneratorEditorValues(definitions, values)).toEqual({
      generation: "gen2",
      layer1Material: "Si",
      layer1Thickness: 10,
      layer2Material: "Oxide",
      layer2Thickness: 20,
      layer3Material: "Cu",
      layer3Thickness: 30,
      layer4Material: "Nitride",
      layer4Thickness: 40,
    });

    const gen1Values: Record<string, unknown> = { ...values, generation: "gen1" };
    expect(visibleGeneratorParameters(definitions, gen1Values).map((item) => item.id)).toEqual([
      "generation",
      "layer1Material",
      "layer1Thickness",
    ]);
    expect(fromGeneratorEditorValues(definitions, gen1Values)).toEqual({
      generation: "gen1",
      layer1Material: "Si",
      layer1Thickness: 10,
    });
    expect(gen1Values.layer2Material).toBe("Oxide");
    expect(fromGeneratorEditorValues(definitions, { ...gen1Values, generation: "gen2" })).toEqual({
      generation: "gen2",
      layer1Material: "Si",
      layer1Thickness: 10,
      layer2Material: "Oxide",
      layer2Thickness: 20,
      layer3Material: "Cu",
      layer3Thickness: 30,
      layer4Material: "Nitride",
      layer4Thickness: 40,
    });
  });

  it("keeps existing generator fields without conditions visible", () => {
    expect(visibleGeneratorParameters(definitions.slice(0, 2), {})).toEqual(definitions.slice(0, 2));
  });
});
