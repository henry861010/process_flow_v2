import { describe, expect, it } from "vitest";

import {
  buildMeshControlConfiguration,
  collectKeyedGeometryReferences,
  filterKeyedGeometryReferences,
  validateMeshControlDraft,
  type MeshControlDraft,
} from "./file-export-mesh-control";

function control(overrides: Partial<MeshControlDraft> = {}): MeshControlDraft {
  return {
    clientId: "control-1",
    method: "Z_SECTION_AVG",
    referenceKind: "container",
    referenceKey: " hbm ",
    referenceId: " ",
    elementSize: "10",
    startZ: { mode: "relative", anchor: "z_min", value: "10" },
    endZ: { mode: "absolute", anchor: "z_max", value: "200" },
    z: { mode: "relative", anchor: "z_max", value: "-10" },
    ...overrides,
  };
}

describe("CDB mesh-control form", () => {
  it("collects unique keyed container and body references from the preview", () => {
    expect(
      collectKeyedGeometryReferences({
        root: {
          key: " package ",
          bodies: [
            { key: "mold" },
            { key: "mold" },
            { key: " " },
          ],
          vias: [{ key: "unsupported-via-key" }],
          children: [
            {
              key: "die",
              bodies: [{ key: "silicon" }, { key: "mold" }],
              children: [],
            },
            { key: "die", bodies: [], children: [] },
          ],
        },
      }),
    ).toEqual([
      { kind: "body", key: "mold" },
      { kind: "body", key: "silicon" },
      { kind: "container", key: "die" },
      { kind: "container", key: "package" },
    ]);
  });

  it("returns no reference suggestions for missing or empty keys", () => {
    expect(collectKeyedGeometryReferences(null)).toEqual([]);
    expect(
      collectKeyedGeometryReferences({
        root: { bodies: [{ material: "Si" }], children: [] },
      }),
    ).toEqual([]);
  });

  it("filters reference suggestions by kind or key", () => {
    const references = [
      { kind: "body" as const, key: "mold" },
      { kind: "container" as const, key: "HBM stack" },
    ];

    expect(filterKeyedGeometryReferences(references, " BODY ")).toEqual([
      references[0],
    ]);
    expect(filterKeyedGeometryReferences(references, "hbm")).toEqual([
      references[1],
    ]);
    expect(filterKeyedGeometryReferences(references, "missing")).toEqual([]);
  });

  it("serializes section and point controls into the canonical payload", () => {
    const point = control({
      clientId: "control-2",
      method: "Z_POINT",
      referenceKind: "root",
      referenceKey: "",
      referenceId: "",
    });

    expect(
      buildMeshControlConfiguration("200", "upper_right_quarter", [
        control(),
        point,
      ]),
    ).toEqual({
      schemaVersion: "1.0.0",
      unitSystem: "um",
      mesher: "process_flow_2_5d",
      globalElementSize: 200,
      symmetry: "upper_right_quarter",
      controls: [
        {
          method: "Z_SECTION_AVG",
          reference: { kind: "container", key: "hbm" },
          elementSize: 10,
          startZ: { mode: "relative", anchor: "z_min", offset: 10 },
          endZ: { mode: "absolute", value: 200 },
        },
        {
          method: "Z_POINT",
          reference: { kind: "root" },
          z: { mode: "relative", anchor: "z_max", offset: -10 },
        },
      ],
    });
  });

  it("validates only basic numeric inputs", () => {
    expect(validateMeshControlDraft("0", [])).toBe(
      "Global element size must be greater than 0.",
    );
    expect(
      validateMeshControlDraft("200", [control({ elementSize: "not-a-number" })]),
    ).toBe("Control 1 element size must be greater than 0.");
  });

  it("leaves mesher-specific reference rules to the backend", () => {
    expect(
      validateMeshControlDraft("200", [
        control({ referenceKind: "custom-kind", referenceKey: "hbm", referenceId: "" }),
      ]),
    ).toBeNull();
    expect(
      validateMeshControlDraft("200", [
        control({ referenceKind: "bump", referenceKey: "", referenceId: "" }),
      ]),
    ).toBeNull();
  });

  it("serializes kind, key, and id independently without frontend filtering", () => {
    const payload = buildMeshControlConfiguration("200", "full", [
      control({
        referenceKind: " root ",
        referenceKey: " hbm ",
        referenceId: " geometry-id ",
      }),
    ]);

    expect(payload.controls[0].reference).toEqual({
      kind: "root",
      key: "hbm",
      id: "geometry-id",
    });
  });

  it.each([
    "Z_SECTION_AVG",
    "Z_SECTION_TOP",
    "Z_SECTION_BOT",
    "Z_SECTION_CENTER",
  ] as const)("preserves the %s method name", (method) => {
    const payload = buildMeshControlConfiguration("200", "full", [
      control({ method }),
    ]);

    expect(payload.controls[0].method).toBe(method);
  });
});
