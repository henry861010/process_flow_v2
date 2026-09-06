import { RecordType, parseGDS } from "gdsii";

import {
  COORDINATE_DUPLICATE_TOLERANCE,
  type CoordinateBounds,
  type CoordinatePair,
} from "./coordinate-list-value";
import {
  createGdsRegionAccumulator,
  IDENTITY,
  multiply,
  referenceTransform,
  transformedBounds,
  transformedPoints,
  unitScale,
  type GdsTargetRegion,
  type Matrix,
} from "./gds-coordinate-geometry";

type GdsImportRequest = {
  requestId: string;
  buffer: ArrayBuffer;
  layer: number;
  datatype: number;
  unit?: string | null;
  cellNameFilter?: {
    mode: "include" | "exclude";
    contains: string;
  };
  defeature?: {
    minimumFeatureSize: number;
  };
};

type GdsImportSuccess = {
  type: "success";
  requestId: string;
  regions: GdsTargetRegion[];
  matchedElements: number;
  duplicatesRemoved: number;
  defeaturedElements: number;
  nonOrthogonalRegions: number;
  topCellNames: string[];
  unsupportedElements: Record<string, number>;
  unresolvedReferences: number;
  cyclicReferences: number;
};

type GdsImportFailure = {
  type: "error";
  requestId: string;
  message: string;
};

type GdsElementKind =
  | "BOUNDARY"
  | "BOX"
  | "SREF"
  | "AREF"
  | "PATH"
  | "TEXT"
  | "NODE"
  | "TEXTNODE";

type GdsElement = {
  kind: GdsElementKind;
  layer?: number;
  datatype?: number;
  xy?: CoordinatePair[];
  sname?: string;
  colrow?: { columns: number; rows: number };
  strans?: number;
  mag?: number;
  angle?: number;
};

type NormalizedCellNameFilter = {
  mode: "include" | "exclude";
  contains: string;
};

type GdsStructure = {
  name: string;
  elements: GdsElement[];
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<GdsImportRequest>) => void) | null;
  postMessage: (message: GdsImportSuccess | GdsImportFailure) => void;
};

workerScope.onmessage = (event: MessageEvent<GdsImportRequest>) => {
  const { requestId } = event.data;
  try {
    const result = importCoordinates(event.data);
    workerScope.postMessage({
      type: "success",
      requestId,
      ...result,
    } satisfies GdsImportSuccess);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    } satisfies GdsImportFailure);
  }
};

