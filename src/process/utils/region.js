import { math } from "../../utils/math.js";

export const TYPE_EMPTY = 0;
export const TYPE_DIE = 1;
export const TYPE_TARGET = 2;

/**
 * Grid-based 2D region helper ported from the legacy Python Region class.
 *
 * The region is represented as cells cut by every input X/Y breakpoint. Cell
 * flags are then used to mark die area and target underfill gap area.
 */
export class Region {
  constructor(faceList = [], refFaceList = []) {
    this.cellType = [];
    this.cellNumX = 0;
    this.cellNumY = 0;
    this.tableXDim = [];
    this.tableYDim = [];
    this.faceList = [];
    this.refFaceList = [];

    if (Array.isArray(faceList) && faceList.length > 0) {
      this.set(faceList, refFaceList);
    }
  }

  _signedArea2(points) {
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      sum += x1 * y2 - x2 * y1;
    }
    return sum;
  }

  _isClockwise(polygon) {
    return this._signedArea2(polygon) < 0;
  }

  _is_clockwise(polygon) {
    return this._isClockwise(polygon);
  }

  _ensureOrientation(points, wantClockwise) {
    if (points.length < 3) return points;
    const isClockwise = this._isClockwise(points);
    return wantClockwise === isClockwise ? points : [...points].reverse();
  }

  _ensure_orientation(points, wantCw) {
    return this._ensureOrientation(points, wantCw);
  }

  _setPointX(targetX) {
    const x = finiteNumber(targetX, "x");
    for (let index = 0; index < this.tableXDim.length; index += 1) {
      const current = this.tableXDim[index];
      if (math.fEq(current, x)) return;
      if (math.fLt(current, x)) continue;

      const newColumn =
        index === 0
          ? Array(this.cellNumY).fill(TYPE_EMPTY)
          : [...this.cellType[index - 1]];
      this.cellType.splice(index, 0, newColumn);
      this.tableXDim.splice(index, 0, x);
      this.cellNumX += 1;
      return;
    }

    this.cellType.push(Array(this.cellNumY).fill(TYPE_EMPTY));
    this.tableXDim.push(x);
    this.cellNumX += 1;
  }

  _set_point_x(targetX) {
    this._setPointX(targetX);
  }

  _setPointY(targetY) {
    const y = finiteNumber(targetY, "y");
    for (let index = 0; index < this.tableYDim.length; index += 1) {
      const current = this.tableYDim[index];
      if (math.fEq(current, y)) return;
      if (math.fLt(current, y)) continue;

      for (let xIndex = 0; xIndex < this.cellType.length; xIndex += 1) {
        const value = index === 0 ? TYPE_EMPTY : this.cellType[xIndex][index - 1];
        this.cellType[xIndex].splice(index, 0, value);
      }
      this.tableYDim.splice(index, 0, y);
      this.cellNumY += 1;
      return;
    }

    for (const column of this.cellType) {
      column.push(TYPE_EMPTY);
    }
    this.tableYDim.push(y);
    this.cellNumY += 1;
  }

  _set_point_y(targetY) {
    this._setPointY(targetY);
  }

  _setPoint(x, y) {
    this._setPointX(x);
    this._setPointY(y);
  }

  _set_point(x, y) {
    this._setPoint(x, y);
  }

  set(faceList = [], refFaceList = []) {
    const totalFaces = [...faceList, ...refFaceList];
    for (const face of totalFaces) {
      if (face?.type !== "BOX" && face?.type !== "POLYGON") {
        throw new Error(`[Region] the face type ${face?.type} is not supported`);
      }
    }

    this.faceList = faceList.map(normalizeFace);
    this.refFaceList = refFaceList.map(normalizeFace);

    const xValues = new Map();
    const yValues = new Map();
    for (const face of [...this.faceList, ...this.refFaceList]) {
      if (face.type === "BOX") {
        const [x0, y0, x1, y1] = face.dim;
        xValues.set(x0, x0);
        xValues.set(x1, x1);
        yValues.set(y0, y0);
        yValues.set(y1, y1);
        continue;
      }
      for (const [x, y] of face.dim) {
        xValues.set(x, x);
        yValues.set(y, y);
      }
    }

    this.tableXDim = Array.from(xValues.values()).sort(numberSort);
    this.tableYDim = Array.from(yValues.values()).sort(numberSort);
    this.cellNumX = Math.max(0, this.tableXDim.length - 1);
    this.cellNumY = Math.max(0, this.tableYDim.length - 1);
    this.cellType = Array.from({ length: this.cellNumX }, () =>
      Array(this.cellNumY).fill(TYPE_EMPTY),
    );

    if (this.cellNumX === 0 || this.cellNumY === 0) return;

    const hullPolygons = [];
    const holePolygons = [];
    for (const face of this.faceList) {
      if (face.type === "BOX") {
        this._markBox(face.dim, TYPE_DIE);
        continue;
      }
      if (this._isClockwise(face.dim)) {
        hullPolygons.push(face.dim);
      } else {
        holePolygons.push(face.dim);
      }
    }
    this._markPolygons(hullPolygons, holePolygons, TYPE_DIE);
  }

  set_clear(clearMask = TYPE_TARGET) {
    for (let i = 0; i < this.cellNumX; i += 1) {
      for (let j = 0; j < this.cellNumY; j += 1) {
        if ((this.cellType[i][j] & clearMask) !== 0) {
          this.cellType[i][j] = TYPE_EMPTY;
        }
      }
    }
  }

  setBox(box, setTo = TYPE_TARGET) {
    const normalized = normalizeBox(box);
    this._setPoint(normalized[0], normalized[1]);
    this._setPoint(normalized[2], normalized[1]);
    this._setPoint(normalized[0], normalized[3]);
    this._setPoint(normalized[2], normalized[3]);
    this._markBox(normalized, setTo);
  }

  set_box(box, setTo = TYPE_TARGET) {
    this.setBox(box, setTo);
  }

  setPolygons(polygons, setTo = TYPE_TARGET) {
    const hullPolygons = [];
    const holePolygons = [];
    for (const polygon of polygons) {
      const normalized = normalizePolygon(polygon);
      for (const [x, y] of normalized) {
        this._setPoint(x, y);
      }
      if (this._isClockwise(normalized)) {
        hullPolygons.push(normalized);
      } else {
        holePolygons.push(normalized);
      }
    }
    this._markPolygons(hullPolygons, holePolygons, setTo);
  }

  set_polygons(polygons, setTo = TYPE_TARGET) {
    this.setPolygons(polygons, setTo);
  }

  setGap(gap, optionsOrSetTo = TYPE_TARGET, targetMaskArg, isRecursiveArg) {
    const {
      setTo,
      targetMask,
      isRecursive,
    } = normalizeSetGapOptions(optionsOrSetTo, targetMaskArg, isRecursiveArg);
    const maxGap = finiteNumber(gap, "gap");
    if (maxGap < 0) {
      throw new Error("gap must be non-negative");
    }

    let iterationCount = 0;
    while (true) {
      let didChange = false;
      for (let i = 0; i < this.cellNumX; i += 1) {
        for (let j = 0; j < this.cellNumY; j += 1) {
          if ((this.cellType[i][j] & targetMask) === 0) {
            if (i > 0 && (this.cellType[i - 1][j] & targetMask) !== 0) {
              let right = i + 1;
              while (true) {
                if (right >= this.cellNumX) {
                  right = -1;
                  break;
                }
                if ((this.cellType[right][j] & targetMask) !== 0) break;
                right += 1;
              }
              if (
                right !== -1 &&
                math.fLe(this.tableXDim[right] - this.tableXDim[i], maxGap)
              ) {
                for (let k = i; k < right; k += 1) {
                  didChange = this._setCellFlag(k, j, setTo) || didChange;
                }
              }
            }

            if (j > 0 && (this.cellType[i][j - 1] & targetMask) !== 0) {
              let upper = j + 1;
              while (true) {
                if (upper >= this.cellNumY) {
                  upper = -1;
                  break;
                }
                if ((this.cellType[i][upper] & targetMask) !== 0) break;
                upper += 1;
              }
              if (
                upper !== -1 &&
                math.fLe(this.tableYDim[upper] - this.tableYDim[j], maxGap)
              ) {
                for (let k = j; k < upper; k += 1) {
                  didChange = this._setCellFlag(i, k, setTo) || didChange;
                }
              }
            }
          }

          if ((this.cellType[i][j] & setTo) !== 0) {
            let left = i - 1;
            while (true) {
              if (left < 0) {
                left = -1;
                break;
              }
              if ((this.cellType[left][j] & targetMask) !== 0) {
                left += 1;
                break;
              }
              left -= 1;
            }
            if (
              left !== -1 &&
              math.fLe(this.tableXDim[i] - this.tableXDim[left], maxGap)
            ) {
              for (let k = left; k < i; k += 1) {
                didChange = this._setCellFlag(k, j, setTo) || didChange;
              }
            }
          }
        }
      }

      if (!isRecursive) return didChange;
      if (!didChange) break;
      iterationCount += 1;
    }
    return iterationCount !== 0;
  }

  set_gap(gap, setTo = TYPE_TARGET, targetMask = TYPE_DIE, isRecursive = false) {
    return this.setGap(gap, setTo, targetMask, isRecursive);
  }

  getOutline(targetMask = TYPE_TARGET, isDetail = false) {
    const loops = boundaryLoopsFromCells({
      cellType: this.cellType,
      cellNumX: this.cellNumX,
      cellNumY: this.cellNumY,
      tableXDim: this.tableXDim,
      tableYDim: this.tableYDim,
      targetMask,
    }).map((loop) => removeCollinearPoints(loop));

    const validLoops = loops.filter((loop) => loop.length >= 3);
    const oriented = orientNestedLoops(validLoops, this);
    if (!isDetail) return oriented;

    return oriented.map((loop) => ({
      type: "POLYGON",
      dim: loop,
      holes: [],
    }));
  }

  get_outline(targetMask = TYPE_TARGET, isDetail = false) {
    return this.getOutline(targetMask, isDetail);
  }

  _markBox(box, setTo) {
    for (let i = 0; i < this.cellNumX; i += 1) {
      const cx = (this.tableXDim[i] + this.tableXDim[i + 1]) / 2;
      for (let j = 0; j < this.cellNumY; j += 1) {
        const cy = (this.tableYDim[j] + this.tableYDim[j + 1]) / 2;
        if (box[0] < cx && cx < box[2] && box[1] < cy && cy < box[3]) {
          this.cellType[i][j] |= setTo;
        }
      }
    }
  }

  _markPolygons(hullPolygons, holePolygons, setTo) {
    if (hullPolygons.length === 0) return;
    for (let i = 0; i < this.cellNumX; i += 1) {
      const cx = (this.tableXDim[i] + this.tableXDim[i + 1]) / 2;
      for (let j = 0; j < this.cellNumY; j += 1) {
        const cy = (this.tableYDim[j] + this.tableYDim[j + 1]) / 2;
        const point = [cx, cy];
        const inHull = hullPolygons.some((polygon) => pointInLoop(point, polygon));
        if (!inHull) continue;
        const inHole = holePolygons.some((polygon) => pointInLoop(point, polygon));
        if (!inHole) this.cellType[i][j] |= setTo;
      }
    }
  }

  _setCellFlag(i, j, flag) {
    if ((this.cellType[i][j] & flag) !== 0) return false;
    this.cellType[i][j] |= flag;
    return true;
  }
}

