import { describe, expect, it } from "vitest";

import {
  createDefaultParameterValues,
  createFlowParameterDefaults,
  insertRepeatItem,
  removeRepeatItem,
  resolveFlowParameterDefaults,
} from "./parameter-values";
import type { ParameterDefinition, RepeatableGroupValue, StepRef } from "./types";

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

  it("serializes only present scalar values as flow defaults", () => {
    expect(
      createFlowParameterDefaults(definitions, {
        name: "flow",
        count: 0,
        enabled: false,
        items: ["ignored"],
        placements: [{ ignored: true }],
        layers: { items: [{ ignored: true }] },
        unset: "",
      }),
    ).toEqual({ name: "flow", count: 0, enabled: false });
  });

  it("uses an explicit flow snapshot and legacy scalar fallback", () => {
    expect(
      resolveFlowParameterDefaults(
        { ...stepRef, parameterDefaults: { name: "flow", items: ["ignored"] } },
        definitions,
      ),
    ).toEqual({ name: "flow" });
    expect(resolveFlowParameterDefaults(stepRef, definitions)).toEqual({
      name: "stable",
      count: 0,
      enabled: false,
    });
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
