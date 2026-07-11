"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { CoordinateListControl } from "@/components/process-flow-fields/coordinate-list-control";
import { Button } from "@/components/ui/button";
import type {
  ParameterDefinition,
  RepeatableGroupValue,
} from "@/lib/process-flow/types";
import {
  coerceArrayValue,
  coercePrimitiveValue,
  createDefaultParameterValue,
  createRepeatItem,
  formatRepeatItemName,
  isArrayValueType,
  isIntegerValueType,
  isNumericValueType,
  isRepeatableGroupValue,
} from "@/lib/process-flow/parameter-values";
import { cn } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function ParameterValueEditor({
  definitions,
  values,
  disabled = false,
  onChange,
}: {
  definitions: ParameterDefinition[];
  values: Record<string, unknown>;
  disabled?: boolean;
  onChange: (values: Record<string, unknown>) => void;
}) {
  if (definitions.length === 0) {
    return (
      <div className="border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No parameters
      </div>
    );
  }

  return (
    <div className="divide-y rounded-md border bg-white">
      {definitions.map((definition) => (
        <ParameterRow
          key={definition.id}
          definition={definition}
          value={values[definition.id]}
          disabled={disabled}
          onChange={(value) => onChange({ ...values, [definition.id]: value })}
        />
      ))}
    </div>
  );
}

