import { describe, expect, it } from "vitest";

import {
  coerceArrayValue,
  coercePrimitiveValue,
  createDefaultParameterValues,
  insertRepeatItem,
  normalizeFlowConfiguration,
  normalizeParameterValues,
  removeRepeatItem,
  setParameterValue,
} from "./parameter-values";
import type { ParameterDefinition, ProcessStepTemplate, RepeatableGroupValue, StepRef } from "./types";
import { flowAuthoringIssues, flowConfigurationIssues } from "./flow-editor-save";
import { isParameterValueComplete } from "./configuration";

const definitions: ParameterDefinition[] = [
  { id: "name", name: "Name", valueType: "string", defaultValue: "stable" },
  { id: "count", name: "Count", valueType: "integer", defaultValue: 0 },
  { id: "enabled", name: "Enabled", valueType: "boolean", defaultValue: false },
  { id: "items", name: "Items", valueType: "string[]", defaultValue: ["a"] },
  { id: "placements", name: "Placements", valueType: "placements", defaultValue: [] },
  {
    id: "layers",
    name: "Layers",
    valueType: "fieldGroupArray",
    defaultValue: { items: [] },
  },
  { id: "unset", name: "Unset", valueType: "float" },
];

const stepRef: StepRef = {
  stepRefId: "step",
  processStepTemplateId: "template",
};

describe("parameter defaults", () => {
  it("deep clones every definition default for step authoring", () => {
    const values = createDefaultParameterValues(definitions);
    expect(values).toEqual({
      name: "stable",
      count: 0,
      enabled: false,
      items: ["a"],
      placements: [],
      layers: { items: [] },
    });
    (values.items as string[]).push("changed");
    expect(definitions[3].defaultValue).toEqual(["a"]);
  });
});

