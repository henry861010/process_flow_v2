import { RecordType, parseGDS } from "gdsii";

import {
  COORDINATE_DUPLICATE_TOLERANCE,
  coordinateBoundsEqual,
  type CoordinateBounds,
  type CoordinatePair,
} from "./coordinate-list-value";
import {
  IDENTITY,
  multiply,
  referenceTransform,
  transformedBounds,
  type Matrix,
} from "./gds-coordinate-geometry";

type GdsImportRequest = {
  requestId: string;
  buffer: ArrayBuffer;
  layer: number;
  datatype: number;
  unit?: string | null;
};

type GdsImportSuccess = {
  type: "success";
  requestId: string;
  coordinates: CoordinateBounds[];
  matchedElements: number;
  duplicatesRemoved: number;
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
  const coordinates: CoordinateBounds[] = [];
  const coordinateBuckets = new Map<string, CoordinateBounds[]>();
  const unsupportedElements: Record<string, number> = {};
  let matchedElements = 0;
  let duplicatesRemoved = 0;
  let unresolvedReferences = 0;
  let cyclicReferences = 0;

  const addCoordinate = (coordinate: CoordinateBounds) => {
    const duplicate = coordinateNeighborBucketKeys(coordinate).some((key) =>
      (coordinateBuckets.get(key) ?? []).some((candidate) =>
        coordinateBoundsEqual(candidate, coordinate),
      ),
    );
    if (duplicate) {
      duplicatesRemoved += 1;
      return;
    }
    const bucketKey = coordinateBucketKey(coordinate);
    coordinateBuckets.set(bucketKey, [
      ...(coordinateBuckets.get(bucketKey) ?? []),
      coordinate,
    ]);
    coordinates.push(coordinate);
  };

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
        if (!elementMatches(element, request.layer, request.datatype)) {
          return;
        }
        const bounds = transformedBounds(element.xy ?? [], transform);
        if (!bounds) {
          return;
        }
        matchedElements += 1;
        addCoordinate([
          [bounds[0][0] * coordinateScale, bounds[0][1] * coordinateScale],
          [bounds[1][0] * coordinateScale, bounds[1][1] * coordinateScale],
        ]);
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

      if (elementMatches(element, request.layer, request.datatype)) {
        unsupportedElements[element.kind] =
          (unsupportedElements[element.kind] ?? 0) + 1;
      }
    });
    stack.delete(structureName);
  };

  topCellNames.forEach((name) => visitStructure(name, IDENTITY, new Set()));

  return {
    coordinates,
    matchedElements,
    duplicatesRemoved,
    topCellNames,
    unsupportedElements,
    unresolvedReferences,
    cyclicReferences,
  };
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

function elementMatches(element: GdsElement, layer: number, datatype: number) {
  return element.layer === layer && element.datatype === datatype;
}

function unitScale(metersPerDbUnit: number, unit?: string | null) {
  const normalized = unit?.trim().toLowerCase();
  if (!normalized) {
    return 1;
  }
  if (normalized === "m" || normalized === "meter" || normalized === "meters") {
    return metersPerDbUnit;
  }
  if (normalized === "mm" || normalized === "millimeter" || normalized === "millimeters") {
    return metersPerDbUnit * 1e3;
  }
  if (
    normalized === "um" ||
    normalized === "µm" ||
    normalized === "micron" ||
    normalized === "microns" ||
    normalized === "micrometer" ||
    normalized === "micrometers"
  ) {
    return metersPerDbUnit * 1e6;
  }
  if (normalized === "nm" || normalized === "nanometer" || normalized === "nanometers") {
    return metersPerDbUnit * 1e9;
  }
  return 1;
}

function coordinateBucketKey(bounds: CoordinateBounds) {
  return coordinateBucketIndexes(bounds).join(":");
}

function coordinateNeighborBucketKeys(bounds: CoordinateBounds) {
  const [xMin, yMin, xMax, yMax] = coordinateBucketIndexes(bounds);
  const keys: string[] = [];
  for (let dxMin = -1; dxMin <= 1; dxMin += 1) {
    for (let dyMin = -1; dyMin <= 1; dyMin += 1) {
      for (let dxMax = -1; dxMax <= 1; dxMax += 1) {
        for (let dyMax = -1; dyMax <= 1; dyMax += 1) {
          keys.push(
            [
              xMin + dxMin,
              yMin + dyMin,
              xMax + dxMax,
              yMax + dyMax,
            ].join(":"),
          );
        }
      }
    }
  }
  return keys;
}

function coordinateBucketIndexes(bounds: CoordinateBounds) {
  return [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]].map(
    (value) => Math.floor(value / COORDINATE_DUPLICATE_TOLERANCE),
  );
}
