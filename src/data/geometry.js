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

  clipXYToBox() {
    throw new Error("clipXYToBox must be implemented by subclasses");
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

  clip_xy_to_box(bounds) {
    return this.clipXYToBox(bounds);
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

  clipXYToBox(bounds) {
    const crop = normalizeCropBox(bounds);
    const xMin = Math.max(
      Math.min(this._bottomLeft[0], this._topRight[0]),
      crop.xMin,
    );
    const xMax = Math.min(
      Math.max(this._bottomLeft[0], this._topRight[0]),
      crop.xMax,
    );
    const yMin = Math.max(
      Math.min(this._bottomLeft[1], this._topRight[1]),
      crop.yMin,
    );
    const yMax = Math.min(
      Math.max(this._bottomLeft[1], this._topRight[1]),
      crop.yMax,
    );

    if (math.fLe(xMax, xMin) || math.fLe(yMax, yMin)) return false;

    const z = this.zMin();
    this._bottomLeft = [xMin, yMin, z];
    this._topRight = [xMax, yMax, z];
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

  clipXYToBox(bounds) {
    const crop = normalizeCropBox(bounds);
    const clipped = this._polys
      .map((poly) => clipLoopToBox(poly, crop))
      .filter((poly) => poly.length >= 3);

    if (clipped.length === 0) return false;

    validatePolygonLoops(clipped);
    this._polys = clipped;
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

  clipXYToBox(bounds) {
    return clipCircularFootprintToBox({
      bounds,
      center: this._center,
      radius: this._bottomRadius,
      typeName: "CylinderGeometry",
    });
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

  clipXYToBox(bounds) {
    return clipCircularFootprintToBox({
      bounds,
      center: this._center,
      radius: Math.max(this._bottomRadius, this._topRadius),
      typeName: "ConeGeometry",
    });
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

function normalizeCropBox(bounds) {
  const xMin = finiteNumber(bounds?.xMin, "bounds.xMin");
  const xMax = finiteNumber(bounds?.xMax, "bounds.xMax");
  const yMin = finiteNumber(bounds?.yMin, "bounds.yMin");
  const yMax = finiteNumber(bounds?.yMax, "bounds.yMax");
  if (math.fLe(xMax, xMin) || math.fLe(yMax, yMin)) {
    throw new Error("clipXYToBox requires a non-empty XY box");
  }
  return { xMin, xMax, yMin, yMax };
}

function clipCircularFootprintToBox({ bounds, center, radius, typeName }) {
  const crop = normalizeCropBox(bounds);
  const r = finiteNumber(radius, "radius");
  const x = center[0];
  const y = center[1];

  if (
    math.fGe(x - r, crop.xMin) &&
    math.fLe(x + r, crop.xMax) &&
    math.fGe(y - r, crop.yMin) &&
    math.fLe(y + r, crop.yMax)
  ) {
    return true;
  }

  const closestX = Math.min(Math.max(x, crop.xMin), crop.xMax);
  const closestY = Math.min(Math.max(y, crop.yMin), crop.yMax);
  const dx = x - closestX;
  const dy = y - closestY;
  if (math.fGe(dx * dx + dy * dy, r * r)) {
    return false;
  }

  throw new Error(`${typeName} does not support partial XY saw clipping`);
}

function clipLoopToBox(loop, bounds) {
  const z = loop[0][2];
  let result = loop.map((point) => [...point]);
  result = clipLoopAgainstBoundary(result, bounds, insideLeft, intersectLeft);
  result = clipLoopAgainstBoundary(result, bounds, insideRight, intersectRight);
  result = clipLoopAgainstBoundary(result, bounds, insideBottom, intersectBottom);
  result = clipLoopAgainstBoundary(result, bounds, insideTop, intersectTop);
  return cleanLoop(result.map(([x, y]) => [math.fZero(x), math.fZero(y), z]));
}

function clipLoopAgainstBoundary(loop, bounds, inside, intersect) {
  if (loop.length === 0) return [];
  const result = [];
  let previous = loop[loop.length - 1];
  let previousInside = inside(previous, bounds);

  for (const current of loop) {
    const currentInside = inside(current, bounds);
    if (currentInside) {
      if (!previousInside) {
        result.push(intersect(previous, current, bounds));
      }
      result.push(current);
    } else if (previousInside) {
      result.push(intersect(previous, current, bounds));
    }
    previous = current;
    previousInside = currentInside;
  }

  return cleanAdjacentDuplicates(result);
}

function insideLeft(point, bounds) {
  return math.fGe(point[0], bounds.xMin);
}

function insideRight(point, bounds) {
  return math.fLe(point[0], bounds.xMax);
}

function insideBottom(point, bounds) {
  return math.fGe(point[1], bounds.yMin);
}

function insideTop(point, bounds) {
  return math.fLe(point[1], bounds.yMax);
}

function intersectLeft(start, end, bounds) {
  return intersectAtX(start, end, bounds.xMin);
}

function intersectRight(start, end, bounds) {
  return intersectAtX(start, end, bounds.xMax);
}

function intersectBottom(start, end, bounds) {
  return intersectAtY(start, end, bounds.yMin);
}

function intersectTop(start, end, bounds) {
  return intersectAtY(start, end, bounds.yMax);
}

function intersectAtX(start, end, x) {
  const dx = end[0] - start[0];
  if (math.fEq(dx, 0)) return [x, start[1], start[2]];
  const t = (x - start[0]) / dx;
  return [x, start[1] + t * (end[1] - start[1]), start[2]];
}

function intersectAtY(start, end, y) {
  const dy = end[1] - start[1];
  if (math.fEq(dy, 0)) return [start[0], y, start[2]];
  const t = (y - start[1]) / dy;
  return [start[0] + t * (end[0] - start[0]), y, start[2]];
}

function cleanLoop(loop) {
  const cleaned = cleanAdjacentDuplicates(loop);
  if (
    cleaned.length > 1 &&
    samePoint2(cleaned[0], cleaned[cleaned.length - 1])
  ) {
    cleaned.pop();
  }
  if (cleaned.length < 3 || math.fEq(signedArea2(cleaned), 0)) {
    return [];
  }
  return cleaned;
}

function cleanAdjacentDuplicates(loop) {
  const result = [];
  for (const point of loop) {
    if (
      result.length === 0 ||
      !samePoint2(result[result.length - 1], point)
    ) {
      result.push(point);
    }
  }
  return result;
}

function signedArea2(loop) {
  let area = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const point = loop[index];
    const nextPoint = loop[(index + 1) % loop.length];
    area += point[0] * nextPoint[1] - nextPoint[0] * point[1];
  }
  return area / 2;
}

function samePoint2(left, right) {
  return math.fEq(left[0], right[0]) && math.fEq(left[1], right[1]);
}
