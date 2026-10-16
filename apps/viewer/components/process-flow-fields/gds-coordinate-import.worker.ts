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
  type GdsRegionCollection,
  type Matrix,
} from "./gds-coordinate-geometry";
import {
  gdsElementMatchesCriteria,
  normalizeGdsImportCriteria,
  type GdsImportCriterion,
  type NormalizedGdsImportCriterion,
} from "./gds-import-criteria";

export type GdsImportRequest = {
  requestId: string;
  buffer: ArrayBuffer;
  criteria: GdsImportCriterion[];
  unit?: string | null;
  defeature?: boolean;
};

type GdsImportSuccess = GdsRegionCollection & {
  type: "success";
  requestId: string;
  matchedElements: number;
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

export type GdsImportResponse = GdsImportSuccess | GdsImportFailure;

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
  const criteria = normalizeGdsImportCriteria(request.criteria);
  const layout = parseLayout(request.buffer);
  const topCellNames = getTopCellNames(layout.structures);
  const coordinateScale = unitScale(layout.metersPerDbUnit, request.unit);
  const regionAccumulator = createGdsRegionAccumulator(request.defeature === true);
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
        if (!elementMatches(element, criteria, structure.name)) {
          return;
        }
        const sourcePoints = element.xy ?? [];
        const bounds = transformedBounds(sourcePoints, transform);
        if (!bounds) {
          return;
        }
        matchedElements += 1;
        const points = transformedPoints(sourcePoints, transform);
        // Repair in DB coordinates. UI-unit rounding can erase small notches
        // and treats negative half-grid coordinates differently from positive.
        const magnification = Math.hypot(transform[0], transform[1]);
        const coordinateMagnitude = points.reduce((value, point) => Math.max(value, Math.abs(point[0]), Math.abs(point[1])), 0);
        const tolerance = Math.max(
          COORDINATE_DUPLICATE_TOLERANCE * magnification,
          Number.EPSILON * coordinateMagnitude * 16,
          Number.MIN_VALUE,
        );
        regionAccumulator.add(targetRegion(points, bounds, tolerance), tolerance);
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

      if (elementMatches(element, criteria, structure.name)) {
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
    regions: regionCollection.regions.map((region) => scaleRegion(region, coordinateScale)),
    matchedElements,
    topCellNames,
    unsupportedElements,
    unresolvedReferences,
    cyclicReferences,
  };
}

function targetRegion(
  rawPoints: CoordinatePair[],
  bounds: CoordinateBounds,
  tolerance: number,
): GdsTargetRegion {
  const points = withoutClosingPoint(rawPoints, tolerance);
  if (isAxisAlignedRectangle(points, bounds)) {
    return { type: "rectangle", bounds };
  }
  if (points.length < 3) {
    throw new Error("Matched GDS boundary must contain at least three points.");
  }
  return { type: "polygon", points };
}

function withoutClosingPoint(points: CoordinatePair[], tolerance: number) {
  if (
    points.length > 1 &&
    pointsEqual(points[0], points[points.length - 1], tolerance)
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
  return new Set(points.map((point) => `${point[0]}:${point[1]}`)).size === 4 &&
    points.every((point, index) => {
      const next = points[(index + 1) % points.length];
      return corners.has(`${point[0]}:${point[1]}`) && (point[0] === next[0] || point[1] === next[1]);
    });
}

function scaleRegion(region: GdsTargetRegion, scale: number): GdsTargetRegion {
  const scalePoint = ([x, y]: CoordinatePair): CoordinatePair => [x * scale, y * scale];
  return region.type === "rectangle"
    ? { type: "rectangle", bounds: [scalePoint(region.bounds[0]), scalePoint(region.bounds[1])] }
    : { type: "polygon", points: region.points.map(scalePoint) };
}

function pointsEqual(left: CoordinatePair, right: CoordinatePair, tolerance: number) {
  return Math.abs(left[0] - right[0]) <= tolerance && Math.abs(left[1] - right[1]) <= tolerance;
}

function parseLayout(buffer: ArrayBuffer) {
  const structures = new Map<string, GdsStructure>();
  let metersPerDbUnit = 1;
  let currentStructure: GdsStructure | null = null;
  let currentElement: GdsElement | null = null;

  for (const record of parseGDS(new Uint8Array(buffer))) {
    if(record.tag === RecordType.ENDLIB) break;
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
  criteria: readonly NormalizedGdsImportCriterion[],
  cellName: string,
) {
  return gdsElementMatchesCriteria(
    criteria,
    element.layer,
    element.datatype,
    cellName,
  );
}
