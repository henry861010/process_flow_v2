import { Body } from "./body.js";
import { Bump } from "./bump.js";
import { Circuit } from "./circuit.js";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  type Geometry,
  type GeometryJson,
  type MoveInput,
  type Point3,
  type PolygonLoops,
  PolygonGeometry,
  moveArgs,
} from "./geometry.js";
import {
  DEFAULT_UNIT_SYSTEM,
  GEOMETRY_SCHEMA_VERSION,
  normalizeGeometryStructure,
} from "./schema.js";
import { Via } from "./via.js";

type ContainerOptions = {
  parent?: Container | null;
  key?: string;
};

export class Container {
  private _key: string;
  private _bodies: Body[];
  private _vias: Via[];
  private _circuits: Circuit[];
  private _bumps: Bump[];
  private _parent: Container | null;
  private _children: Container[];

  constructor(parentOrOptions: Container | ContainerOptions | null = null, keyArg = "") {
    const options: ContainerOptions =
      isContainerOptions(parentOrOptions)
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

  key(): string {
    return this._key;
  }

  parent(): Container | null {
    return this._parent;
  }

  _setParent(parent: Container | null): void {
    this._parent = parent;
  }

  children(): Container[] {
    return [...this._children];
  }

  bodies(): Body[] {
    return [...this._bodies];
  }

  vias(): Via[] {
    return [...this._vias];
  }

  circuits(): Circuit[] {
    return [...this._circuits];
  }

  bumps(): Bump[] {
    return [...this._bumps];
  }

  addBody(body: Body): Body {
    this._bodies.push(body);
    return body;
  }

  add_body(body: Body): Body {
    return this.addBody(body);
  }

  addVia(via: Via): Via {
    this._vias.push(via);
    return via;
  }

  add_via(via: Via): Via {
    return this.addVia(via);
  }

  addCircuit(circuit: Circuit): Circuit {
    this._circuits.push(circuit);
    return circuit;
  }

  add_circuit(circuit: Circuit): Circuit {
    return this.addCircuit(circuit);
  }

  addBump(bump: Bump): Bump {
    this._bumps.push(bump);
    return bump;
  }

  add_bump(bump: Bump): Bump {
    return this.addBump(bump);
  }

  addBodyBox(material: string, node1: Point3, node2: Point3, thk: number): Body {
    return this.addBody(new Body(new BoxGeometry(node1, node2, thk), material));
  }

  add_body_box(material: string, node1: Point3, node2: Point3, thk: number): Body {
    return this.addBodyBox(material, node1, node2, thk);
  }

  addBodyPolygon(material: string, polys: PolygonLoops, thk: number): Body {
    return this.addBody(new Body(new PolygonGeometry(polys, thk), material));
  }

  add_body_polygon(material: string, polys: PolygonLoops, thk: number): Body {
    return this.addBodyPolygon(material, polys, thk);
  }

  addBodyCylinder(material: string, center: Point3, bottomRadius: number, thk: number): Body {
    return this.addBody(
      new Body(new CylinderGeometry(center, bottomRadius, thk), material),
    );
  }

  add_body_cylinder(material: string, center: Point3, bottomRadius: number, thk: number): Body {
    return this.addBodyCylinder(material, center, bottomRadius, thk);
  }

  addBodyCone(
    material: string,
    center: Point3,
    bottomRadius: number,
    topRadius: number,
    thk: number,
  ): Body {
    return this.addBody(
      new Body(
        new ConeGeometry(center, bottomRadius, topRadius, thk),
        material,
      ),
    );
  }

  add_body_cone(
    material: string,
    center: Point3,
    bottomRadius: number,
    topRadius: number,
    thk: number,
  ): Body {
    return this.addBodyCone(material, center, bottomRadius, topRadius, thk);
  }

  attachChild(child: Container): Container {
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

  detachChild(child: Container): Container {
    const index = this._children.indexOf(child);
    if (index === -1) {
      throw new Error("detachChild child is not attached to this container");
    }
    const [removed] = this._children.splice(index, 1);
    removed._setParent(null);
    return removed;
  }

  addChild(child: Container): Container {
    return this.attachChild(child);
  }

  add_child(child: Container): Container {
    return this.attachChild(child);
  }

  thk(): number {
    return this.zMax() - this.zMin();
  }

  zMax(): number {
    const values = this._directFeatures().map((feature) => feature.zMax());
    values.push(...this._children.map((child) => child.zMax()));
    return values.length === 0 ? 0 : Math.max(...values);
  }

  z_max(): number {
    return this.zMax();
  }

  zMin(): number {
    const values = this._directFeatures().map((feature) => feature.zMin());
    values.push(...this._children.map((child) => child.zMin()));
    return values.length === 0 ? 0 : Math.min(...values);
  }

  z_min(): number {
    return this.zMin();
  }

  copy(): Container {
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

  move(...args: MoveInput[]): void {
    const { x, y, z } = moveArgs(args);
    this._directFeatures().forEach((feature) => feature.move({ x, y, z }));
    this._children.forEach((child) => child.move({ x, y, z }));
  }

  grindTo(toZ: number): boolean {
    this._vias = this._featuresAfterClip(this._vias, toZ);
    this._circuits = this._featuresAfterClip(this._circuits, toZ);
    this._bumps = this._featuresAfterClip(this._bumps, toZ);
    this._bodies = this._featuresAfterClip(this._bodies, toZ);

    const children: Container[] = [];
    this._children.forEach((child) => {
      if (child.grindTo(toZ)) {
        children.push(child);
      }
    });
    this._children = children;

    return this.hasGeometry();
  }

  grind_to(toZ: number): boolean {
    return this.grindTo(toZ);
  }

  flip(aroundZ = 0): void {
    this._directFeatures().forEach((feature) => feature.flip(aroundZ));
    this._children.forEach((child) => child.flip(aroundZ));
  }

  hasGeometry(): boolean {
    return (
      this._bodies.length > 0 ||
      this._vias.length > 0 ||
      this._circuits.length > 0 ||
      this._bumps.length > 0 ||
      this._children.some((child) => child.hasGeometry())
    );
  }

  has_geometry(): boolean {
    return this.hasGeometry();
  }

  treeJson(): GeometryJson {
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
  ): GeometryJson {
    return normalizeGeometryStructure(this.treeJson(), schemaVersion, unitSystem);
  }

  toJSON(): GeometryJson {
    return this.json();
  }

  _directFeatures(): Geometry[] {
    return [
      ...this._bodies,
      ...this._vias,
      ...this._circuits,
      ...this._bumps,
    ];
  }

  _featuresAfterClip<T extends Geometry>(features: T[], toZ: number): T[] {
    return features.filter((feature) => feature.clipTopTo(toZ));
  }

  _isDescendantOf(container: Container): boolean {
    let current: Container | null = this;
    while (current !== null) {
      if (current === container) return true;
      current = current.parent();
    }
    return false;
  }
}

export { Body, Bump, Circuit, Via };

function isContainerOptions(value: unknown): value is ContainerOptions {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.hasOwn(value, "parent") || Object.hasOwn(value, "key"))
  );
}
