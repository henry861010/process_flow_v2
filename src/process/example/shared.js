import { Body } from "../../data/body.js";
import { Bump } from "../../data/bump.js";

export function addExampleMoldingLayer(status, { material, density, thk }) {
  requireFinitePositive(thk, "molding thickness");
  requireFinitePositive(density, "density");
  const geometry = footprintGeometry(status, "example molding").copyWithThk(thk);
  const zNow = statusZNow(status);
  geometry.move({ z: zNow - geometry.zMin() });
  statusContainer(status, "example molding").addBody(new Body(geometry, material));
  setStatusZNow(status, zNow + thk);
  return status;
}

export function addExampleBump(status, { material, density, thk }) {
  requireFinitePositive(thk, "bump thickness");
  requireFinitePositive(density, "density");

  const container = statusContainer(status, "example bump");
  const body = lowestDirectBody(container.bodies());
  if (!body) {
    throw new Error("example bump requires at least one direct body");
  }

  const geometry = body.geometry().copyWithThk(thk);
  geometry.move({ z: body.zMin() - thk - geometry.zMin() });
  container.addBump(new Bump(geometry, density, material, "-z"));
  return status;
}

function footprintGeometry(status, processName) {
  const baseGeometry =
    typeof status?.baseGeometry === "function" ? status.baseGeometry() : null;
  if (baseGeometry) {
    return baseGeometry;
  }

  const body = lowestDirectBody(statusContainer(status, processName).bodies());
  if (!body) {
    throw new Error(`${processName} requires at least one direct body`);
  }
  return body.geometry();
}

function lowestDirectBody(bodies) {
  if (bodies.length === 0) return null;
  return bodies.reduce((lowest, body) =>
    body.zMin() < lowest.zMin() ? body : lowest,
  );
}

function statusContainer(status, processName) {
  const container = status?.container?.();
  if (!container) {
    throw new Error(`${processName} requires a status with a root container`);
  }
  return container;
}

function statusZNow(status) {
  if (typeof status?.zNow === "function") return status.zNow();
  if (typeof status?.z_now === "function") return status.z_now();
  throw new Error("status must provide zNow");
}

function setStatusZNow(status, zNow) {
  status._zNow = zNow;
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}