function importCoordinates(request: GdsImportRequest) {
  const layout = parseLayout(request.buffer);
  const topCellNames = getTopCellNames(layout.structures);
  const coordinateScale = unitScale(layout.metersPerDbUnit, request.unit);
  const cellNameFilter = normalizeCellNameFilter(request.cellNameFilter);
  const minimumFeatureSize = normalizeMinimumFeatureSize(request.defeature);
  const regionAccumulator = createGdsRegionAccumulator(minimumFeatureSize);
  const unsupportedElements: Record<string, number> = {};
  let matchedElements = 0;
  let unresolvedReferences = 0;
  let cyclicReferences = 0;

  const visitStructure = (
    structureName: string,
    transform: Matrix,
    stack: Set<string>,
  ) => {
    if (stack.has(structureName)) {
      cyclicReferences += 1;
      return;
    }
    const structure = layout.structures.get(structureName);
    if (!structure) {
      unresolvedReferences += 1;
      return;
    }

    stack.add(structureName);
    structure.elements.forEach((element) => {
      if (element.kind === "BOUNDARY" || element.kind === "BOX") {
        if (
          !elementMatches(
            element,
            request.layer,
            request.datatype,
            structure.name,
            cellNameFilter,
          )
        ) {
          return;
        }
        const sourcePoints = element.xy ?? [];
        const bounds = transformedBounds(sourcePoints, transform);
        if (!bounds) {
          return;
        }
        matchedElements += 1;
        const scaledBounds: CoordinateBounds = [
          [
            scaledCoordinate(bounds[0][0], coordinateScale),
            scaledCoordinate(bounds[0][1], coordinateScale),
          ],
          [
            scaledCoordinate(bounds[1][0], coordinateScale),
            scaledCoordinate(bounds[1][1], coordinateScale),
          ],
        ];
        const points = transformedPoints(sourcePoints, transform).map(
          (point): CoordinatePair => [
            scaledCoordinate(point[0], coordinateScale),
            scaledCoordinate(point[1], coordinateScale),
          ],
        );
        regionAccumulator.add(targetRegion(element.kind, points, scaledBounds));
        return;
      }

      if (element.kind === "SREF") {
        const origin = element.xy?.[0];
        if (!origin || !element.sname) {
          unresolvedReferences += 1;
          return;
        }
        visitStructure(
          element.sname,
          multiply(transform, referenceTransform(element, origin)),
          stack,
        );
        return;
      }

      if (element.kind === "AREF") {
        if (!element.sname || !element.xy || element.xy.length < 3) {
          unresolvedReferences += 1;
          return;
        }
        const columns = Math.max(1, element.colrow?.columns ?? 1);
        const rows = Math.max(1, element.colrow?.rows ?? 1);
        const [origin, columnEndpoint, rowEndpoint] = element.xy;
        const columnVector: CoordinatePair = [
          (columnEndpoint[0] - origin[0]) / columns,
          (columnEndpoint[1] - origin[1]) / columns,
        ];
        const rowVector: CoordinatePair = [
          (rowEndpoint[0] - origin[0]) / rows,
          (rowEndpoint[1] - origin[1]) / rows,
        ];
        for (let column = 0; column < columns; column += 1) {
          for (let row = 0; row < rows; row += 1) {
            const placementOrigin: CoordinatePair = [
              origin[0] + columnVector[0] * column + rowVector[0] * row,
              origin[1] + columnVector[1] * column + rowVector[1] * row,
            ];
            visitStructure(
              element.sname,
              multiply(transform, referenceTransform(element, placementOrigin)),
              stack,
            );
          }
        }
        return;
      }

      if (
        elementMatches(
          element,
          request.layer,
          request.datatype,
          structure.name,
          cellNameFilter,
        )
      ) {
        unsupportedElements[element.kind] =
          (unsupportedElements[element.kind] ?? 0) + 1;
      }
    });
    stack.delete(structureName);
  };

  topCellNames.forEach((name) =>
    visitStructure(name, IDENTITY, new Set()),
  );

  const regionCollection = regionAccumulator.result();

  return {
    ...regionCollection,
    matchedElements,
    topCellNames,
    unsupportedElements,
    unresolvedReferences,
    cyclicReferences,
  };
}

function targetRegion(
  _kind: "BOUNDARY" | "BOX",
  rawPoints: CoordinatePair[],
  bounds: CoordinateBounds,
): GdsTargetRegion {
  const points = withoutClosingPoint(rawPoints);
  if (isAxisAlignedRectangle(points, bounds)) {
    return { type: "rectangle", bounds };
  }
  if (points.length < 3) {
    throw new Error("Matched GDS boundary must contain at least three points.");
  }
  return { type: "polygon", points };
}

function withoutClosingPoint(points: CoordinatePair[]) {
  if (
    points.length > 1 &&
    pointsEqual(points[0], points[points.length - 1])
  ) {
    return points.slice(0, -1);
  }
  return points;
}

function isAxisAlignedRectangle(
  points: CoordinatePair[],
  bounds: CoordinateBounds,
) {
  if (points.length !== 4) return false;
  const corners = new Set([
    `${bounds[0][0]}:${bounds[0][1]}`,
    `${bounds[1][0]}:${bounds[0][1]}`,
    `${bounds[1][0]}:${bounds[1][1]}`,
    `${bounds[0][0]}:${bounds[1][1]}`,
  ]);
  return points.every((point) => corners.has(`${point[0]}:${point[1]}`));
}

function quantized(value: number) {
  return Math.round(value / COORDINATE_DUPLICATE_TOLERANCE);
}

function scaledCoordinate(value: number, scale: number) {
  return quantized(value * scale) * COORDINATE_DUPLICATE_TOLERANCE;
}

function pointsEqual(left: CoordinatePair, right: CoordinatePair) {
  return (
    Math.abs(left[0] - right[0]) <= COORDINATE_DUPLICATE_TOLERANCE &&
    Math.abs(left[1] - right[1]) <= COORDINATE_DUPLICATE_TOLERANCE
  );
}

