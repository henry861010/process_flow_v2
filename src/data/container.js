import { Body } from "./body.js";
import { Bump } from "./bump.js";
import { Circuit } from "./circuit.js";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  PolygonGeometry,
  moveArgs,
} from "./geometry.js";
import {
  DEFAULT_UNIT_SYSTEM,
  GEOMETRY_SCHEMA_VERSION,
  normalizeGeometryStructure,
} from "./schema.js";
import { Via } from "./via.js";

export class Container {
  constructor(parentOrOptions = null, keyArg = "") {
    const options =
      parentOrOptions !== null &&
      typeof parentOrOptions === "object" &&
      (Object.hasOwn(parentOrOptions, "parent") ||
        Object.hasOwn(parentOrOptions, "key"))
        ? parentOrOptions
        : { parent: parentOrOptions, key: keyArg };
    const { parent = null, key = "" } = options;

    this._key = key;
    this._bodies = [];
    this._vias = [];
    this._circuits = [];
    this._bumps = [];
    this._parent = parent;
    this._children = [];
  }

  key() {
    return this._key;
  }

  parent() {
    return this._parent;
  }

  _setParent(parent) {
    this._parent = parent;
  }

  children() {
    return [...this._children];
  }

  bodies() {
    return [...this._bodies];
  }

  vias() {
    return [...this._vias];
  }

  circuits() {
    return [...this._circuits];
  }

  bumps() {
    return [...this._bumps];
  }

  addBody(body) {
    this._bodies.push(body);
    return body;
  }

  add_body(body) {
    return this.addBody(body);
  }

  addVia(via) {
    this._vias.push(via);
    return via;
  }

  add_via(via) {
    return this.addVia(via);
  }

  addCircuit(circuit) {
    this._circuits.push(circuit);
    return circuit;
  }

  add_circuit(circuit) {
    return this.addCircuit(circuit);
  }

  addBump(bump) {
    this._bumps.push(bump);
    return bump;
  }

  add_bump(bump) {
    return this.addBump(bump);
  }

  addBodyBox(material, node1, node2, thk) {
    return this.addBody(new Body(new BoxGeometry(node1, node2, thk), material));
  }

  add_body_box(material, node1, node2, thk) {
    return this.addBodyBox(material, node1, node2, thk);
  }

  addBodyPolygon(material, polys, thk) {
    return this.addBody(new Body(new PolygonGeometry(polys, thk), material));
  }

  add_body_polygon(material, polys, thk) {
    return this.addBodyPolygon(material, polys, thk);
  }

  addBodyCylinder(material, center, bottomRadius, thk) {
    return this.addBody(
      new Body(new CylinderGeometry(center, bottomRadius, thk), material),
    );
  }

  add_body_cylinder(material, center, bottomRadius, thk) {
    return this.addBodyCylinder(material, center, bottomRadius, thk);
  }

  addBodyCone(material, center, bottomRadius, topRadius, thk) {
    return this.addBody(
      new Body(
        new ConeGeometry(center, bottomRadius, topRadius, thk),
        material,
      ),
    );
  }

  add_body_cone(material, center, bottomRadius, topRadius, thk) {
    return this.addBodyCone(material, center, bottomRadius, topRadius, thk);
  }

  attachChild(child) {
    if (!(child instanceof Container)) {
      throw new Error("attachChild requires a Container child");
    }
    if (child === this) {
      throw new Error("attachChild cannot attach a container to itself");
    }
    if (this._isDescendantOf(child)) {
      throw new Error("attachChild cannot create a container cycle");
    }
    if (this._children.includes(child)) {
      throw new Error("attachChild cannot attach the same child twice");
    }
    const parent = child.parent();
    if (parent !== null) {
      parent.detachChild(child);
    }
    child._setParent(this);
    this._children.push(child);
    return child;
  }

