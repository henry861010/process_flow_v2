import { RecordType } from "gdsii";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { CoordinatePair } from "./coordinate-list-value";
import type { GdsTargetRegion } from "./gds-coordinate-geometry";
import type { GdsImportRequest, GdsImportResponse } from "./gds-coordinate-import.worker";
import {
  adjacentRectangle, insideOutline, rectangularSteppedNotches, rectangularVerticalNotch,
  sameOutline, steppedNotches, verticalNotch,
} from "./gds-test-fixtures";

// Encode real GDS records in memory and exercise the actual Worker handler,
// including the installed parser, rather than mocking parsed elements.
function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function record(tag: number, data = new Uint8Array()) {
  const bytes = new Uint8Array(4 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, bytes.length);
  view.setUint16(2, tag);
  bytes.set(data, 4);
  return bytes;
}
function text(tag: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  return record(tag, concat([bytes, new Uint8Array(bytes.length % 2)]));
}
function integers(tag: number, values: number[], size = 4) {
  const bytes = new Uint8Array(values.length * size);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => size === 4 ? view.setInt32(index * size, value) : view.setInt16(index * size, value));
  return record(tag, bytes);
}
function real8(value: number) {
  const bytes = new Uint8Array(8);
  if (value === 0) return bytes;
  let fraction = Math.abs(value);
  let exponent = 64;
  while (fraction >= 1) { fraction /= 16; exponent += 1; }
  while (fraction < 1 / 16) { fraction *= 16; exponent -= 1; }
  bytes[0] = exponent | (value < 0 ? 128 : 0);
  for (let index = 1; index < 8; index += 1) {
    fraction *= 256;
    bytes[index] = Math.floor(fraction);
    fraction -= bytes[index];
  }
  return bytes;
}
function structure(name: string, elements: Uint8Array[]) {
  return concat([record(RecordType.BGNSTR, new Uint8Array(24)), text(RecordType.STRNAME, name), ...elements, record(RecordType.ENDSTR)]);
}
function boundary(points: CoordinatePair[], layer = 1) {
  return concat([
    record(RecordType.BOUNDARY), integers(RecordType.LAYER, [layer], 2), integers(RecordType.DATATYPE, [0], 2),
    integers(RecordType.XY, [...points, points[0]].flat()), record(RecordType.ENDEL),
  ]);
}
function reference(name: string, origin: CoordinatePair, options: {
  angle?: number; reflected?: boolean; mag?: number;
  array?: { columns: number; rows: number; column: CoordinatePair; row: CoordinatePair };
} = {}) {
  const array = options.array;
  const points = array ? [origin,
    [origin[0] + array.column[0] * array.columns, origin[1] + array.column[1] * array.columns],
    [origin[0] + array.row[0] * array.rows, origin[1] + array.row[1] * array.rows],
  ] : [origin];
  return concat([
    record(array ? RecordType.AREF : RecordType.SREF), text(RecordType.SNAME, name),
    ...(options.reflected ? [integers(RecordType.STRANS, [-32768], 2)] : []),
    ...(options.mag === undefined ? [] : [record(RecordType.MAG, real8(options.mag))]),
    ...(options.angle === undefined ? [] : [record(RecordType.ANGLE, real8(options.angle))]),
    ...(array ? [integers(RecordType.COLROW, [array.columns, array.rows], 2)] : []),
    integers(RecordType.XY, points.flat()), record(RecordType.ENDEL),
  ]);
}
function library(structures: Uint8Array[]) {
  return concat([
    integers(RecordType.HEADER, [600], 2), record(RecordType.BGNLIB, new Uint8Array(24)), text(RecordType.LIBNAME, "SYNTHETIC"),
    record(RecordType.UNITS, concat([real8(0.001), real8(1e-9)])), ...structures, record(RecordType.ENDLIB),
  ]).buffer as ArrayBuffer;
}
function points(region: GdsTargetRegion): CoordinatePair[] {
  if (region.type === "polygon") return region.points;
  const [[left, bottom], [right, top]] = region.bounds;
  return [[left, bottom], [right, bottom], [right, top], [left, top]];
}

const scope = {
  onmessage: null as ((event: MessageEvent<GdsImportRequest>) => void) | null,
  response: null as GdsImportResponse | null,
  postMessage(response: GdsImportResponse) { this.response = response; },
};
beforeAll(async () => {
  vi.stubGlobal("self", scope);
  await import("./gds-coordinate-import.worker");
});
afterAll(() => { vi.unstubAllGlobals(); });

function run(buffer: ArrayBuffer, options: Partial<GdsImportRequest> = {}) {
  scope.response = null;
  scope.onmessage!({ data: {
    requestId: "synthetic", buffer, criteria: [{ layer: 1, datatype: 0 }], unit: "nm", defeature: true, ...options,
  } } as MessageEvent<GdsImportRequest>);
  const response = scope.response!;
  expect(response.requestId).toBe("synthetic");
  if (response.type === "error") throw new Error(response.message);
  return response;
}

const quadrants = [
  { origin: [100, 100] as CoordinatePair, reflected: true, angle: 0, sx: 1, sy: 1 },
  { origin: [-100, 100] as CoordinatePair, reflected: false, angle: 180, sx: -1, sy: 1 },
  { origin: [-100, -100] as CoordinatePair, reflected: true, angle: 180, sx: -1, sy: -1 },
  { origin: [100, -100] as CoordinatePair, reflected: false, angle: 0, sx: 1, sy: -1 },
];
const symmetricLayout = () => library([
  structure("QUADRANT", [boundary(steppedNotches), boundary(verticalNotch), boundary(adjacentRectangle)]),
  structure("GROUP", [reference("QUADRANT", [0, 0], { reflected: true, mag: 2 })]),
  structure("TOP", quadrants.map(({ origin, reflected, angle }) => reference("GROUP", origin, { reflected, angle, mag: 0.25 }))),
]);

