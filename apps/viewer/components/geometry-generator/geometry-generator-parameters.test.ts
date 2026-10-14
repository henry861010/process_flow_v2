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
        { value: "gen2-bs-first", name: "gen2 (bs-first)" },
      ],
    },
  },
  ...["microBump", "daf", "bsPm0", "bsVia0", "si", "usg", "prePm0", "fsPm0", "fsVia0", "fow", "siCarrier"].flatMap(
    (prefix): GeneratorParameterDefinition[] => {
      const condition: Pick<GeneratorParameterDefinition, "visibleWhen"> = prefix === "microBump"
        ? { visibleWhen: { parameterId: "generation", equals: "gen2-bs-first" } }
        : ["daf", "bsPm0", "bsVia0"].includes(prefix)
        ? { visibleWhen: { parameterId: "generation", equals: "gen2" } }
        : ["prePm0", "fow", "siCarrier"].includes(prefix)
        ? { visibleWhen: { parameterId: "generation", in: ["gen2", "gen2-bs-first"] } }
        : {};
      const isVia = prefix.endsWith("Via0") || prefix === "microBump";
      return [
        { id: `${prefix}Material`, name: "Material", valueType: "materialRef", controlType: "text", ...condition },
        { id: `${prefix}Thickness`, name: isVia ? "Height" : "Thickness", valueType: "float", controlType: "number", ...condition },
        ...(isVia ? [{ id: `${prefix}Density`, name: "Density", valueType: "float" as const, controlType: "number" as const, ...condition }] : []),
        ...(prefix === "microBump" ? [{ id: `${prefix}Koz`, name: "KOZ", valueType: "float" as const, controlType: "number" as const, ...condition }] : []),
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
const bumpDefaults = {
  microBumpMaterial: "Cu/Ni/SnAg", microBumpThickness: 28, microBumpDensity: 42, microBumpKoz: 0,
};

describe("generator parameter visibility", () => {
  it("shows active layers and vias, omits hidden fields, and keeps their drafts across switches", () => {
    const values = toGeneratorEditorValues(definitions, { ...defaults, ...bumpDefaults });
    expect(fromGeneratorEditorValues(definitions, values)).toEqual(defaults);
    expect(visibleGeneratorParameters(definitions, values)).toEqual(definitions.filter((definition) => !definition.id.startsWith("microBump")));

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

  it("shows bs-first bump and shared layers while retaining drafts across all three generations", () => {
    const values = toGeneratorEditorValues(definitions, { ...defaults, ...bumpDefaults });
    const edited = { ...values, generation: "gen2-bs-first", microBumpThickness: 12, microBumpKoz: 3, fsVia0Thickness: 30 };
    const visible = visibleGeneratorParameters(definitions, edited).map((definition) => definition.id);
    expect(visible).toEqual([
      "generation", "microBumpMaterial", "microBumpThickness", "microBumpDensity", "microBumpKoz",
      "siMaterial", "siThickness", "usgMaterial", "usgThickness", "prePm0Material", "prePm0Thickness",
      "fsPm0Material", "fsPm0Thickness", "fsVia0Material", "fsVia0Thickness", "fsVia0Density",
      "fowMaterial", "fowThickness", "siCarrierMaterial", "siCarrierThickness",
    ]);
    const { dafMaterial, dafThickness, bsPm0Material, bsPm0Thickness, bsVia0Material, bsVia0Thickness, bsVia0Density, ...shared } = defaults;
    const expected = { ...shared, ...bumpDefaults, generation: "gen2-bs-first", microBumpThickness: 12, microBumpKoz: 3, fsVia0Thickness: 30 };
    expect(fromGeneratorEditorValues(definitions, edited)).toEqual(expected);
    const gen1 = { ...edited, generation: "gen1", fsVia0Thickness: 20 };
    const gen2 = { ...gen1, generation: "gen2" };
    expect(fromGeneratorEditorValues(definitions, gen2)).toEqual({ ...defaults, fsVia0Thickness: 20 });
    expect(fromGeneratorEditorValues(definitions, { ...gen2, generation: "gen2-bs-first" })).toEqual({ ...expected, fsVia0Thickness: 20 });
    expect(gen2.microBumpThickness).toBe(12);
    expect(gen2.microBumpKoz).toBe(3);
  });

  it("compares membership values without coercing numbers or booleans", () => {
    const conditional: GeneratorParameterDefinition[] = [
      { id: "countField", name: "Count", valueType: "float", visibleWhen: { parameterId: "count", in: [0, 2] } },
      { id: "enabledField", name: "Enabled", valueType: "float", visibleWhen: { parameterId: "enabled", equals: false } },
    ];
    expect(visibleGeneratorParameters(conditional, { count: 0, enabled: false })).toEqual(conditional);
    expect(visibleGeneratorParameters(conditional, { count: "0", enabled: "false" })).toEqual([]);
    expect(visibleGeneratorParameters(conditional, {})).toEqual([]);
  });
});
