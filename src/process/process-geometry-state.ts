import { Body } from "../data/body.js";
import { Bump } from "../data/bump.js";
import { Circuit } from "../data/circuit.js";
import { Container } from "../data/container.js";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  type Geometry,
  type Point3,
  PolygonGeometry,
} from "../data/geometry.js";
import {
  DEFAULT_UNIT_SYSTEM,
  GEOMETRY_SCHEMA_VERSION,
  deepCopy,
  normalizeGeometryStructure,
} from "../data/schema.js";
import { Via } from "../data/via.js";

const ROOT_SCOPE = "root";

type Bounds = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
};

export class ProcessGeometryState {
  private _root: Container;
  private _cursorZ: number;
  private _processFootprint: any;
  private _schemaVersion: string;
  private _unitSystem: string;
  private _scopeIds: WeakMap<Container, string>;
  private _scopesById: Map<string, Container>;
  private _nextScopeId: number;
  private _nextHandleId: number;

  constructor({
    root = new Container({ key: "main" }),
    cursorZ = 0,
    processFootprint = null,
    schemaVersion = GEOMETRY_SCHEMA_VERSION,
    unitSystem = DEFAULT_UNIT_SYSTEM,
  }: any = {}) {
    this._root = root;
    this._cursorZ = finiteNumber(cursorZ, "cursorZ");
    this._processFootprint =
      processFootprint === null ? null : normalizeFootprintSpec(processFootprint);
    this._schemaVersion = schemaVersion;
    this._unitSystem = unitSystem;
    this._scopeIds = new WeakMap();
    this._scopesById = new Map();
    this._nextScopeId = 1;
    this._nextHandleId = 1;
    this._registerScopeTree(this._root);
  }

  static create(options: any = {}) {
    const {
      key = "main",
      unitSystem = DEFAULT_UNIT_SYSTEM,
      schemaVersion = GEOMETRY_SCHEMA_VERSION,
    } = options;
    return new ProcessGeometryState({
      root: new Container({ key }),
      unitSystem,
      schemaVersion,
    });
  }

  static fromStructure(payload: any, options: any = {}) {
    const structure = normalizeGeometryStructure(payload);
    const root = containerFromPayload(structure.root);
    const cursorZ =
      options.cursorZ === undefined || options.cursorZ === "geometryTop"
        ? root.zMax()
        : options.cursorZ;
    const processFootprint = resolveRestoreFootprint(root, options.footprint);
    return new ProcessGeometryState({
      root,
      cursorZ,
      processFootprint,
      schemaVersion: structure.schemaVersion,
      unitSystem: structure.unitSystem,
    });
  }

  clone() {
    return ProcessGeometryState.fromStructure(this.toGeometryStructure(), {
      cursorZ: this._cursorZ,
      footprint: this._processFootprint,
    });
  }

  toGeometryStructure(schemaVersion = this._schemaVersion, unitSystem = this._unitSystem) {
    return this._root.json(schemaVersion, unitSystem);
  }

  cursorZ() {
    return this._cursorZ;
  }

  setCursorZ(z) {
    this._cursorZ = finiteNumber(z, "z");
    return this;
  }

  advanceCursorBy(thickness) {
    this._cursorZ += positiveNumber(thickness, "thickness");
    return this;
  }

  advanceCursorTo(z) {
    const targetZ = finiteNumber(z, "z");
    if (targetZ < this._cursorZ) {
      throw new Error("advanceCursorTo requires z to be at or above cursorZ");
    }
    this._cursorZ = targetZ;
    return this;
  }

  geometryZMin() {
    return this._root.zMin();
  }

  geometryZMax() {
    return this._root.zMax();
  }

  zBounds() {
    return { min: this.geometryZMin(), max: this.geometryZMax() };
  }

  bounds(scope = ROOT_SCOPE) {
    return containerBounds(this._resolveScope(scope));
  }