function ParameterRow({
  definition,
  value,
  disabled,
  onChange,
}: {
  definition: ParameterDefinition;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  if (definition.valueType === "fieldGroupArray" && definition.repeatDefinition) {
    return (
      <RepeaterControl
        definition={definition}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  return (
    <div className="grid grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.2fr)] gap-4 px-4 py-4 text-sm max-md:grid-cols-1">
      <ParameterLabel definition={definition} />
      <PrimitiveControl
        definition={definition}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

function RepeaterControl({
  definition,
  value,
  disabled,
  onChange,
}: {
  definition: ParameterDefinition;
  value: unknown;
  disabled: boolean;
  onChange: (value: RepeatableGroupValue) => void;
}) {
  const repeat = definition.repeatDefinition!;
  const repeatValue = isRepeatableGroupValue(value)
    ? value
    : (createDefaultParameterValue(definition) as RepeatableGroupValue);
  const minItems = repeat.minItems ?? 0;
  const maxItems = repeat.maxItems ?? Number.POSITIVE_INFINITY;

  function updateItemValues(itemIndex: number, values: Record<string, unknown>) {
    onChange({
      items: repeatValue.items.map((item, index) =>
        index === itemIndex ? { ...item, values } : item,
      ),
    });
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <ParameterLabel definition={definition} />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || repeatValue.items.length <= minItems}
            onClick={() => onChange({ items: repeatValue.items.slice(0, -1) })}
          >
            <Trash2 />
            Remove
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled || repeatValue.items.length >= maxItems}
            onClick={() => {
              const nextIndex =
                repeatValue.items.length === 0
                  ? repeat.indexBase
                  : Math.max(...repeatValue.items.map((item) => item.index)) + 1;
              onChange({
                items: [
                  ...repeatValue.items,
                  createRepeatItem(definition, nextIndex),
                ],
              });
            }}
          >
            <Plus />
            Add
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {repeatValue.items.map((item, itemIndex) => (
          <section key={item.itemId} className="rounded-md border bg-muted/20 p-3">
            <div className="mb-3 text-sm font-medium">
              {formatRepeatItemName(definition, item.index)}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {repeat.itemParameterDefinitions.map((child) => (
                <div
                  key={child.id}
                  className={cn(
                    "min-w-0",
                    child.valueType === "fieldGroupArray" && "md:col-span-2",
                  )}
                >
                  <ParameterLabel definition={child} compact />
                  <div className="mt-2">
                    {child.valueType === "fieldGroupArray" ? (
                      <RepeaterControl
                        definition={child}
                        value={item.values[child.id]}
                        disabled={disabled}
                        onChange={(nextValue) =>
                          updateItemValues(itemIndex, {
                            ...item.values,
                            [child.id]: nextValue,
                          })
                        }
                      />
                    ) : (
                      <PrimitiveControl
                        definition={child}
                        value={item.values[child.id]}
                        disabled={disabled}
                        onChange={(nextValue) =>
                          updateItemValues(itemIndex, {
                            ...item.values,
                            [child.id]: nextValue,
                          })
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {repeatValue.items.length === 0 ? (
          <div className="border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
            No items
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PrimitiveControl({
  definition,
  value,
  disabled,
  onChange,
}: {
  definition: ParameterDefinition;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  if (definition.valueType === "coordinates" || definition.controlType === "coordinateList") {
    if (disabled) {
      return (
        <div className="min-h-9 rounded-md border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
          {formatReadonlyValue(value)}
        </div>
      );
    }
    return (
      <CoordinateListControl
        value={value}
        unit={definition.unit}
        onChange={onChange}
      />
    );
  }

  if (definition.controlType === "select" && definition.optionSource?.options) {
    if (isArrayValueType(definition.valueType)) {
      return (
        <OptionCheckboxes
          definition={definition}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
      );
    }
    return (
      <select
        className={selectClass}
        aria-label={definition.name}
        value={value == null ? "" : String(value)}
        disabled={disabled}
        onChange={(event) =>
          onChange(coercePrimitiveValue(event.target.value, definition.valueType))
        }
      >
        <option value="">Select value</option>
        {definition.optionSource.options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }

  if (definition.controlType === "checkbox" && definition.valueType === "boolean") {
    return (
      <label className="inline-flex min-h-9 items-center gap-2 rounded-md border bg-white px-3 py-2">
        <input
          type="checkbox"
          aria-label={definition.name}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{value === true ? "True" : "False"}</span>
      </label>
    );
  }

  if (definition.controlType === "checkbox" && definition.optionSource?.options) {
    return (
      <OptionCheckboxes
        definition={definition}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (isArrayValueType(definition.valueType)) {
    const displayValue = Array.isArray(value) ? value.join(", ") : "";
    return (
      <input
        className={inputClass}
        aria-label={definition.name}
        value={displayValue}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            coerceArrayValue(
              event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
              definition.valueType,
            ),
          )
        }
      />
    );
  }

  if (isNumericValueType(definition.valueType)) {
    return (
      <div className="flex items-center gap-2">
        <input
          className={inputClass}
          aria-label={definition.name}
          type="number"
          step={isIntegerValueType(definition.valueType) ? 1 : "any"}
          min={definition.validation?.min}
          max={definition.validation?.max}
          value={typeof value === "number" ? value : ""}
          disabled={disabled}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? ""
                : coercePrimitiveValue(event.target.value, definition.valueType),
            )
          }
        />
        {definition.unit ? (
          <span className="shrink-0 text-sm text-muted-foreground">
            {definition.unit}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <input
      className={inputClass}
      aria-label={definition.name}
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function OptionCheckboxes({
  definition,
  value,
  disabled,
  onChange,
}: {
  definition: ParameterDefinition;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const selectedValues = Array.isArray(value) ? value.map(String) : [];
  return (
    <div className="flex flex-wrap gap-2">
      {definition.optionSource?.options.map((option) => {
        const optionValue = String(option.value);
        const checked = selectedValues.includes(optionValue);
        return (
          <label
            key={optionValue}
            className="flex min-w-[140px] items-start gap-2 rounded-md border bg-white px-3 py-2"
          >
            <input
              className="mt-1"
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(event) => {
                if (definition.selectionMode !== "multiple") {
                  onChange(
                    event.target.checked
                      ? coercePrimitiveValue(optionValue, definition.valueType)
                      : "",
                  );
                  return;
                }
                const next = event.target.checked
                  ? [...selectedValues, optionValue]
                  : selectedValues.filter((item) => item !== optionValue);
                onChange(coerceArrayValue(next, definition.valueType));
              }}
            />
            <span>{option.name}</span>
          </label>
        );
      })}
    </div>
  );
}

function ParameterLabel({
  definition,
  compact = false,
}: {
  definition: ParameterDefinition;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
        {definition.name}
        {definition.required === false ? null : (
          <span className="ml-1 text-destructive">*</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 font-mono text-[11px] text-muted-foreground">
        <span>{definition.id}</span>
        {definition.unit ? <span>/ {definition.unit}</span> : null}
      </div>
      {definition.description && !compact ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {definition.description}
        </p>
      ) : null}
    </div>
  );
}

function formatReadonlyValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "Not set";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
