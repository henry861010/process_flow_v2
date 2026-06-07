import { deepCopy } from "./schema.js";
import { math } from "../utils/math.js";
import { validatePolygonLoops } from "../utils/polygon.js";

export class Geometry {
  zMin() {
    throw new Error("zMin must be implemented by subclasses");
  }

  zMax() {
    throw new Error("zMax must be implemented by subclasses");
  }

  thk() {
    throw new Error("thk must be implemented by subclasses");
  }

  copy() {
    throw new Error("copy must be implemented by subclasses");
  }

  copyWithThk() {
    throw new Error("copyWithThk must be implemented by subclasses");
  }

  copyWithXYInset() {
    throw new Error("copyWithXYInset must be implemented by subclasses");
  }

  move() {
    throw new Error("move must be implemented by subclasses");
  }

  clipTopTo() {
    throw new Error("clipTopTo must be implemented by subclasses");
  }

  flip() {
    throw new Error("flip must be implemented by subclasses");
  }

  json() {
    throw new Error("json must be implemented by subclasses");
  }

  toJSON() {
    return this.json();
  }

  z_min() {
    return this.zMin();
  }

  z_max() {
    return this.zMax();
  }

  copy_with_thk(thk) {
    return this.copyWithThk(thk);
  }

  copy_with_xy_inset(inset) {
    return this.copyWithXYInset(inset);
  }

  clip_top_to(toZ) {
    return this.clipTopTo(toZ);
  }
}

export class BoxGeometry extends Geometry {
  constructor(bottomLeft, topRight, thk) {
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

  bottomLeft() {
    return deepCopy(this._bottomLeft);
  }

  bottom_left() {
    return this.bottomLeft();
  }

  topRight() {
    return deepCopy(this._topRight);
  }

  top_right() {
    return this.topRight();
  }

  zMin() {
    return Math.min(this._bottomLeft[2], this._topRight[2]);
  }

  zMax() {
    return this.zMin() + this._thk;
  }

  thk() {
    return this._thk;
  }

  copy() {
    return new BoxGeometry(this._bottomLeft, this._topRight, this._thk);
  }

  copyWithThk(thk) {
    return new BoxGeometry(this._bottomLeft, this._topRight, thk);
  }

  copyWithXYInset(inset) {
    const amount = finiteNumber(inset, "inset");
    const xMin = Math.min(this._bottomLeft[0], this._topRight[0]) + amount;
    const xMax = Math.max(this._bottomLeft[0], this._topRight[0]) - amount;
    const yMin = Math.min(this._bottomLeft[1], this._topRight[1]) + amount;
    const yMax = Math.max(this._bottomLeft[1], this._topRight[1]) - amount;

    if (xMin >= xMax || yMin >= yMax) {
      throw new Error("BoxGeometry XY inset collapses the footprint");
    }

    return new BoxGeometry([xMin, yMin, this.zMin()], [xMax, yMax, this.zMin()], this._thk);
  }

  move(...args) {
    const { x, y, z } = moveArgs(args);
    this._bottomLeft[0] += x;
    this._topRight[0] += x;
    this._bottomLeft[1] += y;
    this._topRight[1] += y;
    this._bottomLeft[2] += z;
    this._topRight[2] += z;
  }

  clipTopTo(toZ) {
    const zBottom = this.zMin();
    const zTop = zBottom + this._thk;

    if (math.fLe(toZ, zBottom)) return false;
    if (math.fLt(zBottom, toZ) && math.fLt(toZ, zTop)) {
      this._thk = toZ - zBottom;
    }

    return true;
  }

  flip(aroundZ = 0) {
    const flippedZ = 2 * aroundZ - this.zMax();
    this._bottomLeft[2] = flippedZ;
    this._topRight[2] = flippedZ;
  }

  json() {
    return {
      type: "BoxGeometry",
      bottom_left: deepCopy(this._bottomLeft),
      top_right: deepCopy(this._topRight),
      thk: this._thk,
    };
  }
}

export class PolygonGeometry extends Geometry {
  constructor(polys, thk) {
    super();
    validatePolygonLoops(polys);
    this._polys = deepCopy(polys);
    this._thk = thk;
  }

  polygons() {
    return deepCopy(this._polys);
  }

  zMin() {
    return this._polys[0][0][2];
  }

  zMax() {
    return this.zMin() + this._thk;
  }

  thk() {
    return this._thk;
  }

  copy() {
    return new PolygonGeometry(this._polys, this._thk);
  }

  copyWithThk(thk) {
    return new PolygonGeometry(this._polys, thk);
  }

  copyWithXYInset(inset) {
    const amount = finiteNumber(inset, "inset");
    if (amount === 0) {
      return this.copy();
    }
    throw new Error("PolygonGeometry does not support non-zero XY inset");
  }

  move(...args) {
    const { x, y, z } = moveArgs(args);
    this._polys.forEach((poly) => {
      poly.forEach((node) => {
        node[0] += x;
        node[1] += y;
        node[2] += z;
      });
    });
  }