describe("GDS Worker geometry integration", () => {
  it("preserves the stepped outline, recesses and separation in all four nested mirrored quadrants", () => {
    const response = run(symmetricLayout());
    expect(response.regions).toHaveLength(12);
    expect(response.repairedElements).toBe(8);
    expect(response.unrepairedElements).toBe(0);
    expect(response.nonOrthogonalRegions).toBe(0);
    expect(response.repairDiagnostics).toEqual([]);
    quadrants.forEach(({ origin, sx, sy }, quadrant) => {
      const transform = ([x, y]: CoordinatePair): CoordinatePair => [origin[0] + sx * x / 2, origin[1] + sy * y / 2];
      [rectangularSteppedNotches, rectangularVerticalNotch, adjacentRectangle].forEach((outline, element) => {
        expect(sameOutline(points(response.regions[quadrant * 3 + element]), outline.map(transform))).toBe(true);
      });
      const main = points(response.regions[quadrant * 3]);
      expect(insideOutline(main, transform([17, 15]))).toBe(false);
      expect(insideOutline(main, transform([6.5, 18]))).toBe(false);
      expect(insideOutline(main, transform([16, 8]))).toBe(false);
    });
  });

  it("keeps the exact transformed polygons with defeature off", () => {
    const response = run(symmetricLayout(), { defeature: false });
    expect(response.repairedElements).toBe(0);
    expect(response.unrepairedElements).toBe(0);
    expect(response.nonOrthogonalRegions).toBe(8);
    quadrants.forEach(({ origin, sx, sy }, quadrant) => {
      const transform = ([x, y]: CoordinatePair): CoordinatePair => [origin[0] + sx * x / 2, origin[1] + sy * y / 2];
      expect(sameOutline(points(response.regions[quadrant * 3]), steppedNotches.map(transform))).toBe(true);
    });
  });

  it.each([["nm", 1], ["um", 1e-3], ["mm", 1e-6]] as const)("repairs the same physical outline in %s without rounding fractional vertices", (unit, scale) => {
    const response = run(symmetricLayout(), { unit });
    expect(response.repairedElements).toBe(8);
    expect(response.nonOrthogonalRegions).toBe(0);
    quadrants.forEach(({ origin, sx, sy }, quadrant) => {
      const expected = rectangularSteppedNotches.map(([x, y]): CoordinatePair => [origin[0] + sx * x / 2, origin[1] + sy * y / 2]);
      const normalized = points(response.regions[quadrant * 3]).map(([x, y]): CoordinatePair => [x / scale, y / scale]);
      expect(sameOutline(normalized, expected)).toBe(true);
    });
  });

  it("does not collapse sub-grid vertices and keeps opposite half-grid coordinates symmetric", () => {
    const buffer = library([
      structure("SMALL", [boundary([[1, 1], [7, 1], [7, 9], [1, 9]])]),
      structure("TOP", [reference("SMALL", [0, 0], { mag: 0.5 }), reference("SMALL", [0, 0], { mag: 0.5, angle: 180 })]),
    ]);
    const response = run(buffer, { unit: "mm" });
    const positive = points(response.regions[0]);
    const negative = points(response.regions[1]);
    expect(sameOutline(negative, positive.map(([x, y]) => [-x, -y]), 1e-18)).toBe(true);
    expect(Math.max(...positive.map(([x]) => x))).toBeCloseTo(3.5e-6, 16);
    expect(Math.min(...positive.map(([x]) => x))).toBeCloseTo(0.5e-6, 16);
  });

  it("expands rotated reflected AREFs with their parent-coordinate array vectors", () => {
    const response = run(library([
      structure("CHILD", [boundary(steppedNotches)]),
      structure("TOP", [reference("CHILD", [-100, -100], {
        angle: 90, reflected: true, mag: 2,
        array: { columns: 2, rows: 2, column: [60, 0], row: [0, 60] },
      })]),
    ]));
    expect(response.regions).toHaveLength(4);
    for (let column = 0; column < 2; column += 1) {
      for (let row = 0; row < 2; row += 1) {
        const expected = rectangularSteppedNotches.map(([x, y]): CoordinatePair => [-100 + column * 60 + y * 2, -100 + row * 60 + x * 2]);
        expect(sameOutline(points(response.regions[column * 2 + row]), expected)).toBe(true);
      }
    }
  });

  it("deduplicates preserved outlines and reports their final region indices while importing other repairs", () => {
    const diamond: CoordinatePair[] = [[-10, 0], [0, 10], [10, 0], [0, -10]];
    const response = run(library([structure("TOP", [
      boundary(steppedNotches), boundary(diamond), boundary([...diamond].reverse(), 2),
    ])]), { criteria: [{ layer: 1, datatype: 0 }, { layer: 2, datatype: 0 }] });
    expect(response.regions).toHaveLength(2);
    expect(response.matchedElements).toBe(3);
    expect(response.duplicatesRemoved).toBe(1);
    expect(response.repairedElements).toBe(1);
    expect(response.unrepairedElements).toBe(2);
    expect(response.nonOrthogonalRegions).toBe(1);
    expect(response.repairDiagnostics).toEqual([{ regionIndex: 1, reason: "unrecognized-outline" }]);
    expect(sameOutline(points(response.regions[1]), diamond)).toBe(true);
  });

  it("reports malformed input through the Worker failure response", () => {
    scope.onmessage!({ data: { requestId: "bad", buffer: new ArrayBuffer(4), criteria: [{ layer: 1, datatype: 0 }] } } as MessageEvent<GdsImportRequest>);
    expect(scope.response).toMatchObject({ type: "error", requestId: "bad" });
  });
});