describe("missing parameter normalization", () => {
  const children: ParameterDefinition[] = [
    { id: "count", name: "Count", valueType: "integer", required: true },
    { id: "enabled", name: "Enabled", valueType: "boolean", required: false },
    { id: "tags", name: "Tags", valueType: "string[]", required: false },
  ];
  const nested: ParameterDefinition = {
    id: "nested", name: "Nested", valueType: "fieldGroupArray", required: false,
    repeatDefinition: { indexBase: 0, itemNameTemplate: "Child {{index}}", itemParameterDefinitions: children },
  };
  const group: ParameterDefinition = {
    id: "group", name: "Group", valueType: "fieldGroupArray", required: false,
    repeatDefinition: { indexBase: 0, itemNameTemplate: "Item {{index}}", itemParameterDefinitions: [...children, nested] },
  };
  const definitions = [...children, group];

  it("removes only declared missing slots, preserving falsy values and collection elements", () => {
    const input = { count: 0, enabled: false, tags: ["", null], unknown: "", group: { items: [
      { itemId: "", index: 0, values: { count: null, enabled: false, tags: [], unknown: null, nested: { items: [
        { itemId: "child", index: 0, values: { count: "", tags: [] } },
        null,
      ] } } },
    ] } };
    const original = structuredClone(input);
    expect(normalizeParameterValues(definitions, input)).toEqual({
      count: 0, enabled: false, tags: ["", null], unknown: "", group: { items: [
        { itemId: "", index: 0, values: { enabled: false, tags: [], unknown: null, nested: { items: [
          { itemId: "child", index: 0, values: { tags: [] } }, null,
        ] } } },
      ] },
    });
    expect(input).toEqual(original);
    expect(normalizeParameterValues(definitions, { count: " ", enabled: "false", tags: [], group: { items: [] } }))
      .toEqual({ count: " ", enabled: "false", tags: [], group: { items: [] } });
    expect(normalizeParameterValues(definitions, { count: undefined, enabled: null, group: "" })).toEqual({});
  });

  it("uses key omission when UI clears a value, retaining 0, false and empty collections", () => {
    for (const value of ["", null, undefined]) expect(setParameterValue({ count: 42, enabled: false }, "count", value)).toEqual({ enabled: false });
    for (const value of [0, false, [], { items: [] }]) expect(setParameterValue({}, "value", value)).toEqual({ value });
  });

  it("allows required omissions while authoring, then rejects them for execution at every depth", () => {
    const step = { id: "step", name: "Step", parameterDefinitions: definitions, inputPorts: [], outputPorts: [] } as unknown as ProcessStepTemplate;
    const definition = { flowInputs: [], stepRefs: [{ stepRefId: "a", processStepTemplateId: step.id }], flowEdges: [] };
    const configuration = { inputBindings: {}, stepConfigurations: { a: { selectedRecipeId: "r", recipeCandidates: [
      { recipeId: "r", name: "Recipe", description: "", parameterValues: { count: null, group: { items: [
        { itemId: "parent", index: 0, values: { count: "", nested: { items: [{ itemId: "child", index: 0, values: { count: null } }] } } },
      ] } } },
    ] } } };
    const normalized = normalizeFlowConfiguration(definition, [step], configuration);
    const values = normalized.stepConfigurations.a.recipeCandidates[0].parameterValues;
    expect(values).not.toHaveProperty("count");
    expect(flowAuthoringIssues(definition, [step], normalized)).toEqual([]);
    expect(flowConfigurationIssues(definition, [step], normalized, []).join()).toContain("Count");
    expect(isParameterValueComplete(group, values.group)).toBe(false);
    expect(isParameterValueComplete(nested, { items: [{ itemId: "child", index: 0, values: {} }] })).toBe(false);
  });

  it("retains invalid supplied data for validation after normalization", () => {
    const invalid = { group: { items: [{ itemId: "a", index: 0, values: { count: "invalid", tags: [null], unknown: null } }] } };
    expect(normalizeParameterValues(definitions, invalid)).toEqual(invalid);
    expect(isParameterValueComplete(group, invalid.group)).toBe(false);
  });

  it("preserves numeric invalid input through a raw draft JSON round trip", () => {
    const values = {
      count: coercePrimitiveValue("1.5", "integer"),
      invalid: coercePrimitiveValue("broken", "float"),
      overflow: coercePrimitiveValue("1e999", "float"),
      items: coerceArrayValue(["0", "1.5", "", "2units"], "integer[]"),
    };
    expect(JSON.parse(JSON.stringify(values))).toEqual({ count: 1.5, invalid: "broken", overflow: "1e999", items: [0, 1.5, "", "2units"] });
    expect(isParameterValueComplete(children[0], values.count)).toBe(false);
    expect(coercePrimitiveValue("1e2", "integer")).toBe(100);
    expect(coerceArrayValue(["0", "1.5", "invalid"], "float[]")).toEqual([0, 1.5, "invalid"]);
  });

  it("retains an empty group below minItems for authoring and reports it as incomplete for execution", () => {
    const requiredGroup = { ...group, required: true, repeatDefinition: { ...group.repeatDefinition!, minItems: 1 } };
    const step = { id: "step", name: "Step", parameterDefinitions: [requiredGroup], inputPorts: [], outputPorts: [] } as unknown as ProcessStepTemplate;
    const definition = { flowInputs: [], stepRefs: [{ stepRefId: "a", processStepTemplateId: "step" }], flowEdges: [] };
    const configuration = { inputBindings: {}, stepConfigurations: { a: { selectedRecipeId: "r", recipeCandidates: [
      { recipeId: "r", name: "Recipe", description: "", parameterValues: { group: { items: [] } } },
    ] } } };
    expect(flowAuthoringIssues(definition, [step], configuration)).toEqual([]);
    expect(normalizeFlowConfiguration(definition, [step], configuration)).toEqual(configuration);
    expect(flowConfigurationIssues(definition, [step], configuration, []).join()).toContain("Group");
  });
});

