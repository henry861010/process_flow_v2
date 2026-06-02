import { Body } from "../data/body.js";
import { Bump } from "../data/bump.js";
import { Circuit } from "../data/circuit.js";
import { Container } from "../data/container.js";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  PolygonGeometry,
} from "../data/geometry.js";
import { normalizeGeometryDocument } from "../data/schema.js";
import { Via } from "../data/via.js";
import { Status } from "../process/status.js";

/**
 * Rebuild a mutable Container object from a stored geometry document.
 */
export function geometryDocumentToContainer(payload) {
  const document = normalizeGeometryDocument(payload);
  return containerFromJson(document.root);
}

/**
 * Rebuild a Status object so process steps can continue from stored geometry.
 *
 * The restored Status uses the document's container as current geometry,
 * infers a base footprint from the first body, and sets zNow to the top of the
 * container.
 */
export function geometryDocumentToStatus(payload) {
  const container = geometryDocumentToContainer(payload);
  const status = new Status();
  status._container = container;
  status._baseGeometry = inferBaseGeometry(container);
  status._zNow = container.zMax();
  return status;
}

/**
 * Convert a Status-like value back into normalized geometry JSON.
 */
export function statusToGeometryDocument(status) {
  if (status?.container && typeof status.container === "function") {
    return status.container().json();
  }
  if (status?.json && typeof status.json === "function") {
    return status.json();
  }
  return normalizeGeometryDocument(status);
}

/**
 * Serialize a Container object as a normalized geometry document.
 */
export function containerToGeometryDocument(container) {
  return container.json();
}

/**
 * Recursively convert container JSON into Container, Body, Via, Circuit, and
 * Bump instances.
 */
function containerFromJson(container) {
  const result = new Container({ key: container.key ?? "" });

  for (const body of container.bodies ?? []) {
    result.addBody(new Body(geometryFromJson(body.geometry), body.material));
  }
  for (const via of container.vias ?? []) {
    result.addVia(new Via(geometryFromJson(via.geometry), via.density, via.material));
  }
  for (const circuit of container.circuits ?? []) {
    result.addCircuit(
      new Circuit(geometryFromJson(circuit.geometry), circuit.density, circuit.material),
    );
  }
  for (const bump of container.bumps ?? []) {
    result.addBump(new Bump(geometryFromJson(bump.geometry), bump.density, bump.material));
  }
  for (const child of container.children ?? []) {
    result.addChild(containerFromJson(child));
  }

  return result;
}

/**
 * Rebuild the correct geometry subclass from its explicit primitive type.
 */
function geometryFromJson(geometry) {
  assertGeometryObject(geometry);

  switch (geometry.type) {
    case "BoxGeometry":
      return new BoxGeometry(
        geometryField(geometry, "bottom_left"),
        geometryField(geometry, "top_right"),
        geometryField(geometry, "thk"),
      );
    case "PolygonGeometry":
      return new PolygonGeometry(
        geometryField(geometry, "polys"),
        geometryField(geometry, "thk"),
      );
    case "CylinderGeometry":
      return new CylinderGeometry(
        geometryField(geometry, "center"),
        geometryField(geometry, "bottom_radius"),
        geometryField(geometry, "thk"),
      );
    case "ConeGeometry":
      return new ConeGeometry(
        geometryField(geometry, "center"),
        geometryField(geometry, "bottom_radius"),
        geometryField(geometry, "top_radius"),
        geometryField(geometry, "thk"),
      );
    default:
      throw new Error(`Unsupported geometry type: ${geometry.type}`);
  }
}

function assertGeometryObject(geometry) {
  if (geometry === null || typeof geometry !== "object" || Array.isArray(geometry)) {
    throw new Error(`Unsupported geometry payload: ${JSON.stringify(geometry)}`);
  }
}

function geometryField(geometry, fieldName) {
  if (!Object.hasOwn(geometry, fieldName)) {
    throw new Error(`Geometry ${geometry.type} missing field ${fieldName}`);
  }
  return geometry[fieldName];
}

/**
 * Choose a footprint geometry that future fill/via/circuit operations can copy.
 */
function inferBaseGeometry(container) {
  const bodies = container.bodies();
  if (bodies.length > 0) {
    return bodies[0].geometry();
  }
  for (const child of container.children()) {
    const geometry = inferBaseGeometry(child);
    if (geometry !== null) return geometry;
  }
  return null;
}
