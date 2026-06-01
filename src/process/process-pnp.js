/**
 * Pick and place die container copies onto the target process status.
 *
 * Each coordinate places one copy of `status2`'s root container under
 * `status1`'s root container. The placed die's lower-left xy corner is aligned
 * to the coordinate, and its bottom z is aligned to `status1.zNow()`.
 *
 * @param {import("./status.js").Status} status1 - Target wafer/carrier status.
 * @param {import("./status.js").Status} status2 - Source die status.
 * @param {Array<number[]|{x: number, y: number}>} coordinates - Placement xy
 *   coordinates.
 * @returns {import("./status.js").Status} The target status after placement.
 */
export function processPnp(status1, status2, coordinates = []) {
  const targetContainer = statusContainer(status1, "status1");
  const sourceContainer = statusContainer(status2, "status2");
  const targetZ = statusZNow(status1);

  if (!Array.isArray(coordinates)) {
    throw new Error("coordinates must be an array");
  }
  if (coordinates.length === 0) return status1;

  const sourceBounds = containerBounds(sourceContainer);
  coordinates.forEach((coordinate) => {
    const { x, y } = coordinatePoint(coordinate);
    const die = sourceContainer.copy();
    die.move({
      x: x - sourceBounds.xMin,
      y: y - sourceBounds.yMin,
      z: targetZ - sourceBounds.zMin,
    });
    targetContainer.addChild(die);
  });

  return status1;
}

export const process_pnp = processPnp;

function statusContainer(status, name) {
  const container = status?.container?.();
  if (container === undefined || container === null) {
    throw new Error(`${name} must provide a root container`);
  }
  return container;
}

function statusZNow(status) {
  if (typeof status?.zNow === "function") return status.zNow();
  if (typeof status?.z_now === "function") return status.z_now();
  throw new Error("status1 must provide zNow");
}

function coordinatePoint(coordinate) {
  if (Array.isArray(coordinate) && coordinate.length >= 2) {
    return requireFinitePoint(coordinate[0], coordinate[1]);
  }
  if (coordinate !== null && typeof coordinate === "object") {
    return requireFinitePoint(coordinate.x, coordinate.y);
  }
  throw new Error(
    "coordinates must contain [x, y] arrays or { x, y } objects",
  );
}

function requireFinitePoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("coordinate x and y must be finite numbers");
  }
  return { x, y };
}

function containerBounds(container) {
  const bounds = [];
  collectContainerBounds(container, bounds);

  if (bounds.length === 0) {
    throw new Error("status2 root container must contain geometry");
  }

  return bounds.reduce((aggregate, item) => ({
    xMin: Math.min(aggregate.xMin, item.xMin),
    yMin: Math.min(aggregate.yMin, item.yMin),
    zMin: Math.min(aggregate.zMin, item.zMin),
  }));
}

function collectContainerBounds(container, bounds) {
  [
    ...container.bodies(),
    ...container.vias(),
    ...container.circuits(),
    ...container.bumps(),
  ].forEach((feature) => {
    bounds.push(geometryBounds(feature.geometry()));
  });

  container.children().forEach((child) => {
    collectContainerBounds(child, bounds);
  });
}

function geometryBounds(geometry) {
  if (
    typeof geometry.bottomLeft === "function" &&
    typeof geometry.topRight === "function"
  ) {
    const bottomLeft = geometry.bottomLeft();
    const topRight = geometry.topRight();
    return {
      xMin: Math.min(bottomLeft[0], topRight[0]),
      yMin: Math.min(bottomLeft[1], topRight[1]),
      zMin: geometry.zMin(),
    };
  }

  if (typeof geometry.polygons === "function") {
    const nodes = geometry.polygons().flat();
    return {
      xMin: Math.min(...nodes.map((node) => node[0])),
      yMin: Math.min(...nodes.map((node) => node[1])),
      zMin: geometry.zMin(),
    };
  }

  if (
    typeof geometry.center === "function" &&
    typeof geometry.bottomRadius === "function"
  ) {
    const center = geometry.center();
    const bottomRadius = geometry.bottomRadius();
    const topRadius =
      typeof geometry.topRadius === "function"
        ? geometry.topRadius()
        : bottomRadius;
    const radius = Math.max(bottomRadius, topRadius);
    return {
      xMin: center[0] - radius,
      yMin: center[1] - radius,
      zMin: geometry.zMin(),
    };
  }

  throw new Error("unsupported geometry type for process_pnp placement");
}