  setProcessFootprint(footprint) {
    this._processFootprint = normalizeFootprintSpec(footprint);
    return this;
  }

  setBoxFootprint({ bottomLeft, topRight }) {
    return this.setProcessFootprint({ type: "box", bottomLeft, topRight });
  }

  setCylinderFootprint({ center, radius }) {
    return this.setProcessFootprint({ type: "cylinder", center, radius });
  }

  setPolygonFootprint({ polygons }) {
    return this.setProcessFootprint({ type: "polygon", polygons });
  }

  processFootprint() {
    return this._processFootprint === null ? null : deepCopy(this._processFootprint);
  }

  requireProcessFootprint() {
    if (this._processFootprint === null) {
      throw new Error(
        "process footprint is required. Call initialize...Layer or setProcessFootprint first.",
      );
    }
    return deepCopy(this._processFootprint);
  }

  deriveProcessFootprint({ from = "largestRootBody", scope = ROOT_SCOPE }: any = {}) {
    this._processFootprint = deriveFootprintFromContainer(
      this._resolveScope(scope),
      from,
    );
    return this;
  }

  initializeLayer({
    key = null,
    material,
    geometry,
    setFootprint = true,
    cursorZ = "top",
    scope = ROOT_SCOPE,
  }: any = {}) {
    const primitive = geometryFromSpec(geometry);
    const body = this._addBodyObject(new Body(primitive, requireString(material, "material")), {
      scope,
    });
    if (setFootprint) {
      this._processFootprint = footprintFromGeometry(primitive);
    }
    if (cursorZ === "top") {
      this._cursorZ = primitive.zMax();
    } else {
      this.setCursorZ(cursorZ);
    }
    void key;
    return body;
  }

  initializeBoxLayer(options: any = {}) {
    const { material, bottomLeft, topRight, thickness, setFootprint = true } = options;
    return this.initializeLayer({
      material,
      geometry: { type: "box", bottomLeft, topRight, thickness },
      setFootprint,
    });
  }

  initializeCylinderLayer(options: any = {}) {
    const { material, center, radius, thickness, setFootprint = true } = options;
    return this.initializeLayer({
      material,
      geometry: { type: "cylinder", center, radius, thickness },
      setFootprint,
    });
  }

  initializePolygonLayer(options: any = {}) {
    const { material, polygons, thickness, setFootprint = true } = options;
    return this.initializeLayer({
      material,
      geometry: { type: "polygon", polygons, thickness },
      setFootprint,
    });
  }

  initializeConeLayer(options: any = {}) {
    const {
      material,
      center,
      bottomRadius,
      topRadius,
      thickness,
      setFootprint = false,
    } = options;
    return this.initializeLayer({
      material,
      geometry: { type: "cone", center, bottomRadius, topRadius, thickness },
      setFootprint,
    });
  }

  depositLayer({
    material,
    thickness,
    z = this._cursorZ,
    advanceCursor = true,
    scope = ROOT_SCOPE,
  }: any = {}) {
    const layerThickness = positiveNumber(thickness, "thickness");
    const bottomZ = finiteNumber(z, "z");
    const geometry = geometryFromFootprint(
      this.requireProcessFootprint(),
      bottomZ,
      layerThickness,
    );
    const handle = this._addBodyObject(
      new Body(geometry, requireString(material, "material")),
      { scope },
    );
    if (advanceCursor) this._cursorZ = bottomZ + layerThickness;
    return handle;
  }

  fillTo({ material, z, scope = ROOT_SCOPE }: any = {}) {
    const targetZ = finiteNumber(z, "z");
    if (targetZ <= this._cursorZ) {
      throw new Error("fillTo requires z to be above cursorZ");
    }
    return this.depositLayer({
      material,
      thickness: targetZ - this._cursorZ,
      z: this._cursorZ,
      advanceCursor: true,
      scope,
    });
  }