describe("repeatable group insertion and deletion", () => {
  const parameter: ParameterDefinition = {
    id: "layers",
    name: "Layers",
    valueType: "fieldGroupArray",
    repeatDefinition: {
      itemNameTemplate: "Layer {{index}}",
      indexBase: 1,
      minItems: 0,
      maxItems: 5,
      itemParameterDefinitions: [
        { id: "name", name: "Name", valueType: "string", defaultValue: "new" },
        { id: "nested", name: "Nested", valueType: "fieldGroupArray", defaultValue: { items: [] } },
      ],
    },
  };

  function existingValue(): RepeatableGroupValue {
    return {
      items: ["a", "b", "c"].map((itemId, offset) => ({
        itemId,
        index: offset + 10,
        values: { name: itemId, nested: { items: [{ itemId: `nested-${itemId}`, index: 9, values: {} }] } },
      })),
    };
  }

  it.each([
    ["a", ["new", "a", "b", "c"]],
    ["b", ["a", "new", "b", "c"]],
    [null, ["a", "b", "c", "new"]],
  ] as const)("inserts before %s and renumbers without changing existing content or identity", (anchor, names) => {
    const value = existingValue();
    const original = structuredClone(value);
    const next = insertRepeatItem(parameter, value, anchor);
    expect(next.items.map((item) => item.values.name)).toEqual(names);
    expect(next.items.map((item) => item.index)).toEqual([1, 2, 3, 4]);
    for (const item of value.items) {
      expect(next.items.find((nextItem) => nextItem.itemId === item.itemId)?.values).toBe(item.values);
    }
    expect(new Set(next.items.map((item) => item.itemId)).size).toBe(4);
    expect(value).toEqual(original);
  });

  it("inserts consecutively before the same stable anchor", () => {
    const first = insertRepeatItem(parameter, existingValue(), "b");
    const second = insertRepeatItem(parameter, first, "b");
    expect(second.items.map((item) => item.values.name)).toEqual(["a", "new", "new", "b", "c"]);
    expect(second.items[1].itemId).toBe(first.items[1].itemId);
    expect(second.items[2].itemId).not.toBe(first.items[1].itemId);
    expect(second.items.map((item) => item.index)).toEqual([1, 2, 3, 4, 5]);
    expect(second.items[1].values.nested).not.toBe(second.items[2].values.nested);
  });

  it.each(["a", "b", "c"])("deletes the specified item %s and keeps sibling and nested values", (itemId) => {
    const value = existingValue();
    const original = structuredClone(value);
    const next = removeRepeatItem(parameter, value, itemId);
    expect(next.items.map((item) => item.itemId)).toEqual(value.items.filter((item) => item.itemId !== itemId).map((item) => item.itemId));
    expect(next.items.map((item) => item.index)).toEqual([1, 2]);
    for (const item of next.items) {
      expect(item.values).toBe(value.items.find((originalItem) => originalItem.itemId === item.itemId)!.values);
    }
    expect(value).toEqual(original);
  });

  it("uses indexBase for an empty list and permits removing the last item at minItems zero", () => {
    const definition = { ...parameter, repeatDefinition: { ...parameter.repeatDefinition!, indexBase: 7 } };
    const next = insertRepeatItem(definition, { items: [] });
    expect(next.items[0].index).toBe(7);
    expect(next.items[0].values).toEqual({ name: "new", nested: { items: [] } });
    expect(removeRepeatItem(definition, next, next.items[0].itemId)).toEqual({ items: [] });
  });

  it("does not exceed maxItems or delete below minItems", () => {
    const value = existingValue();
    const limited = { ...parameter, repeatDefinition: { ...parameter.repeatDefinition!, minItems: 3, maxItems: 3 } };
    expect(insertRepeatItem(limited, value, "b")).toBe(value);
    expect(removeRepeatItem(limited, value, "b")).toBe(value);
    const zero = { ...parameter, repeatDefinition: { ...parameter.repeatDefinition!, maxItems: 0 } };
    const empty = { items: [] };
    expect(insertRepeatItem(zero, empty)).toBe(empty);
  });

  it("appends when the insertion anchor disappeared and ignores an unknown deletion target", () => {
    const value = existingValue();
    expect(insertRepeatItem(parameter, value, "missing").items.map((item) => item.values.name)).toEqual(["a", "b", "c", "new"]);
    expect(removeRepeatItem(parameter, value, "missing")).toBe(value);
  });
});
