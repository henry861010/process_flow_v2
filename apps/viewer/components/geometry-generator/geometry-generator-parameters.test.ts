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
  ...["daf", "bsPm0", "bsVia0", "si", "usg", "prePm0", "fsPm0", "fsVia0", "fow", "siCarrier"].flatMap(
    (prefix): GeneratorParameterDefinition[] => {
      const condition = ["daf", "bsPm0", "bsVia0", "prePm0", "fow", "siCarrier"].includes(prefix)
        ? { visibleWhen: { parameterId: "generation", equals: "gen2" } }
        : {};
      const isVia = prefix.endsWith("Via0");
      return [
        { id: `${prefix}Material`, name: "Material", valueType: "materialRef", controlType: "text", ...condition },
        { id: `${prefix}Thickness`, name: isVia ? "Height" : "Thickness", valueType: "float", controlType: "number", ...condition },
        ...(isVia ? [{ id: `${prefix}Density`, name: "Density", valueType: "float" as const, controlType: "number" as const, ...condition }] : []),
      ];
    },
  ),
];

const defaults = {
  generation: "gen2",
  dafMaterial: "DAF", dafThickness: 10,
  bsPm0Material: "Back polymer", bsPm0Thickness: 15,
  bsVia0Material: "Back Cu", bsVia0Thickness: 12, bsVia0Density: 60,
  siMaterial: "Si", siThickness: 200,
  usgMaterial: "USG", usgThickness: 15.5,
  prePm0Material: "PrePm0", prePm0Thickness: 15,
  fsPm0Material: "Front polymer", fsPm0Thickness: 26,
  fsVia0Material: "Cu", fsVia0Thickness: 26, fsVia0Density: 50,
  fowMaterial: "Fow", fowThickness: 10,
  siCarrierMaterial: "Si", siCarrierThickness: 200,
};

describe("generator parameter visibility", () => {
  it("shows active layers and vias, omits hidden fields, and keeps their drafts across switches", () => {
    const values = toGeneratorEditorValues(definitions, defaults);
    expect(fromGeneratorEditorValues(definitions, values)).toEqual(defaults);
    expect(visibleGeneratorParameters(definitions, values)).toEqual(definitions);

    const gen1Values: Record<string, unknown> = { ...values, generation: "gen1" };
    expect(visibleGeneratorParameters(definitions, gen1Values).map((item) => item.id)).toEqual([
      "generation", "siMaterial", "siThickness", "usgMaterial", "usgThickness",
      "fsPm0Material", "fsPm0Thickness", "fsVia0Material", "fsVia0Thickness", "fsVia0Density",
    ]);
    expect(fromGeneratorEditorValues(definitions, gen1Values)).toEqual({
      generation: "gen1", siMaterial: "Si", siThickness: 200,
      usgMaterial: "USG", usgThickness: 15.5,
      fsPm0Material: "Front polymer", fsPm0Thickness: 26,
      fsVia0Material: "Cu", fsVia0Thickness: 26, fsVia0Density: 50,
    });
    expect(gen1Values.bsVia0Thickness).toBe(12);
    expect(gen1Values.bsVia0Density).toBe(60);
    expect(gen1Values.siCarrierThickness).toBe(200);
    expect(fromGeneratorEditorValues(definitions, { ...gen1Values, generation: "gen2" })).toEqual(defaults);
  });

  it("shares the edited front via height between generations", () => {
    const values = toGeneratorEditorValues(definitions, defaults);
    const gen1Values = { ...values, generation: "gen1", fsVia0Thickness: 20 };
    const gen2Values = { ...gen1Values, generation: "gen2" };
    expect(fromGeneratorEditorValues(definitions, gen2Values).fsVia0Thickness).toBe(20);
    expect(fromGeneratorEditorValues(definitions, gen2Values).bsVia0Thickness).toBe(12);
  });

  it("keeps existing generator fields without conditions visible", () => {
    const unconditional = definitions.filter((definition) => !definition.visibleWhen);
    expect(visibleGeneratorParameters(unconditional, {})).toEqual(unconditional);
  });
});