function normalizeSetGapOptions(optionsOrSetTo, targetMaskArg, isRecursiveArg) {
  if (
    optionsOrSetTo !== null &&
    typeof optionsOrSetTo === "object" &&
    !Array.isArray(optionsOrSetTo)
  ) {
    return {
      setTo: optionsOrSetTo.setTo ?? TYPE_TARGET,
      targetMask: optionsOrSetTo.targetMask ?? TYPE_DIE,
      isRecursive: optionsOrSetTo.isRecursive === true,
    };
  }
  return {
    setTo: optionsOrSetTo ?? TYPE_TARGET,
    targetMask: targetMaskArg ?? TYPE_DIE,
    isRecursive: isRecursiveArg === true,
  };
}

function normalizeFace(face) {
  if (face.type === "BOX") {
    return { type: "BOX", dim: normalizeBox(face.dim) };
  }
  return { type: "POLYGON", dim: normalizePolygon(face.dim) };
}

function normalizeBox(box) {
  if (!Array.isArray(box) || box.length < 4) {
    throw new Error("BOX dim must be [x0, y0, x1, y1]");
  }
  const x0 = finiteNumber(box[0], "box[0]");
  const y0 = finiteNumber(box[1], "box[1]");
  const x1 = finiteNumber(box[2], "box[2]");
  const y1 = finiteNumber(box[3], "box[3]");
  if (math.fEq(x0, x1) || math.fEq(y0, y1)) {
    throw new Error("BOX dim must have non-zero width and height");
  }
  return [
    Math.min(x0, x1),
    Math.min(y0, y1),
    Math.max(x0, x1),
    Math.max(y0, y1),
  ];
}

function normalizePolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error("POLYGON dim must contain at least three points");
  }
  let result = polygon.map((point, index) => {
    if (!Array.isArray(point) || point.length < 2) {
      throw new Error(`POLYGON point ${index} must be [x, y]`);
    }
    return [
      finiteNumber(point[0], `polygon[${index}][0]`),
      finiteNumber(point[1], `polygon[${index}][1]`),
    ];
  });
  if (samePoint2(result[0], result[result.length - 1])) {
    result = result.slice(0, -1);
  }
  if (result.length < 3) {
    throw new Error("POLYGON dim must contain at least three unique points");
  }
  return result;
}

function boundaryLoopsFromCells({
  cellType,
  cellNumX,
  cellNumY,
  tableXDim,
  tableYDim,
  targetMask,
}) {
  const edges = [];
  const addEdge = (start, end, direction) => {
    edges.push({
      id: edges.length,
      start,
      end,
      startKey: pointKey(start),
      endKey: pointKey(end),
      direction,
    });
  };
  const isTarget = (i, j) =>
    i >= 0 &&
    i < cellNumX &&
    j >= 0 &&
    j < cellNumY &&
    (cellType[i][j] & targetMask) !== 0;

  for (let i = 0; i < cellNumX; i += 1) {
    for (let j = 0; j < cellNumY; j += 1) {
      if (!isTarget(i, j)) continue;
      const x0 = tableXDim[i];
      const x1 = tableXDim[i + 1];
      const y0 = tableYDim[j];
      const y1 = tableYDim[j + 1];
      if (!isTarget(i, j - 1)) addEdge([x0, y0], [x1, y0], 0);
      if (!isTarget(i + 1, j)) addEdge([x1, y0], [x1, y1], 1);
      if (!isTarget(i, j + 1)) addEdge([x1, y1], [x0, y1], 2);
      if (!isTarget(i - 1, j)) addEdge([x0, y1], [x0, y0], 3);
    }
  }

  const byStart = new Map();
  for (const edge of edges) {
    if (!byStart.has(edge.startKey)) byStart.set(edge.startKey, []);
    byStart.get(edge.startKey).push(edge);
  }

  const used = new Set();
  const loops = [];
  for (const firstEdge of edges) {
    if (used.has(firstEdge.id)) continue;
    const loop = [];
    let edge = firstEdge;
    const startKey = firstEdge.startKey;
    while (edge && !used.has(edge.id)) {
      used.add(edge.id);
      loop.push(edge.start);
      if (edge.endKey === startKey) break;
      const candidates = (byStart.get(edge.endKey) ?? []).filter(
        (candidate) => !used.has(candidate.id),
      );
      edge = chooseNextEdge(edge, candidates);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function chooseNextEdge(previous, candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const priority = new Map([
    [1, 0],
    [0, 1],
    [3, 2],
    [2, 3],
  ]);
  return [...candidates].sort((left, right) => {
    const leftTurn = (left.direction - previous.direction + 4) % 4;
    const rightTurn = (right.direction - previous.direction + 4) % 4;
    return priority.get(leftTurn) - priority.get(rightTurn);
  })[0];
}

function orientNestedLoops(loops, region) {
  return loops.map((loop) => {
    const depth = loops.filter(
      (other) => other !== loop && pointInLoop(loop[0], other),
    ).length;
    const wantClockwise = depth % 2 === 0;
    return region._ensureOrientation(loop, wantClockwise);
  });
}

function removeCollinearPoints(loop) {
  const result = [];
  for (let index = 0; index < loop.length; index += 1) {
    const previous = loop[(index - 1 + loop.length) % loop.length];
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    if (isCollinear(previous, current, next)) continue;
    result.push(current);
  }
  return result;
}

function isCollinear(a, b, c) {
  return math.fEq((b[0] - a[0]) * (c[1] - a[1]), (b[1] - a[1]) * (c[0] - a[0]));
}

function pointInLoop(point, loop) {
  const [x, y] = point;
  let inside = false;
  let previous = loop[loop.length - 1];

  for (const current of loop) {
    if (pointOnSegment(previous, point, current)) return true;
    const yiAbove = current[1] > y;
    const yjAbove = previous[1] > y;
    if (yiAbove !== yjAbove) {
      const xAtY =
        ((previous[0] - current[0]) * (y - current[1])) /
          (previous[1] - current[1]) +
        current[0];
      if (x < xAtY) inside = !inside;
    }
    previous = current;
  }

  return inside;
}

function pointOnSegment(a, b, c) {
  return orientation(a, c, b) === 0 && onSegment(a, b, c);
}

function orientation(a, b, c) {
  const value = (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
  if (math.fEq(value, 0)) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(a, b, c) {
  return (
    math.fLe(Math.min(a[0], c[0]), b[0]) &&
    math.fLe(b[0], Math.max(a[0], c[0])) &&
    math.fLe(Math.min(a[1], c[1]), b[1]) &&
    math.fLe(b[1], Math.max(a[1], c[1]))
  );
}

function samePoint2(left, right) {
  return math.fEq(left[0], right[0]) && math.fEq(left[1], right[1]);
}

function pointKey(point) {
  return `${point[0]},${point[1]}`;
}

function numberSort(left, right) {
  return left - right;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number`);
  }
  return number;
}

