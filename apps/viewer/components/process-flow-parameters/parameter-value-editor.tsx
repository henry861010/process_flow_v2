"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";

import { PlacementListControl } from "@/components/process-flow-fields/placement-list-control";
import { RepeatableGroupCsvImport } from "./repeatable-group-csv-import";
import { Button } from "@/components/ui/button";
import { canImportRepeatableGroupCsv } from "@/lib/process-flow/repeatable-group-csv";
import type {
  ParameterDefinition,
  ParameterDefinitionGroup,
  RepeatableGroupValue,
} from "@/lib/process-flow/types";
import {
  coerceArrayValue,
  coercePrimitiveValue,
  createDefaultParameterValue,
  formatRepeatItemName,
  insertRepeatItem,
  isArrayValueType,
  isIntegerValueType,
  isNumericValueType,
  isRepeatableGroupValue,
  removeRepeatItem,
} from "@/lib/process-flow/parameter-values";
import { cn } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function ParameterValueEditor({
  definitions,
  values,
  errors = {},
  disabled = false,
  groups = [],
  onChange,
}: {
  definitions: ParameterDefinition[];
  values: Record<string, unknown>;
  errors?: Record<string, string>;
  disabled?: boolean;
  groups?: ParameterDefinitionGroup[];
  onChange: (values: Record<string, unknown>) => void;
}) {
  if (definitions.length === 0) {
    return (
      <div className="border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No parameters
      </div>
    );
  }

  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const groupedParameterIds = new Set(groups.flatMap((group) => group.parameterIds));
  const resolvedGroups = groups
    .map((group) => ({
      ...group,
      definitions: group.parameterIds
        .map((parameterId) => definitionsById.get(parameterId))
        .filter((definition): definition is ParameterDefinition => definition != null),
    }))
    .filter((group) => group.definitions.length > 0);
  const ungroupedDefinitions = definitions.filter(
    (definition) => !groupedParameterIds.has(definition.id),
  );

  if (resolvedGroups.length > 0) {
    return (
      <div className="space-y-4">
        {resolvedGroups.map((group) => (
          <section
            key={group.id}
            aria-label={group.label}
            className="overflow-hidden rounded-md border bg-white"
          >
            <div className="border-b bg-muted/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
            </div>
            <div className="divide-y">
              <ParameterRows
                definitions={group.definitions}
                values={values}
                errors={errors}
                disabled={disabled}
                onChange={onChange}
              />
            </div>
          </section>
        ))}
        {ungroupedDefinitions.length > 0 ? (
          <div className="divide-y rounded-md border bg-white">
            <ParameterRows
              definitions={ungroupedDefinitions}
              values={values}
              errors={errors}
              disabled={disabled}
              onChange={onChange}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="divide-y rounded-md border bg-white">
      <ParameterRows
        definitions={definitions}
        values={values}
        errors={errors}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

function ParameterRows({
  definitions,
  values,
  errors,
  disabled,
  onChange,
}: {
  definitions: ParameterDefinition[];
  values: Record<string, unknown>;
  errors: Record<string, string>;
  disabled: boolean;
  onChange: (values: Record<string, unknown>) => void;
}) {
  return definitions.map((definition) => (
    <ParameterRow
      key={definition.id}
      definition={definition}
      value={values[definition.id]}
      error={errors[definition.id]}
      disabled={disabled}
      onChange={(value) => onChange({ ...values, [definition.id]: value })}
    />
  ));
}

function ParameterRow({
  definition,
  value,
  error,
  disabled,
  onChange,
}: {
  definition: ParameterDefinition;
  value: unknown;
  error?: string;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  if (definition.valueType === "fieldGroupArray" && definition.repeatDefinition) {
    return (
      <div className={cn(error && "bg-destructive/5")}>
        <RepeaterControl
          definition={definition}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
        {error ? (
          <p className="px-4 pb-4 text-xs text-destructive">{error}</p>
        ) : null}
      </div>
    );
  }

  if (
    definition.valueType === "placements" ||
    definition.controlType === "placementList"
  ) {
    return (
      <div className={cn("px-4 py-4 text-sm", error && "bg-destructive/5")}>
        <div className="mb-3">
          <ParameterLabel definition={definition} />
        </div>
        <PrimitiveControl
          definition={definition}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.2fr)] gap-4 px-4 py-4 text-sm max-md:grid-cols-1",
        error && "bg-destructive/5",
      )}
    >
      <ParameterLabel definition={definition} />
      <div>
        <PrimitiveControl
          definition={definition}
          value={value}
          disabled={disabled}
          onChange={onChange}
        />
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
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
  const [beforeItemId, setBeforeItemId] = React.useState<string | null>(null);
  const selectedItem = repeatValue.items.find((item) => item.itemId === beforeItemId);
  const addButtonRef = React.useRef<HTMLButtonElement>(null);
  const itemHeadingRefs = React.useRef(new Map<string, HTMLHeadingElement>());
  const pendingFocusRef = React.useRef<{ itemId: string | null; scroll: boolean } | null>(null);
  const expectedValueRef = React.useRef<RepeatableGroupValue | null>(null);
  const previousPropsRef = React.useRef({ value, definitionId: definition.id });

  React.useLayoutEffect(() => {
    const previous = previousPropsRef.current;
    // Preserve the insertion anchor for our own edits, but reset on an external replacement.
    if (previous.definitionId !== definition.id ||
        (previous.value !== value && value !== expectedValueRef.current)) {
      setBeforeItemId(null);
      pendingFocusRef.current = null;
    }
    previousPropsRef.current = { value, definitionId: definition.id };
    expectedValueRef.current = null;
  }, [value, definition.id]);

  React.useLayoutEffect(() => {
    if (beforeItemId && !selectedItem) setBeforeItemId(null);
  }, [beforeItemId, selectedItem]);

  React.useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const target = pending.itemId
      ? itemHeadingRefs.current.get(pending.itemId)
      : addButtonRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    target.focus({ preventScroll: true });
    if (pending.scroll) {
      target.scrollIntoView({ behavior: "instant", block: "start", inline: "nearest" });
    }
  }, [repeatValue.items]);

  function changeValue(nextValue: RepeatableGroupValue) {
    expectedValueRef.current = nextValue;
    onChange(nextValue);
  }

  function addItem() {
    if (disabled) return;
    const nextValue = insertRepeatItem(definition, repeatValue, beforeItemId);
    if (nextValue === repeatValue) return;
    const existingIds = new Set(repeatValue.items.map((item) => item.itemId));
    const item = nextValue.items.find((nextItem) => !existingIds.has(nextItem.itemId))!;
    pendingFocusRef.current = { itemId: item.itemId, scroll: true };
    changeValue(nextValue);
  }

  function removeItem(itemId: string) {
    if (disabled) return;
    const nextValue = removeRepeatItem(definition, repeatValue, itemId);
    if (nextValue === repeatValue) return;
    const removedIndex = repeatValue.items.findIndex((item) => item.itemId === itemId);
    const focusItem = nextValue.items[removedIndex] ?? nextValue.items[removedIndex - 1];
    pendingFocusRef.current = { itemId: focusItem?.itemId ?? null, scroll: false };
    if (beforeItemId === itemId) setBeforeItemId(null);
    changeValue(nextValue);
  }

  function updateItemValues(itemIndex: number, values: Record<string, unknown>) {
    if (disabled) return;
    changeValue({
      items: repeatValue.items.map((item, index) =>
        index === itemIndex ? { ...item, values } : item,
      ),
    });
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-3">
        <ParameterLabel definition={definition} />
      </div>

      {canImportRepeatableGroupCsv(definition) ? (
        <RepeatableGroupCsvImport
          definition={definition}
          value={value}
          disabled={disabled}
          onImport={(imported) => {
            pendingFocusRef.current = null;
            setBeforeItemId(null);
            changeValue(imported);
          }}
        />
      ) : null}

      <div className="flex flex-col">
        {repeatValue.items.map((item, itemIndex) => (
          <React.Fragment key={item.itemId}>
            <button
              type="button"
              aria-label={`Insert before ${formatRepeatItemName(definition, item.index)} in ${definition.name}`}
              aria-pressed={beforeItemId === item.itemId}
              disabled={disabled || repeatValue.items.length >= maxItems}
              onClick={() => setBeforeItemId(item.itemId)}
              className={cn(
                "group flex h-8 w-full shrink-0 items-center gap-2 rounded-sm text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                beforeItemId === item.itemId ? "text-primary" : "text-muted-foreground hover:text-primary",
              )}
            >
              <span aria-hidden="true" className={cn("h-px flex-1 bg-border group-hover:bg-primary group-focus-visible:bg-primary", beforeItemId === item.itemId && "bg-primary")} />
              <span className={cn("opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100", beforeItemId === item.itemId && "opacity-100")}>
                Insert here
              </span>
              <span aria-hidden="true" className={cn("h-px flex-1 bg-border group-hover:bg-primary group-focus-visible:bg-primary", beforeItemId === item.itemId && "bg-primary")} />
            </button>
            <section className="rounded-md border bg-muted/20 p-3">
              <div className="mb-3 flex items-start justify-between gap-2">
                <h4
                  ref={(heading) => {
                    if (heading) itemHeadingRefs.current.set(item.itemId, heading);
                    else itemHeadingRefs.current.delete(item.itemId);
                  }}
                  tabIndex={-1}
                  className="min-w-0 rounded-sm text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {formatRepeatItemName(definition, item.index)}
                </h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="-mt-1 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${formatRepeatItemName(definition, item.index)} from ${definition.name}`}
                  title={`Delete ${formatRepeatItemName(definition, item.index)}`}
                  disabled={disabled || repeatValue.items.length <= minItems}
                  onClick={() => removeItem(item.itemId)}
                >
                  <X aria-hidden="true" />
                </Button>
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
          </React.Fragment>
        ))}
        {repeatValue.items.length === 0 ? (
          <div className="border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
            No items
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {selectedItem ? (
          <>
            <span role="status" className="mr-auto text-xs text-muted-foreground">
              Insert before {formatRepeatItemName(definition, selectedItem.index)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setBeforeItemId(null);
                const target = addButtonRef.current?.disabled
                  ? itemHeadingRefs.current.get(repeatValue.items.at(-1)!.itemId)
                  : addButtonRef.current;
                target?.focus({ preventScroll: true });
              }}
            >
              Add at end
            </Button>
          </>
        ) : null}
        <Button
          ref={addButtonRef}
          type="button"
          size="sm"
          disabled={disabled || repeatValue.items.length >= maxItems}
          onClick={addItem}
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
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
  if (definition.valueType === "placements" || definition.controlType === "placementList") {
    return (
      <PlacementListControl
        value={value}
        unit={definition.unit}
        disabled={disabled}
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
