export type CoordinateDraftCell = number | "";
export type CoordinateDraftPoint = [CoordinateDraftCell, CoordinateDraftCell];
export type CoordinateDraftRow = [CoordinateDraftPoint, CoordinateDraftPoint];
export type CoordinatePair = [number, number];
export type CoordinateBounds = [CoordinatePair, CoordinatePair];

export const COORDINATE_DUPLICATE_TOLERANCE = 1e-6;

export function normalizeCoordinateRows(value: unknown): CoordinateDraftRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    if (!Array.isArray(item)) {
      return emptyCoordinateRow();
    }
    return [toDraftPoint(item[0]), toDraftPoint(item[1])];
  });
}

export function emptyCoordinateRow(): CoordinateDraftRow {
  return [["", ""], ["", ""]];
}

export function coordinateListValueIsComplete(value: unknown) {
  if (!Array.isArray(value)) {
    return false;
  }
  const rows = normalizeCoordinateRows(value);
  const diagnostics = analyzeCoordinateRows(rows);
  return (
    diagnostics.invalidRowIndexes.length === 0 &&
    diagnostics.invalidBoundsRowIndexes.length === 0 &&
    diagnostics.duplicateRowIndexes.length === 0
  );
}

export function analyzeCoordinateRows(rows: CoordinateDraftRow[]) {
  const invalidRowIndexes: number[] = [];
  const invalidBoundsRowIndexes: number[] = [];
  const duplicateRowIndexes: number[] = [];
  const seen: CoordinateBounds[] = [];

  rows.forEach((row, index) => {
    if (!isCompleteCoordinateRow(row)) {
      invalidRowIndexes.push(index);
      return;
    }
    if (!coordinateBoundsHaveArea(row)) {
      invalidBoundsRowIndexes.push(index);
      return;
    }
    if (seen.some((candidate) => coordinateBoundsEqual(candidate, row))) {
      duplicateRowIndexes.push(index);
      return;
    }
    seen.push(row);
  });

  return { invalidRowIndexes, invalidBoundsRowIndexes, duplicateRowIndexes };
}

export function isCompleteCoordinateRow(
  row: CoordinateDraftRow,
): row is CoordinateBounds {
  return row.every((point) =>
    point.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ),
  );
}

export function coordinateBoundsHaveArea(bounds: CoordinateBounds) {
  return bounds[1][0] > bounds[0][0] && bounds[1][1] > bounds[0][1];
}

export function coordinateBoundsEqual(
  left: CoordinateBounds,
  right: CoordinateBounds,
  tolerance = COORDINATE_DUPLICATE_TOLERANCE,
) {
  return left.every((point, pointIndex) =>
    point.every(
      (value, axisIndex) =>
        Math.abs(value - right[pointIndex][axisIndex]) <= tolerance,
    ),
  );
}

function toDraftPoint(value: unknown): CoordinateDraftPoint {
  if (!Array.isArray(value)) {
    return ["", ""];
  }
  return [toDraftCell(value[0]), toDraftCell(value[1])];
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