  depositGeometry({
    material,
    geometry,
    advanceCursor = false,
    scope = ROOT_SCOPE,
  }: any = {}) {
    const primitive = geometryFromSpec(geometry);
    const handle = this._addBodyObject(
      new Body(primitive, requireString(material, "material")),
      { scope },
    );
    if (advanceCursor) this._cursorZ = primitive.zMax();
    return handle;
  }

  depositBoxLayer(options: any = {}) {
    const { material, bottomLeft, topRight, thickness, advanceCursor, scope } = options;
    return this.depositGeometry({
      material,
      geometry: { type: "box", bottomLeft, topRight, thickness },
      advanceCursor,
      scope,
    });
  }

  depositCylinderLayer(options: any = {}) {
    const { material, center, radius, thickness, advanceCursor, scope } = options;
    return this.depositGeometry({
      material,
      geometry: { type: "cylinder", center, radius, thickness },
      advanceCursor,
      scope,
    });
  }

  depositPolygonLayer(options: any = {}) {
    const { material, polygons, thickness, advanceCursor, scope } = options;
    return this.depositGeometry({
      material,
      geometry: { type: "polygon", polygons, thickness },
      advanceCursor,
      scope,
    });
  }

  depositConeLayer(options: any = {}) {
    const {
      material,
      center,
      bottomRadius,
      topRadius,
      thickness,
      advanceCursor,
      scope,
    } = options;
    return this.depositGeometry({
      material,
      geometry: { type: "cone", center, bottomRadius, topRadius, thickness },
      advanceCursor,
      scope,
    });
  }

  addVia({ material, density, direction, geometry, scope = ROOT_SCOPE }: any = {}) {
    return this._addFeatureObject(
      new Via(
        geometryFromSpec(geometry),
        finiteNumber(density, "density"),
        requireString(material, "material"),
        requireDirection(direction, "via direction"),
      ),
      "via",
      scope,
    );
  }

  addViaBelowCursor({
    material,
    density,
    thickness,
    direction = "-z",
    scope = ROOT_SCOPE,
  }: any = {}) {
    const viaThickness = positiveNumber(thickness, "thickness");
    const geometry = geometryFromFootprint(
      this.requireProcessFootprint(),
      this._cursorZ - viaThickness,
      viaThickness,
    );
    return this._addFeatureObject(
      new Via(
        geometry,
        finiteNumber(density, "density"),
        requireString(material, "material"),
        requireDirection(direction, "via direction"),
      ),
      "via",
      scope,
    );
  }

  addViaAboveCursor({
    material,
    density,
    thickness,
    direction = "+z",
    scope = ROOT_SCOPE,
  }: any = {}) {
    const viaThickness = positiveNumber(thickness, "thickness");
    const geometry = geometryFromFootprint(
      this.requireProcessFootprint(),
      this._cursorZ,
      viaThickness,
    );
    return this._addFeatureObject(
      new Via(
        geometry,
        finiteNumber(density, "density"),
        requireString(material, "material"),
        requireDirection(direction, "via direction"),
      ),
      "via",
      scope,
    );
  }

  addCircuit({ material, density, geometry, scope = ROOT_SCOPE }: any = {}) {
    return this._addFeatureObject(
      new Circuit(
        geometryFromSpec(geometry),
        finiteNumber(density, "density"),
        requireString(material, "material"),
      ),
      "circuit",
      scope,
    );
  }

  addCircuitAtCursor({ material, density, thickness, scope = ROOT_SCOPE }: any = {}) {
    const circuitThickness = positiveNumber(thickness, "thickness");
    return this._addFeatureObject(
      new Circuit(
        geometryFromFootprint(
          this.requireProcessFootprint(),
          this._cursorZ,
          circuitThickness,
        ),
        finiteNumber(density, "density"),
        requireString(material, "material"),
      ),
      "circuit",
      scope,
    );
  }

