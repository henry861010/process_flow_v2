import { deepCopy } from "./schema.js";
import { math } from "../utils/math.js";
import { validatePolygonLoops } from "../utils/polygon.js";

export type Point3 = [number, number, number];
export type PolygonLoop = Point3[];
export type PolygonLoops = PolygonLoop[];
export type MoveVector = { x: number; y: number; z: number };
export type MoveInput = Partial<MoveVector> | number;
export type GeometryJson = Record<string, any>;

export class Geometry {
  zMin(): number {
    throw new Error("zMin must be implemented by subclasses");
  }

  zMax(): number {
    throw new Error("zMax must be implemented by subclasses");
  }

  thk(): number {
    throw new Error("thk must be implemented by subclasses");
  }

  copy(): Geometry {
    throw new Error("copy must be implemented by subclasses");
  }

  copyWithThk(_thk: number): Geometry {
    throw new Error("copyWithThk must be implemented by subclasses");
  }

  move(..._args: MoveInput[]): void {
    throw new Error("move must be implemented by subclasses");
  }

  clipTopTo(_toZ: number): boolean {
    throw new Error("clipTopTo must be implemented by subclasses");
  }

  flip(_aroundZ = 0): void {
    throw new Error("flip must be implemented by subclasses");
  }

  json(): GeometryJson {
    throw new Error("json must be implemented by subclasses");
  }

  toJSON(): GeometryJson {
    return this.json();
  }

  z_min(): number {
    return this.zMin();
  }

  z_max(): number {
    return this.zMax();
  }

  copy_with_thk(thk: number): Geometry {
    return this.copyWithThk(thk);
  }

  clip_top_to(toZ: number): boolean {
    return this.clipTopTo(toZ);
  }
}

export class BoxGeometry extends Geometry {
  private _bottomLeft: Point3;
  private _topRight: Point3;
  private _thk: number;

  constructor(bottomLeft: Point3, topRight: Point3, thk: number) {
    super();
    if (bottomLeft[2] !== topRight[2]) {
      throw new Error(
        "BoxGeometry bottom_left and top_right must be on the same xy plane.",
      );
    }

    this._bottomLeft = deepCopy(bottomLeft);
    this._topRight = deepCopy(topRight);
    this._thk = thk;
  }

  bottomLeft(): Point3 {
    return deepCopy(this._bottomLeft);
  }

  bottom_left(): Point3 {
    return this.bottomLeft();
  }

  topRight(): Point3 {
    return deepCopy(this._topRight);
  }

  top_right(): Point3 {
    return this.topRight();
  }

  zMin(): number {
    return Math.min(this._bottomLeft[2], this._topRight[2]);
  }

  zMax(): number {
    return this.zMin() + this._thk;
  }

  thk(): number {
    return this._thk;
  }

  copy(): BoxGeometry {
    return new BoxGeometry(this._bottomLeft, this._topRight, this._thk);
  }

  copyWithThk(thk: number): BoxGeometry {
    return new BoxGeometry(this._bottomLeft, this._topRight, thk);
  }

  move(...args: MoveInput[]): void {
    const { x, y, z } = moveArgs(args);
    this._bottomLeft[0] += x;
    this._topRight[0] += x;
    this._bottomLeft[1] += y;
    this._topRight[1] += y;
    this._bottomLeft[2] += z;
    this._topRight[2] += z;
  }

  clipTopTo(toZ: number): boolean {
    const zBottom = this.zMin();
    const zTop = zBottom + this._thk;

    if (math.fLe(toZ, zBottom)) return false;
    if (math.fLt(zBottom, toZ) && math.fLt(toZ, zTop)) {
      this._thk = toZ - zBottom;
    }

    return true;
  }

  flip(aroundZ = 0): void {
    const flippedZ = 2 * aroundZ - this.zMax();
    this._bottomLeft[2] = flippedZ;
    this._topRight[2] = flippedZ;
  }

  json(): GeometryJson {
    return {
      type: "BoxGeometry",
      bottom_left: deepCopy(this._bottomLeft),
      top_right: deepCopy(this._topRight),
      thk: this._thk,
    };
  }
}

export class PolygonGeometry extends Geometry {
  private _polys: PolygonLoops;
  private _thk: number;

  constructor(polys: PolygonLoops, thk: number) {
    super();
    validatePolygonLoops(polys);
    this._polys = deepCopy(polys);
    this._thk = thk;
  }

  polygons(): PolygonLoops {
    return deepCopy(this._polys);
  }

  zMin(): number {
    return this._polys[0][0][2];
  }

  zMax(): number {
    return this.zMin() + this._thk;
  }

  thk(): number {
    return this._thk;
  }

  copy(): PolygonGeometry {
    return new PolygonGeometry(this._polys, this._thk);
  }

  copyWithThk(thk: number): PolygonGeometry {
    return new PolygonGeometry(this._polys, thk);
  }

  move(...args: MoveInput[]): void {
    const { x, y, z } = moveArgs(args);
    this._polys.forEach((poly) => {
      poly.forEach((node) => {
        node[0] += x;
        node[1] += y;
        node[2] += z;
      });
    });
  }

