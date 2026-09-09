export type CellNameFilterMode = "include" | "exclude";

export type GdsImportCriterion = {
  layer: number;
  datatype: number;
  cellNameFilter?: {
    mode: CellNameFilterMode;
    contains: string;
  };
};

export type NormalizedGdsImportCriterion = {
  layer: number;
  datatype: number;
  cellNameFilter: {
    mode: CellNameFilterMode;
    contains: string;
  } | null;
};

export function parseGdsIntegerInput(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function gdsImportCriterionKey(layer: number, datatype: number) {
  return `${layer}:${datatype}`;
}

export function duplicateGdsImportCriterionKeys(
  criteria: ReadonlyArray<Pick<GdsImportCriterion, "layer" | "datatype">>,
) {
  const counts = new Map<string, number>();
  criteria.forEach(({ layer, datatype }) => {
    const key = gdsImportCriterionKey(layer, datatype);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
}

export function normalizeGdsImportCriteria(
  criteria: readonly GdsImportCriterion[],
): NormalizedGdsImportCriterion[] {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new Error("At least one GDS layer/datatype pattern is required.");
  }

  criteria.forEach((criterion) => {
    if (
      !Number.isSafeInteger(criterion.layer) ||
      criterion.layer < 0 ||
      !Number.isSafeInteger(criterion.datatype) ||
      criterion.datatype < 0
    ) {
      throw new Error("GDS layer and datatype must be non-negative integers.");
    }
  });

  if (duplicateGdsImportCriterionKeys(criteria).size > 0) {
    throw new Error("GDS layer/datatype patterns must be unique.");
  }

  return criteria.map((criterion) => {
    const contains = criterion.cellNameFilter?.contains.trim().toLowerCase();
    if (!criterion.cellNameFilter || !contains) {
      return { ...criterion, cellNameFilter: null };
    }
    if (
      criterion.cellNameFilter.mode !== "include" &&
      criterion.cellNameFilter.mode !== "exclude"
    ) {
      throw new Error("GDS cell name filter mode must be include or exclude.");
    }
    return {
      ...criterion,
      cellNameFilter: {
        mode: criterion.cellNameFilter.mode,
        contains,
      },
    };
  });
}

export function gdsElementMatchesCriteria(
  criteria: readonly NormalizedGdsImportCriterion[],
  layer: number | undefined,
  datatype: number | undefined,
  cellName: string,
) {
  const criterion = criteria.find(
    (candidate) =>
      candidate.layer === layer && candidate.datatype === datatype,
  );
  if (!criterion) return false;
  if (!criterion.cellNameFilter) return true;

  const matched = cellName
    .toLowerCase()
    .includes(criterion.cellNameFilter.contains);
  return criterion.cellNameFilter.mode === "include" ? matched : !matched;
}