  clipTopTo(toZ) {
    const zBottom = this.zMin();
    const zTop = zBottom + this._thk;

    if (math.fLe(toZ, zBottom)) return false;
    if (math.fLt(zBottom, toZ) && math.fLt(toZ, zTop)) {
      this._thk = toZ - zBottom;
    }

    return true;
  }

  flip(aroundZ = 0) {
    const flippedZ = 2 * aroundZ - this.zMax();
    this._polys.forEach((poly) => {
      poly.forEach((node) => {
        node[2] = flippedZ;
      });
    });
  }

  json() {
    return {
      type: "PolygonGeometry",
      polys: deepCopy(this._polys),
      thk: this._thk,
    };
  }
}

export class CylinderGeometry extends Geometry {
  constructor(center, bottomRadius, thk) {
    super();
    this._center = deepCopy(center);
    this._bottomRadius = bottomRadius;
    this._thk = thk;
  }

  center() {
    return deepCopy(this._center);
  }

  bottomRadius() {
    return this._bottomRadius;
  }

  bottom_radius() {
    return this.bottomRadius();
  }

  zMin() {
    return this._center[2];
  }

  zMax() {
    return this.zMin() + this._thk;
  }

  thk() {
    return this._thk;
  }

  copy() {
    return new CylinderGeometry(this._center, this._bottomRadius, this._thk);
  }

  copyWithThk(thk) {
    return new CylinderGeometry(this._center, this._bottomRadius, thk);
  }

  copyWithXYInset(inset) {
    const radius = this._bottomRadius - finiteNumber(inset, "inset");
    if (radius <= 0) {
      throw new Error("CylinderGeometry XY inset collapses the footprint");
    }
    return new CylinderGeometry(this._center, radius, this._thk);
  }

  move(...args) {
    const { x, y, z } = moveArgs(args);
    this._center[0] += x;
    this._center[1] += y;
    this._center[2] += z;
  }

  clipTopTo(toZ) {
    const zBottom = this.zMin();
    const zTop = zBottom + this._thk;

    if (math.fLe(toZ, zBottom)) return false;
    if (math.fLt(zBottom, toZ) && math.fLt(toZ, zTop)) {
      this._thk = toZ - zBottom;
    }

    return true;
  }

  flip(aroundZ = 0) {
    this._center[2] = 2 * aroundZ - this.zMax();
  }

  json() {
    return {
      type: "CylinderGeometry",
      center: deepCopy(this._center),
      bottom_radius: this._bottomRadius,
      thk: this._thk,
    };
  }
}

export class ConeGeometry extends Geometry {
  constructor(center, bottomRadius, topRadius, thk) {
    super();
    this._center = deepCopy(center);
    this._bottomRadius = bottomRadius;
    this._topRadius = topRadius;
    this._thk = thk;
  }

  center() {
    return deepCopy(this._center);
  }

  bottomRadius() {
    return this._bottomRadius;
  }

  bottom_radius() {
    return this.bottomRadius();
  }

  topRadius() {
    return this._topRadius;
  }

  top_radius() {
    return this.topRadius();
  }

  zMin() {
    return this._center[2];
  }

  zMax() {
    return this.zMin() + this._thk;
  }

  thk() {
    return this._thk;
  }

  copy() {
    return new ConeGeometry(
      this._center,
      this._bottomRadius,
      this._topRadius,
      this._thk,
    );
  }

  copyWithThk(thk) {
    return new ConeGeometry(
      this._center,
      this._bottomRadius,
      this._topRadius,
      thk,
    );
  }

  copyWithXYInset(inset) {
    const amount = finiteNumber(inset, "inset");
    const bottomRadius = this._bottomRadius - amount;
    const topRadius = this._topRadius - amount;
    if (bottomRadius <= 0 || topRadius <= 0) {
      throw new Error("ConeGeometry XY inset collapses the footprint");
    }
    return new ConeGeometry(this._center, bottomRadius, topRadius, this._thk);
  }

  move(...args) {
    const { x, y, z } = moveArgs(args);
    this._center[0] += x;
    this._center[1] += y;
    this._center[2] += z;
  }

  clipTopTo(toZ) {
    const zBottom = this.zMin();
    const zTop = zBottom + this._thk;

    if (math.fLe(toZ, zBottom)) return false;
    if (math.fLt(zBottom, toZ) && math.fLt(toZ, zTop)) {
      this._thk = toZ - zBottom;
    }

    return true;
  }

  flip(aroundZ = 0) {
    this._center[2] = 2 * aroundZ - this.zMax();
    [this._bottomRadius, this._topRadius] = [
      this._topRadius,
      this._bottomRadius,
    ];
  }

  json() {
    return {
      type: "ConeGeometry",
      center: deepCopy(this._center),
      bottom_radius: this._bottomRadius,
      top_radius: this._topRadius,
      thk: this._thk,
    };
  }
}

export function moveArgs(args) {
  if (args.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0])
  ) {
    const { x = 0, y = 0, z = 0 } = args[0];
    return { x, y, z };
  }
  const [x = 0, y = 0, z = 0] = args;
  return { x, y, z };
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number`);
  }
  return number;
}