  addBump({ material, density, direction, geometry, scope = ROOT_SCOPE }: any = {}) {
    return this._addFeatureObject(
      new Bump(
        geometryFromSpec(geometry),
        finiteNumber(density, "density"),
        requireString(material, "material"),
        requireDirection(direction, "bump direction"),
      ),
      "bump",
      scope,
    );
  }

  addBumpBelowLowestBody({
    material,
    density,
    thickness,
    direction = "-z",
    scope = ROOT_SCOPE,
  }: any = {}) {
    const targetScope = this._resolveScope(scope);
    const body = lowestDirectBody(targetScope);
    if (body === null) {
      throw new Error(
        "addBumpBelowLowestBody requires at least one direct body in the target scope",
      );
    }
    const bumpThickness =
      thickness === undefined ? body.thk() : positiveNumber(thickness, "thickness");
    const geometry = body.geometry().copyWithThk(bumpThickness);
    geometry.move({ z: body.zMin() - bumpThickness - geometry.zMin() });
    return this._addFeatureObject(
      new Bump(
        geometry,
        finiteNumber(density, "density"),
        requireString(material, "material"),
        requireDirection(direction, "bump direction"),
      ),
      "bump",
      targetScope,
    );
  }

  move({ x = 0, y = 0, z = 0, scope = ROOT_SCOPE, moveCursor = false }: any = {}) {
    const offset = {
      x: finiteNumber(x, "x"),
      y: finiteNumber(y, "y"),
      z: finiteNumber(z, "z"),
    };
    this._resolveScope(scope).move(offset);
    if (moveCursor) this._cursorZ += offset.z;
    return this;
  }

  flipAroundZ({
    z = 0,
    scope = ROOT_SCOPE,
    normalizeZMinToZero = true,
    updateCursor = true,
  }: any = {}) {
    const targetScope = this._resolveScope(scope);
    targetScope.flip(finiteNumber(z, "z"));
    if (normalizeZMinToZero) {
      targetScope.move({ z: -targetScope.zMin() });
    }
    if (updateCursor) {
      this._cursorZ = targetScope.zMax();
    }
    return this;
  }

  grindTo({ z, scope = ROOT_SCOPE, updateCursor = true }: any = {}) {
    const toZ = finiteNumber(z, "z");
    this._resolveScope(scope).grindTo(toZ);
    if (updateCursor) {
      this._cursorZ = Math.min(this._cursorZ, toZ);
    }
    return this;
  }

  placeGeometryState(source: ProcessGeometryState, options: any = {}) {
    if (!(source instanceof ProcessGeometryState)) {
      throw new Error("placeGeometryState requires a ProcessGeometryState source");
    }
    const {
      x,
      y,
      bottomZ = this._cursorZ,
      anchor = "bottomLeft",
      clone = true,
      scope = ROOT_SCOPE,
    } = options;
    const placed = clone ? source._root.copy() : source._root;
    const sourceBounds = containerBounds(placed);
    const targetPoint = anchorPoint(sourceBounds, anchor);
    placed.move({
      x: finiteNumber(x, "x") - targetPoint.x,
      y: finiteNumber(y, "y") - targetPoint.y,
      z: finiteNumber(bottomZ, "bottomZ") - sourceBounds.zMin,
    });
    const parent = this._resolveScope(scope);
    parent.attachChild(placed);
    this._registerScopeTree(placed);
    return this._scopeRef(placed);
  }

  placeGeometryStates(source: ProcessGeometryState, placements: any[] = []) {
    if (!Array.isArray(placements)) {
      throw new Error("placeGeometryStates requires placements to be an array");
    }
    return placements.map((placement) =>
      this.placeGeometryState(source, placement),
    );
  }

  rootScopeRef() {
    return this._scopeRef(this._root);
  }

  findScopes({ key = null, id = null, recursive = true }: any = {}) {
    const matches: any[] = [];
    const visit = (container: Container) => {
      const ref = this._scopeRef(container);
      const keyMatches = key === null || container.key() === key;
      const idMatches = id === null || ref.id === id;
      if (keyMatches && idMatches) matches.push(ref);
      if (recursive) {
        container.children().forEach(visit);
      }
    };
    visit(this._root);
    return matches;
  }

