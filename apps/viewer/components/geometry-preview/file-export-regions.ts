import type { CoordinateMode, MeshControlLocation, MeshControlRegion } from "./file-export-client";

export type Axis = "x" | "y" | "z";
export type LocationDraft<A extends Axis = Axis> = { anchor: `${A}_min` | `${A}_max`; value: string };
type PointDraft = { x: LocationDraft<"x">; y: LocationDraft<"y"> };
type Point3Draft = PointDraft & { z: LocationDraft<"z"> };
export type RegionDraft = {
  shape: "box" | "polygon";
  elementSize: string;
  box: { min: Point3Draft; max: Point3Draft };
  polygon: { loops: PointDraft[][]; startZ: LocationDraft<"z">; endZ: LocationDraft<"z"> };
};

function coordinate<A extends Axis>(axis: A, bound: "min" | "max", mode: CoordinateMode): LocationDraft<A> {
  return { anchor: `${axis}_${bound}`, value: mode === "reference" ? "0" : "" };
}
export function newPolygonLoop(mode: CoordinateMode = "reference"): PointDraft[] {
  return [
    { x: coordinate("x", "min", mode), y: coordinate("y", "min", mode) },
    { x: coordinate("x", "max", mode), y: coordinate("y", "min", mode) },
    { x: coordinate("x", "min", mode), y: coordinate("y", "max", mode) },
  ];
}
export function newRegionDraft(mode: CoordinateMode = "reference"): RegionDraft {
  return {
    shape: "box", elementSize: "5",
    box: {
      min: { x: coordinate("x", "min", mode), y: coordinate("y", "min", mode), z: coordinate("z", "min", mode) },
      max: { x: coordinate("x", "max", mode), y: coordinate("y", "max", mode), z: coordinate("z", "max", mode) },
    },
    polygon: { loops: [newPolygonLoop(mode)], startZ: coordinate("z", "min", mode), endZ: coordinate("z", "max", mode) },
  };
}
export function buildLocation<A extends Axis, M extends CoordinateMode>(draft: LocationDraft<A>, mode: M): MeshControlLocation<A, M> {
  return (mode === "absolute" ? Number(draft.value) : { anchor: draft.anchor, offset: Number(draft.value) }) as MeshControlLocation<A, M>;
}
export function draftLocation<A extends Axis>(value: MeshControlLocation<A>, axis: A): LocationDraft<A> {
  return typeof value === "number" ? { anchor: `${axis}_min`, value: String(value) }
    : { anchor: value.anchor, value: String(value.offset) };
}
export function buildRegion<M extends CoordinateMode>(draft: RegionDraft, mode: M): MeshControlRegion<M> {
  if (draft.shape === "box") {
    const point = (p: Point3Draft) => ({ x: buildLocation(p.x, mode), y: buildLocation(p.y, mode), z: buildLocation(p.z, mode) });
    return { type: "box", min: point(draft.box.min), max: point(draft.box.max) };
  }
  return { type: "polygon", loops: draft.polygon.loops.map(loop => loop.map(p => ({ x: buildLocation(p.x, mode), y: buildLocation(p.y, mode) }))),
    startZ: buildLocation(draft.polygon.startZ, mode), endZ: buildLocation(draft.polygon.endZ, mode) };
}
export function regionDraftFromEntry(region: MeshControlRegion, elementSize: number, mode: CoordinateMode): RegionDraft {
  const draft = newRegionDraft(mode);
  draft.shape = region.type;
  draft.elementSize = String(elementSize);
  if (region.type === "box") {
    const point = (p: typeof region.min) => ({ x: draftLocation(p.x, "x"), y: draftLocation(p.y, "y"), z: draftLocation(p.z, "z") });
    draft.box = { min: point(region.min), max: point(region.max) };
  } else {
    draft.polygon = { loops: region.loops.map(loop => loop.map(p => ({ x: draftLocation(p.x, "x"), y: draftLocation(p.y, "y") }))),
      startZ: draftLocation(region.startZ, "z"), endZ: draftLocation(region.endZ, "z") };
  }
  return draft;
}
export function validateRegionDraft(draft: RegionDraft): string | null {
  const finite = (v: string) => v.trim() !== "" && Number.isFinite(Number(v));
  if (!finite(draft.elementSize) || Number(draft.elementSize) <= 0) return "element size must be greater than 0.";
  const fields: Array<[string, LocationDraft]> = [];
  if (draft.shape === "box") {
    for (const bound of ["min", "max"] as const) for (const axis of ["x", "y", "z"] as const) {
      fields.push([`region.${bound}.${axis}`, draft.box[bound][axis]]);
    }
  } else {
    if (!draft.polygon.loops.length) return "region.loops requires at least one loop.";
    for (const [i, loop] of draft.polygon.loops.entries()) {
      if (loop.length < 3) return `region.loops[${i}] requires at least three vertices.`;
      for (const [j, p] of loop.entries()) for (const axis of ["x", "y"] as const) {
        fields.push([`region.loops[${i}][${j}].${axis}`, p[axis]]);
      }
    }
    fields.push(["region.startZ", draft.polygon.startZ], ["region.endZ", draft.polygon.endZ]);
  }
  for (const [name, value] of fields) if (!finite(value.value)) return `${name} must be a finite number.`;
  return null;
}
