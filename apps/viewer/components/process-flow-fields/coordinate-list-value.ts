export type CoordinateDraftCell = number | "";
export type CoordinateDraftRow = [CoordinateDraftCell, CoordinateDraftCell];
export type CoordinatePair = [number, number];

export const COORDINATE_DUPLICATE_TOLERANCE = 1e-6;

export function normalizeCoordinateRows(value: unknown): CoordinateDraftRow[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!Array.isArray(item)) {
        return ["", ""];
      }
      return [toDraftCell(item[0]), toDraftCell(item[1])];
    });
  }

  const legacyRows = legacyRepeaterCoordinateRows(value);
  return legacyRows ?? [];
}

export function coordinateListValueIsComplete(value: unknown) {
  if (!Array.isArray(value)) {
    return false;
  }
  const rows = normalizeCoordinateRows(value);
  const diagnostics = analyzeCoordinateRows(rows);
  return (
    diagnostics.invalidRowIndexes.length === 0 &&
    diagnostics.duplicateRowIndexes.length === 0
  );
}

export function analyzeCoordinateRows(rows: CoordinateDraftRow[]) {
  const invalidRowIndexes: number[] = [];
  const duplicateRowIndexes: number[] = [];
  const seenKeys = new Set<string>();

  rows.forEach((row, index) => {
    if (!isCompleteCoordinateRow(row)) {
      invalidRowIndexes.push(index);
      return;
    }
    const key = coordinateKey(row);
    if (seenKeys.has(key)) {
      duplicateRowIndexes.push(index);
      return;
    }
    seenKeys.add(key);
  });

  return { invalidRowIndexes, duplicateRowIndexes };
}

export function isCompleteCoordinateRow(
  row: CoordinateDraftRow,
): row is CoordinatePair {
  return (
    typeof row[0] === "number" &&
    Number.isFinite(row[0]) &&
    typeof row[1] === "number" &&
    Number.isFinite(row[1])
  );
}

export function coordinateKey(
  pair: CoordinatePair,
  tolerance = COORDINATE_DUPLICATE_TOLERANCE,
) {
  return `${Math.round(pair[0] / tolerance)}:${Math.round(pair[1] / tolerance)}`;
}

function toDraftCell(value: unknown): CoordinateDraftCell {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : "";
  }
  return "";
}

function legacyRepeaterCoordinateRows(value: unknown): CoordinateDraftRow[] | null {
  if (!value || typeof value !== "object" || !("items" in value)) {
    return null;
  }
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return null;
  }
  return items.map((item) => {
    const fieldValues =
      item && typeof item === "object" && "fieldValues" in item
        ? (item as { fieldValues?: unknown }).fieldValues
        : null;
    if (!Array.isArray(fieldValues)) {
      return ["", ""];
    }
    return [
      toDraftCell(findLegacyFieldValue(fieldValues, "bottemLeftX", "bottomLeftX")),
      toDraftCell(findLegacyFieldValue(fieldValues, "bottemLeftY", "bottomLeftY")),
    ];
  });
}

function findLegacyFieldValue(
  fieldValues: unknown[],
  primaryFieldId: string,
  fallbackFieldId: string,
) {
  const target = fieldValues.find(
    (fieldValue) =>
      fieldValue &&
      typeof fieldValue === "object" &&
      "fieldId" in fieldValue &&
      ((fieldValue as { fieldId?: unknown }).fieldId === primaryFieldId ||
        (fieldValue as { fieldId?: unknown }).fieldId === fallbackFieldId),
  );
  return target && typeof target === "object" && "value" in target
    ? (target as { value?: unknown }).value
    : undefined;
}