  scopeSummary(scope = ROOT_SCOPE) {
    const container = this._resolveScope(scope);
    return {
      ...this._scopeRef(container),
      key: container.key(),
      bounds: containerBounds(container),
      bodyCount: container.bodies().length,
      viaCount: container.vias().length,
      circuitCount: container.circuits().length,
      bumpCount: container.bumps().length,
      childCount: container.children().length,
    };
  }

  inspect() {
    const counts = this._counts();
    return {
      cursorZ: this._cursorZ,
      unitSystem: this._unitSystem,
      footprint: this.processFootprint(),
      bounds: this.bounds(),
      ...counts,
    };
  }

  _addBodyObject(body: Body, { scope = ROOT_SCOPE }: any = {}) {
    const targetScope = this._resolveScope(scope);
    targetScope.addBody(body);
    return this._handle("body", targetScope);
  }

  _addFeatureObject(feature: any, type: string, scope: any) {
    const targetScope = this._resolveScope(scope);
    if (type === "via") targetScope.addVia(feature);
    if (type === "circuit") targetScope.addCircuit(feature);
    if (type === "bump") targetScope.addBump(feature);
    return this._handle(type, targetScope);
  }

  _resolveScope(scope: any): Container {
    if (scope === undefined || scope === null || scope === ROOT_SCOPE) {
      return this._root;
    }
    if (scope instanceof Container) {
      return scope;
    }
    const scopeId = typeof scope === "string" ? scope : scope.id;
    const container = this._scopesById.get(scopeId);
    if (!container) {
      throw new Error(`Unknown geometry scope: ${scopeId}`);
    }
    return container;
  }

  _scopeRef(container: Container) {
    if (!this._scopeIds.has(container)) {
      this._registerScope(container);
    }
    return { id: this._scopeIds.get(container) };
  }

  _handle(type: string, scope: Container) {
    const scopeRef = this._scopeRef(scope);
    return {
      id: `${type}:${this._nextHandleId++}`,
      type,
      scope: scopeRef,
    };
  }

  _registerScopeTree(container: Container): void {
    this._registerScope(container);
    container.children().forEach((child) => this._registerScopeTree(child));
  }

  _registerScope(container: Container): void {
    if (this._scopeIds.has(container)) return;
    const id =
      container === this._root ? ROOT_SCOPE : `scope:${this._nextScopeId++}`;
    this._scopeIds.set(container, id);
    this._scopesById.set(id, container);
  }

  _counts() {
    const counts = {
      bodyCount: 0,
      viaCount: 0,
      circuitCount: 0,
      bumpCount: 0,
      scopeCount: 0,
    };
    walkContainer(this._root, (container) => {
      counts.scopeCount += 1;
      counts.bodyCount += container.bodies().length;
      counts.viaCount += container.vias().length;
      counts.circuitCount += container.circuits().length;
      counts.bumpCount += container.bumps().length;
    });
    return counts;
  }
}

function containerFromPayload(container: any): Container {
  const result = new Container({ key: container.key ?? "" });

  for (const body of container.bodies ?? []) {
    result.addBody(new Body(geometryFromPayload(body.geometry), body.material));
  }
  for (const via of container.vias ?? []) {
    result.addVia(
      new Via(
        geometryFromPayload(via.geometry),
        via.density,
        via.material,
        via.direction,
      ),
    );
  }
  for (const circuit of container.circuits ?? []) {
    result.addCircuit(
      new Circuit(
        geometryFromPayload(circuit.geometry),
        circuit.density,
        circuit.material,
      ),
    );
  }
  for (const bump of container.bumps ?? []) {
    result.addBump(
      new Bump(
        geometryFromPayload(bump.geometry),
        bump.density,
        bump.material,
        bump.direction,
      ),
    );
  }
  for (const child of container.children ?? []) {
    result.attachChild(containerFromPayload(child));
  }

  return result;
}