function parseLayout(buffer: ArrayBuffer) {
  const structures = new Map<string, GdsStructure>();
  let metersPerDbUnit = 1;
  let currentStructure: GdsStructure | null = null;
  let currentElement: GdsElement | null = null;

  for (const record of parseGDS(new Uint8Array(buffer))) {
    switch (record.tag) {
      case RecordType.UNITS:
        metersPerDbUnit = record.data.metersPerUnit;
        break;
      case RecordType.BGNSTR:
        currentStructure = { name: "", elements: [] };
        break;
      case RecordType.STRNAME:
        if (currentStructure) {
          currentStructure.name = record.data;
        }
        break;
      case RecordType.ENDSTR:
        if (currentStructure?.name) {
          structures.set(currentStructure.name, currentStructure);
        }
        currentStructure = null;
        break;
      case RecordType.BOUNDARY:
        currentElement = { kind: "BOUNDARY" };
        break;
      case RecordType.BOX:
        currentElement = { kind: "BOX" };
        break;
      case RecordType.SREF:
        currentElement = { kind: "SREF" };
        break;
      case RecordType.AREF:
        currentElement = { kind: "AREF" };
        break;
      case RecordType.PATH:
        currentElement = { kind: "PATH" };
        break;
      case RecordType.TEXT:
        currentElement = { kind: "TEXT" };
        break;
      case RecordType.NODE:
        currentElement = { kind: "NODE" };
        break;
      case RecordType.TEXTNODE:
        currentElement = { kind: "TEXTNODE" };
        break;
      case RecordType.LAYER:
        if (currentElement) {
          currentElement.layer = record.data;
        }
        break;
      case RecordType.DATATYPE:
      case RecordType.BOXTYPE:
      case RecordType.TEXTTYPE:
      case RecordType.NODETYPE:
        if (currentElement) {
          currentElement.datatype = record.data;
        }
        break;
      case RecordType.XY:
        if (currentElement) {
          currentElement.xy = record.data;
        }
        break;
      case RecordType.SNAME:
        if (currentElement) {
          currentElement.sname = record.data;
        }
        break;
      case RecordType.COLROW:
        if (currentElement) {
          currentElement.colrow = record.data;
        }
        break;
      case RecordType.STRANS:
        if (currentElement) {
          currentElement.strans = record.data;
        }
        break;
      case RecordType.MAG:
        if (currentElement) {
          currentElement.mag = record.data;
        }
        break;
      case RecordType.ANGLE:
        if (currentElement) {
          currentElement.angle = record.data;
        }
        break;
      case RecordType.ENDEL:
        if (currentStructure && currentElement) {
          currentStructure.elements.push(currentElement);
        }
        currentElement = null;
        break;
      default:
        break;
    }
  }

  return { metersPerDbUnit, structures };
}

function getTopCellNames(structures: Map<string, GdsStructure>) {
  const referencedNames = new Set<string>();
  structures.forEach((structure) => {
    structure.elements.forEach((element) => {
      if ((element.kind === "SREF" || element.kind === "AREF") && element.sname) {
        referencedNames.add(element.sname);
      }
    });
  });

  const topCellNames = [...structures.keys()].filter(
    (name) => !referencedNames.has(name),
  );
  return topCellNames.length > 0 ? topCellNames : [...structures.keys()];
}

function elementMatches(
  element: GdsElement,
  layer: number,
  datatype: number,
  cellName: string,
  cellNameFilter: NormalizedCellNameFilter | null,
) {
  if (element.layer !== layer || element.datatype !== datatype) {
    return false;
  }
  return cellNameMatches(cellName, cellNameFilter);
}

function normalizeCellNameFilter(
  cellNameFilter: GdsImportRequest["cellNameFilter"],
): NormalizedCellNameFilter | null {
  const contains = cellNameFilter?.contains.trim().toLowerCase();
  if (!cellNameFilter || !contains) {
    return null;
  }
  return { mode: cellNameFilter.mode, contains };
}

function normalizeMinimumFeatureSize(
  defeature: GdsImportRequest["defeature"],
) {
  if (!defeature) return undefined;
  const minimumFeatureSize = defeature.minimumFeatureSize;
  if (!Number.isFinite(minimumFeatureSize) || minimumFeatureSize <= 0) {
    throw new Error("Minimum feature size must be a finite number greater than zero.");
  }
  return minimumFeatureSize;
}

function cellNameMatches(
  cellName: string,
  cellNameFilter: NormalizedCellNameFilter | null,
) {
  if (!cellNameFilter) {
    return true;
  }
  const matched = cellName.toLowerCase().includes(cellNameFilter.contains);
  return cellNameFilter.mode === "include" ? matched : !matched;
}