  clipTopTo(toZ: number): boolean {
    const zBottom = this.zMin();
    const zTop = zBottom + this._thk;

    if (math.fLe(toZ, zBottom)) return false;
    if (math.fLt(zBottom, toZ) && math.fLt(toZ, zTop)) {
      this._thk = toZ - zBottom;
    }

    return true;
  }

  flip(aroundZ = 0): void {
    const flippedZ = 2 * aroundZ - this.zMax();
    this._polys.forEach((poly) => {
      poly.forEach((node) => {
        node[2] = flippedZ;
      });
    });
  }

  json(): GeometryJson {
    return {
      type: "PolygonGeometry",
      polys: deepCopy(this._polys),
      thk: this._thk,
    };
  }
}

export class CylinderGeometry extends Geometry {
  private _center: Point3;
  private _bottomRadius: number;
  private _thk: number;

  constructor(center: Point3, bottomRadius: number, thk: number) {
    super();
    this._center = deepCopy(center);
    this._bottomRadius = bottomRadius;
    this._thk = thk;
  }

  center(): Point3 {
    return deepCopy(this._center);
  }

  bottomRadius(): number {
    return this._bottomRadius;
  }

  bottom_radius(): number {
    return this.bottomRadius();
  }

  zMin(): number {
    return this._center[2];
  }

  zMax(): number {
    return this.zMin() + this._thk;
  }

  thk(): number {
    return this._thk;
  }

  copy(): CylinderGeometry {
    return new CylinderGeometry(this._center, this._bottomRadius, this._thk);
  }

  copyWithThk(thk: number): CylinderGeometry {
    return new CylinderGeometry(this._center, this._bottomRadius, thk);
  }

  move(...args: MoveInput[]): void {
    const { x, y, z } = moveArgs(args);
    this._center[0] += x;
    this._center[1] += y;
    this._center[2] += z;
  }

  clipTopTo(toZ: number): boolean {
    const zBottom = this.zMin();
    const zTop = zBottom + this._thk;

    if (math.fLe(toZ, zBottom)) return false;
    if (math.fLt(zBottom, toZ) && math.fLt(toZ, zTop)) {
      this._thk = toZ - zBottom;
    }

    return true;
  }

  flip(aroundZ = 0): void {
    this._center[2] = 2 * aroundZ - this.zMax();
  }

  json(): GeometryJson {
    return {
      type: "CylinderGeometry",
      center: deepCopy(this._center),
      bottom_radius: this._bottomRadius,
      thk: this._thk,
    };
  }
}

export class ConeGeometry extends Geometry {
  private _center: Point3;
  private _bottomRadius: number;
  private _topRadius: number;
  private _thk: number;

  constructor(center: Point3, bottomRadius: number, topRadius: number, thk: number) {
    super();
    this._center = deepCopy(center);
    this._bottomRadius = bottomRadius;
    this._topRadius = topRadius;
    this._thk = thk;
  }

  center(): Point3 {
    return deepCopy(this._center);
  }

  bottomRadius(): number {
    return this._bottomRadius;
  }

  bottom_radius(): number {
    return this.bottomRadius();
  }

  topRadius(): number {
    return this._topRadius;
  }

  top_radius(): number {
    return this.topRadius();
  }

  zMin(): number {
    return this._center[2];
  }

  zMax(): number {
    return this.zMin() + this._thk;
  }

  thk(): number {
    return this._thk;
  }

  copy(): ConeGeometry {
    return new ConeGeometry(
      this._center,
      this._bottomRadius,
      this._topRadius,
      this._thk,
    );
  }

  copyWithThk(thk: number): ConeGeometry {
    return new ConeGeometry(
      this._center,
      this._bottomRadius,
      this._topRadius,
      thk,
    );
  }

  move(...args: MoveInput[]): void {
    const { x, y, z } = moveArgs(args);
    this._center[0] += x;
    this._center[1] += y;
    this._center[2] += z;
  }

  clipTopTo(toZ: number): boolean {
    const zBottom = this.zMin();
    const zTop = zBottom + this._thk;

    if (math.fLe(toZ, zBottom)) return false;
    if (math.fLt(zBottom, toZ) && math.fLt(toZ, zTop)) {
      this._thk = toZ - zBottom;
    }

    return true;
  }

  flip(aroundZ = 0): void {
    this._center[2] = 2 * aroundZ - this.zMax();
    [this._bottomRadius, this._topRadius] = [
      this._topRadius,
      this._bottomRadius,
    ];
  }

  json(): GeometryJson {
    return {
      type: "ConeGeometry",
      center: deepCopy(this._center),
      bottom_radius: this._bottomRadius,
      top_radius: this._topRadius,
      thk: this._thk,
    };
  }
}

export function moveArgs(args: MoveInput[]): MoveVector {
  if (args.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0])
  ) {
    const { x = 0, y = 0, z = 0 } = args[0] as Partial<MoveVector>;
    return { x, y, z };
  }
  const [x = 0, y = 0, z = 0] = args as number[];
  return { x, y, z };
}
