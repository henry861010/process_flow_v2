export const GEOMETRY_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_UNIT_SYSTEM = "um";

type JsonRecord = Record<string, any>;

export function normalizeGeometryStructure(
  payload: any,
  schemaVersion = GEOMETRY_SCHEMA_VERSION,
  unitSystem = DEFAULT_UNIT_SYSTEM,
): any {
  const copied = deepCopy(payload);
  const structure = isStructure(copied)
    ? copied
    : {
        schemaVersion,
        unitSystem,
        root: copied,
      };

  if (structure.schemaVersion === undefined) {
    structure.schemaVersion = schemaVersion;
  }
  if (structure.unitSystem === undefined) {
    structure.unitSystem = unitSystem;
  }

  assignContainerIds(structure.root, ["root"]);
  return structure;
}

export function stableId(kind: string, path: unknown[], payload: any = null): string {
  const normalizedPath = path.map((part) => String(part));
  const digestPayload = {
    kind,
    path: normalizedPath,
    payload,
  };
  const digest = sha1(canonicalJson(digestPayload)).slice(0, 12);
  const label = slug(normalizedPath.slice(-3).join("-"));
  return `${kind}:${label}:${digest}`;
}

export function deepCopy<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isStructure(payload: any): boolean {
  return (
    isPlainObject(payload) &&
    Object.hasOwn(payload, "root") &&
    (Object.hasOwn(payload, "schemaVersion") ||
      Object.hasOwn(payload, "unitSystem"))
  );
}

function assignContainerIds(container: JsonRecord, path: string[]): void {
  if (!Array.isArray(container.bodies)) container.bodies = [];
  if (!Array.isArray(container.vias)) container.vias = [];
  if (!Array.isArray(container.circuits)) container.circuits = [];
  if (!Array.isArray(container.bumps)) container.bumps = [];
  if (!Array.isArray(container.children)) container.children = [];

  const containerKey = container.key ?? "";
  const containerPath = [...path, `container:${containerKey}`];
  if (container.id === undefined) {
    container.id = stableId("container", containerPath, { key: containerKey });
  }

  assignFeatureIds(container.bodies, "body", containerPath);
  assignFeatureIds(container.vias, "via", containerPath);
  assignFeatureIds(container.circuits, "circuit", containerPath);
  assignFeatureIds(container.bumps, "bump", containerPath);

  container.children.forEach((child: JsonRecord, index: number) => {
    const childKey = child.key ?? "";
    const childPath = [
      ...containerPath,
      `child:${index}:${childKey}`,
    ];
    assignContainerIds(child, childPath);
  });
}

function assignFeatureIds(
  features: JsonRecord[],
  kind: string,
  containerPath: string[],
): void {
  features.forEach((feature, index) => {
    if (feature.id !== undefined) return;
    feature.id = stableId(
      kind,
      [...containerPath, `${kind}:${index}`],
      withoutId(feature),
    );
  });
}

function withoutId(value: any): any {
  const copied = deepCopy(value);
  if (isPlainObject(copied)) {
    delete copied.id;
  }
  return copied;
}

function canonicalJson(value: any): string {
  return ensureAscii(JSON.stringify(sortForJson(value)));
}

function sortForJson(value: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => sortForJson(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const sorted: JsonRecord = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortForJson(value[key]);
  }
  return sorted;
}

function ensureAscii(value: string): string {
  let result = "";
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x7f) {
      result += char;
      continue;
    }
    if (codePoint <= 0xffff) {
      result += `\\u${codePoint.toString(16).padStart(4, "0")}`;
      continue;
    }
    const shifted = codePoint - 0x10000;
    const high = 0xd800 + (shifted >> 10);
    const low = 0xdc00 + (shifted & 0x3ff);
    result += `\\u${high.toString(16)}\\u${low.toString(16)}`;
  }
  return result;
}

function slug(value: string): string {
  const lowered = value.toLowerCase();
  const slugged = lowered.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slugged || "item";
}

function isPlainObject(value: unknown): value is JsonRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function sha1(message: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < message.length; i += 1) {
    bytes.push(message.charCodeAt(i));
  }

  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  bytes.push(
    (highBits >>> 24) & 0xff,
    (highBits >>> 16) & 0xff,
    (highBits >>> 8) & 0xff,
    highBits & 0xff,
    (lowBits >>> 24) & 0xff,
    (lowBits >>> 16) & 0xff,
    (lowBits >>> 8) & 0xff,
    lowBits & 0xff,
  );

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const words: number[] = new Array(80);
  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] =
        (bytes[chunk + i * 4] << 24) |
        (bytes[chunk + i * 4 + 1] << 16) |
        (bytes[chunk + i * 4 + 2] << 8) |
        bytes[chunk + i * 4 + 3];
    }
    for (let i = 16; i < 80; i += 1) {
      words[i] = leftRotate(
        words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16],
        1,
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (leftRotate(a, 5) + f + e + k + words[i]) | 0;
      e = d;
      d = c;
      c = leftRotate(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return [h0, h1, h2, h3, h4]
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

function leftRotate(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}