function geometryFromPayload(geometry: any): Geometry {
  assertObject(geometry, "geometry");
  switch (geometry.type) {
    case "BoxGeometry":
      return new BoxGeometry(
        geometryField(geometry, "bottom_left"),
        geometryField(geometry, "top_right"),
        geometryField(geometry, "thk"),
      );
    case "CylinderGeometry":
      return new CylinderGeometry(
        geometryField(geometry, "center"),
        geometryField(geometry, "bottom_radius"),
        geometryField(geometry, "thk"),
      );
    case "PolygonGeometry":
      return new PolygonGeometry(
        geometryField(geometry, "polys"),
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

function geometryField(geometry: any, fieldName: string): any {
  if (!Object.hasOwn(geometry, fieldName)) {
    throw new Error(`Geometry ${geometry.type} missing field ${fieldName}`);
  }
  return geometry[fieldName];
}

function geometryFromSpec(spec: any): Geometry {
  assertObject(spec, "geometry");
  const thickness = positiveNumber(spec.thickness ?? spec.thk, "thickness");

  switch (spec.type) {
    case "box":
      return new BoxGeometry(
        point3(spec.bottomLeft ?? spec.bottom_left, "bottomLeft"),
        point3(spec.topRight ?? spec.top_right, "topRight"),
        thickness,
      );
    case "cylinder":
      return new CylinderGeometry(
        point3(spec.center, "center"),
        positiveNumber(spec.radius ?? spec.bottomRadius ?? spec.bottom_radius, "radius"),
        thickness,
      );
    case "polygon":
      return new PolygonGeometry(spec.polygons ?? spec.polys, thickness);
    case "cone":
      return new ConeGeometry(
        point3(spec.center, "center"),
        positiveNumber(spec.bottomRadius ?? spec.bottom_radius, "bottomRadius"),
        positiveNumber(spec.topRadius ?? spec.top_radius, "topRadius"),
        thickness,
      );
    default:
      throw new Error(`Unsupported geometry spec type: ${spec.type}`);
  }
}

function normalizeFootprintSpec(footprint: any): any {
  assertObject(footprint, "footprint");
  switch (footprint.type) {
    case "box":
      return {
        type: "box",
        bottomLeft: point2(footprint.bottomLeft ?? footprint.bottom_left, "bottomLeft"),
        topRight: point2(footprint.topRight ?? footprint.top_right, "topRight"),
      };
    case "cylinder":
      return {
        type: "cylinder",
        center: point2(footprint.center, "center"),
        radius: positiveNumber(footprint.radius, "radius"),
      };
    case "polygon":
      return {
        type: "polygon",
        polygons: polygon2(footprint.polygons ?? footprint.polys),
      };
    case "cone":
      return {
        type: "cone",
        center: point2(footprint.center, "center"),
        bottomRadius: positiveNumber(
          footprint.bottomRadius ?? footprint.bottom_radius,
          "bottomRadius",
        ),
        topRadius: positiveNumber(
          footprint.topRadius ?? footprint.top_radius,
          "topRadius",
        ),
      };
    default:
      throw new Error(`Unsupported footprint type: ${footprint.type}`);
  }
}

function geometryFromFootprint(footprint: any, z: any, thickness: any): Geometry {
  const bottomZ = finiteNumber(z, "z");
  const thk = positiveNumber(thickness, "thickness");
  switch (footprint.type) {
    case "box":
      return new BoxGeometry(
        [footprint.bottomLeft[0], footprint.bottomLeft[1], bottomZ],
        [footprint.topRight[0], footprint.topRight[1], bottomZ],
        thk,
      );
    case "cylinder":
      return new CylinderGeometry(
        [footprint.center[0], footprint.center[1], bottomZ],
        footprint.radius,
        thk,
      );
    case "polygon":
      return new PolygonGeometry(
        footprint.polygons.map((poly) =>
          poly.map((point) => [point[0], point[1], bottomZ]),
        ),
        thk,
      );
    case "cone":
      return new ConeGeometry(
        [footprint.center[0], footprint.center[1], bottomZ],
        footprint.bottomRadius,
        footprint.topRadius,
        thk,
      );
    default:
      throw new Error(`Unsupported footprint type: ${footprint.type}`);
  }
}

function footprintFromGeometry(geometry: Geometry): any {
  if (geometry instanceof BoxGeometry) {
    const bottomLeft = geometry.bottomLeft();
    const topRight = geometry.topRight();
    return normalizeFootprintSpec({
      type: "box",
      bottomLeft: [bottomLeft[0], bottomLeft[1]],
      topRight: [topRight[0], topRight[1]],
    });
  }
  if (geometry instanceof CylinderGeometry) {
    const center = geometry.center();
    return normalizeFootprintSpec({
      type: "cylinder",
      center: [center[0], center[1]],
      radius: geometry.bottomRadius(),
    });
  }
  if (geometry instanceof PolygonGeometry) {
    return normalizeFootprintSpec({
      type: "polygon",
      polygons: geometry
        .polygons()
        .map((poly) => poly.map((point) => [point[0], point[1]])),
    });
  }
  if (geometry instanceof ConeGeometry) {
    const center = geometry.center();
    return normalizeFootprintSpec({
      type: "cone",
      center: [center[0], center[1]],
      bottomRadius: geometry.bottomRadius(),
      topRadius: geometry.topRadius(),
    });
  }
  throw new Error("Unsupported geometry for process footprint");
}

function resolveRestoreFootprint(root: Container, footprint: any): any {
  if (footprint === undefined || footprint === null) return null;
  if (typeof footprint === "object" && Object.hasOwn(footprint, "derive")) {
    return deriveFootprintFromContainer(root, footprint.derive);
  }
  return normalizeFootprintSpec(footprint);
}

function deriveFootprintFromContainer(container: Container, strategy: string): any {
  if (strategy === "geometryBounds") {
    const bounds = containerBounds(container);
    return normalizeFootprintSpec({
      type: "box",
      bottomLeft: [bounds.xMin, bounds.yMin],
      topRight: [bounds.xMax, bounds.yMax],
    });
  }

  const bodies = container.bodies();
  if (bodies.length === 0) {
    throw new Error(`deriveProcessFootprint ${strategy} requires a direct body`);
  }
  if (strategy === "firstRootBody" || strategy === "firstDirectBody") {
    return footprintFromGeometry(bodies[0].geometry());
  }
  if (strategy === "largestRootBody" || strategy === "largestDirectBody") {
    return footprintFromGeometry(
      bodies.reduce((largest, body) =>
        xyArea(body.geometry()) > xyArea(largest.geometry()) ? body : largest,
      ).geometry(),
    );
  }
  throw new Error(`Unsupported footprint derivation strategy: ${strategy}`);
}

function containerBounds(container: Container): Bounds {
  const bounds: Bounds[] = [];
  walkContainer(container, (current) => {
    [
      ...current.bodies(),
      ...current.vias(),
      ...current.circuits(),
      ...current.bumps(),
    ].forEach((feature) => bounds.push(geometryBounds(feature.geometry())));
  });

  if (bounds.length === 0) {
    return { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 };
  }

  return bounds.reduce((aggregate, item) => ({
    xMin: Math.min(aggregate.xMin, item.xMin),
    xMax: Math.max(aggregate.xMax, item.xMax),
    yMin: Math.min(aggregate.yMin, item.yMin),
    yMax: Math.max(aggregate.yMax, item.yMax),
    zMin: Math.min(aggregate.zMin, item.zMin),
    zMax: Math.max(aggregate.zMax, item.zMax),
  }));
}

function geometryBounds(geometry: Geometry): Bounds {
  if (geometry instanceof BoxGeometry) {
    const bottomLeft = geometry.bottomLeft();
    const topRight = geometry.topRight();
    return {
      xMin: Math.min(bottomLeft[0], topRight[0]),
      xMax: Math.max(bottomLeft[0], topRight[0]),
      yMin: Math.min(bottomLeft[1], topRight[1]),
      yMax: Math.max(bottomLeft[1], topRight[1]),
      zMin: geometry.zMin(),
      zMax: geometry.zMax(),
    };
  }
  if (geometry instanceof PolygonGeometry) {
    const nodes = geometry.polygons().flat();
    return {
      xMin: Math.min(...nodes.map((node) => node[0])),
      xMax: Math.max(...nodes.map((node) => node[0])),
      yMin: Math.min(...nodes.map((node) => node[1])),
      yMax: Math.max(...nodes.map((node) => node[1])),
      zMin: geometry.zMin(),
      zMax: geometry.zMax(),
    };
  }
  if (geometry instanceof CylinderGeometry || geometry instanceof ConeGeometry) {
    const center = geometry.center();
    const radius =
      geometry instanceof ConeGeometry
        ? Math.max(geometry.bottomRadius(), geometry.topRadius())
        : geometry.bottomRadius();
    return {
      xMin: center[0] - radius,
      xMax: center[0] + radius,
      yMin: center[1] - radius,
      yMax: center[1] + radius,
      zMin: geometry.zMin(),
      zMax: geometry.zMax(),
    };
  }
  throw new Error("Unsupported geometry for bounds");
}

function walkContainer(container: Container, visitor: (container: Container) => void): void {
  visitor(container);
  container.children().forEach((child) => walkContainer(child, visitor));
}

function lowestDirectBody(container: Container): Body | null {
  const bodies = container.bodies();
  if (bodies.length === 0) return null;
  return bodies.reduce((lowest, body) =>
    body.zMin() < lowest.zMin() ? body : lowest,
  );
}

function anchorPoint(bounds: Bounds, anchor: string): { x: number; y: number } {
  if (anchor === "bottomLeft") {
    return { x: bounds.xMin, y: bounds.yMin };
  }
  if (anchor === "center") {
    return {
      x: (bounds.xMin + bounds.xMax) / 2,
      y: (bounds.yMin + bounds.yMax) / 2,
    };
  }
  if (anchor === "origin") {
    return { x: 0, y: 0 };
  }
  throw new Error(`Unsupported placement anchor: ${anchor}`);
}

function xyArea(geometry: Geometry): number {
  const bounds = geometryBounds(geometry);
  return (bounds.xMax - bounds.xMin) * (bounds.yMax - bounds.yMin);
}

function point2(value: any, label: string): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${label} must be a two-number point`);
  }
  return [finiteNumber(value[0], `${label}[0]`), finiteNumber(value[1], `${label}[1]`)];
}

function point3(value: any, label: string): Point3 {
  if (!Array.isArray(value) || value.length < 3) {
    throw new Error(`${label} must be a three-number point`);
  }
  return [
    finiteNumber(value[0], `${label}[0]`),
    finiteNumber(value[1], `${label}[1]`),
    finiteNumber(value[2], `${label}[2]`),
  ];
}

function polygon2(polygons: any): [number, number][][] {
  if (!Array.isArray(polygons)) {
    throw new Error("polygons must be an array");
  }
  return polygons.map((poly) => poly.map((point) => point2(point, "polygon point")));
}

function finiteNumber(value: any, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number`);
  }
  return number;
}

function positiveNumber(value: any, label: string): number {
  const number = finiteNumber(value, label);
  if (number <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return number;
}

function requireString(value: any, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireDirection(value: any, label: string): string {
  if (value !== "+z" && value !== "-z") {
    throw new Error(`${label} must be "+z" or "-z"`);
  }
  return value;
}

function assertObject(value: any, label: string): asserts value is Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}
