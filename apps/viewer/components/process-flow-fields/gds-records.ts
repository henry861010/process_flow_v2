import { GDSParseError, parseGDS, RecordType, type GDSRecord } from "gdsii";

/** Decode all 56 mantissa bits, rounding only once to a JavaScript number. */
export function readGdsReal8(view: DataView, offset: number): number {
  const header = view.getUint8(offset);
  let mantissa = BigInt(0);
  for (let index = 1; index < 8; index += 1) {
    mantissa = (mantissa << BigInt(8)) | BigInt(view.getUint8(offset + index));
  }
  if (mantissa === BigInt(0)) return 0;
  return (header & 0x80 ? -1 : 1) * Number(mantissa) * 2 ** (4 * ((header & 0x7f) - 64) - 56);
}

/** gdsii 0.1.0 drops the last REAL8 byte. Keep its record model, decode reals here. */
export function* parseGdsRecords(bytes: Uint8Array): Generator<GDSRecord> {
  // The dependency constructs DataView(bytes.buffer) without the view offset.
  const input = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  const view = new DataView(input.buffer);
  const records = parseGDS(input);
  let offset = 0;
  while (offset < input.length) {
    if (offset + 4 > input.length) throw new GDSParseError("Truncated GDS record header");
    const length = view.getUint16(offset);
    if (length < 4 || length % 2 !== 0 || offset + length > input.length) {
      throw new GDSParseError(`Invalid GDS record length: ${length}`);
    }
    const next = records.next();
    if (next.done) throw new GDSParseError("Missing GDS record");
    const record = next.value;
    if (record.tag === RecordType.UNITS) {
      if (length !== 20) throw new GDSParseError("Invalid GDS UNITS length");
      yield { ...record, data: { userUnit: readGdsReal8(view, offset + 4), metersPerUnit: readGdsReal8(view, offset + 12) } };
    } else if (record.tag === RecordType.MAG || record.tag === RecordType.ANGLE) {
      if (length !== 12) throw new GDSParseError("Invalid GDS REAL8 length");
      yield { ...record, data: readGdsReal8(view, offset + 4) };
    } else {
      yield record;
    }
    offset += length;
    if (record.tag === RecordType.ENDLIB) return;
  }
}
