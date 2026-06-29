export type CoordinateDraftCell = number | "";
export type CoordinateDraftRow = [CoordinateDraftCell, CoordinateDraftCell];
export type CoordinatePair = [number, number];

export const COORDINATE_DUPLICATE_TOLERANCE = 1e-6;

export function normalizeCoordinateRows(value: unknown): CoordinateDraftRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    if (!Array.isArray(item)) {
      return ["", ""];
    }
    return [toDraftCell(item[0]), toDraftCell(item[1])];
  });
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
