import { RecordType, parseGDS } from "gdsii";

import {
  COORDINATE_DUPLICATE_TOLERANCE,
  coordinateKey,
  type CoordinatePair,
} from "./coordinate-list-value";

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
  coordinates: CoordinatePair[];
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

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

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
  const coordinates: CoordinatePair[] = [];
  const coordinateKeys = new Set<string>();
  const unsupportedElements: Record<string, number> = {};
  let matchedElements = 0;
  let duplicatesRemoved = 0;
  let unresolvedReferences = 0;
  let cyclicReferences = 0;

  const addCoordinate = (coordinate: CoordinatePair) => {
    const key = coordinateKey(coordinate, COORDINATE_DUPLICATE_TOLERANCE);
    if (coordinateKeys.has(key)) {
      duplicatesRemoved += 1;
      return;
    }
    coordinateKeys.add(key);
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
        const bottomLeft = transformedBottomLeft(element.xy ?? [], transform);
        if (!bottomLeft) {
          return;
        }
        matchedElements += 1;
        addCoordinate([
          bottomLeft[0] * coordinateScale,
          bottomLeft[1] * coordinateScale,
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

function transformedBottomLeft(points: CoordinatePair[], transform: Matrix) {
  if (points.length === 0) {
    return null;
  }
  const transformedPoints = points.map((point) => transformPoint(transform, point));
  const xs = transformedPoints.map((point) => point[0]);
  const ys = transformedPoints.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys)] satisfies CoordinatePair;
}

function referenceTransform(element: GdsElement, origin: CoordinatePair): Matrix {
  const angle = ((element.angle ?? 0) * Math.PI) / 180;
  const mag = element.mag ?? 1;
  const reflected = Boolean((element.strans ?? 0) & 0x8000);
  const scaleAndReflect: Matrix = [mag, 0, 0, reflected ? -mag : mag, 0, 0];
  return multiply(translation(origin[0], origin[1]), multiply(rotation(angle), scaleAndReflect));
}

function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

function rotation(angle: number): Matrix {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, 0, 0];
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformPoint(matrix: Matrix, point: CoordinatePair): CoordinatePair {
  return [
    matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
    matrix[1] * point[0] + matrix[3] * point[1] + matrix[5],
  ];
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
