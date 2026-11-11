import { describe, expect, it } from "vitest";
import { RecordType } from "gdsii";
import { parseGdsRecords, readGdsReal8 } from "./gds-records";

const hex = (value: string) => Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));

describe("GDS REAL8 precision", () => {
  it("reads the complete KLayout UNITS mantissas", () => {
    const bytes = hex("001403053e4189374bc6a7f03944b82fa09b5a54");
    expect([...parseGdsRecords(bytes)]).toEqual([{ tag: RecordType.UNITS, data: { userUnit: .001, metersPerUnit: 1e-9 } }]);
    expect(readGdsReal8(new DataView(bytes.buffer), 12) * 1e6 * 1500000).toBe(1500);
  });

  it("also corrects magnification and angle records, including signed values", () => {
    const bytes = hex("000c1b053e4189374bc6a7f0000c1c05be4189374bc6a7f0");
    expect([...parseGdsRecords(bytes)]).toEqual([
      { tag: RecordType.MAG, data: .001 }, { tag: RecordType.ANGLE, data: -.001 },
    ]);
  });

  it("respects a byte view offset and rejects truncated records", () => {
    const bytes = hex("ffff000c1b053e4189374bc6a7f0ffff");
    expect([...parseGdsRecords(bytes.subarray(2, -2))][0].data).toBe(.001);
    expect(() => [...parseGdsRecords(bytes.subarray(2, -3))]).toThrow("Invalid GDS record length");
    expect(() => [...parseGdsRecords(hex("0004"))]).toThrow("Truncated GDS record header");
  });
});