  detachChild(child) {
    const index = this._children.indexOf(child);
    if (index === -1) {
      throw new Error("detachChild child is not attached to this container");
    }
    const [removed] = this._children.splice(index, 1);
    removed._setParent(null);
    return removed;
  }

  addChild(child) {
    return this.attachChild(child);
  }

  add_child(child) {
    return this.attachChild(child);
  }

  thk() {
    return this.zMax() - this.zMin();
  }

  zMax() {
    const values = this._directFeatures().map((feature) => feature.zMax());
    values.push(...this._children.map((child) => child.zMax()));
    return values.length === 0 ? 0 : Math.max(...values);
  }

  z_max() {
    return this.zMax();
  }

  zMin() {
    const values = this._directFeatures().map((feature) => feature.zMin());
    values.push(...this._children.map((child) => child.zMin()));
    return values.length === 0 ? 0 : Math.min(...values);
  }

  z_min() {
    return this.zMin();
  }

  copy() {
    const copyContainer = new Container({ key: this.key() });

    this._bodies.forEach((body) => copyContainer.addBody(body.copy()));
    this._vias.forEach((via) => copyContainer.addVia(via.copy()));
    this._circuits.forEach((circuit) => {
      copyContainer.addCircuit(circuit.copy());
    });
    this._bumps.forEach((bump) => copyContainer.addBump(bump.copy()));
    this._children.forEach((child) => copyContainer.attachChild(child.copy()));

    return copyContainer;
  }

  move(...args) {
    const { x, y, z } = moveArgs(args);
    this._directFeatures().forEach((feature) => feature.move({ x, y, z }));
    this._children.forEach((child) => child.move({ x, y, z }));
  }

  grindTo(toZ) {
    this._vias = this._featuresAfterClip(this._vias, toZ);
    this._circuits = this._featuresAfterClip(this._circuits, toZ);
    this._bumps = this._featuresAfterClip(this._bumps, toZ);
    this._bodies = this._featuresAfterClip(this._bodies, toZ);

    const children = [];
    this._children.forEach((child) => {
      if (child.grindTo(toZ)) {
        children.push(child);
      }
    });
    this._children = children;

    return this.hasGeometry();
  }

  grind_to(toZ) {
    return this.grindTo(toZ);
  }

  flip(aroundZ = 0) {
    this._directFeatures().forEach((feature) => feature.flip(aroundZ));
    this._children.forEach((child) => child.flip(aroundZ));
  }

  hasGeometry() {
    return (
      this._bodies.length > 0 ||
      this._vias.length > 0 ||
      this._circuits.length > 0 ||
      this._bumps.length > 0 ||
      this._children.some((child) => child.hasGeometry())
    );
  }

  has_geometry() {
    return this.hasGeometry();
  }

  treeJson() {
    return {
      key: this._key,
      bodies: this._bodies.map((body) => body.json()),
      vias: this._vias.map((via) => via.json()),
      circuits: this._circuits.map((circuit) => circuit.json()),
      bumps: this._bumps.map((bump) => bump.json()),
      children: this._children.map((child) => child.treeJson()),
    };
  }

  tree_json() {
    return this.treeJson();
  }

  json(
    schemaVersion = GEOMETRY_SCHEMA_VERSION,
    unitSystem = DEFAULT_UNIT_SYSTEM,
  ) {
    return normalizeGeometryStructure(this.treeJson(), schemaVersion, unitSystem);
  }

  toJSON() {
    return this.json();
  }

  _directFeatures() {
    return [
      ...this._bodies,
      ...this._vias,
      ...this._circuits,
      ...this._bumps,
    ];
  }

  _featuresAfterClip(features, toZ) {
    return features.filter((feature) => feature.clipTopTo(toZ));
  }

  _isDescendantOf(container) {
    let current = this;
    while (current !== null) {
      if (current === container) return true;
      current = current.parent();
    }
    return false;
  }
}

export { Body, Bump, Circuit, Via };
