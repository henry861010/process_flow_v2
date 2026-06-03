import { Body } from "../data/body.js";
import { Container } from "../data/container.js";
import { Circuit } from "../data/circuit.js";
import { Via } from "../data/via.js";
import { math } from "../utils/math.js";

export class Status {
  constructor() {
    this._container = new Container({ key: "main" });
    this._baseGeometry = null;
    this._zNow = 0;
  }

  container() {
    return this._container;
  }

  baseGeometry() {
    if (this._baseGeometry === null) return null;
    return this._baseGeometry.copy();
  }

  base_geometry() {
    return this.baseGeometry();
  }

  _requireBaseGeometry() {
    if (this._baseGeometry === null) {
      throw new Error("initial_body must be called before using this API");
    }
    return this._baseGeometry;
  }

  zNow() {
    return this._zNow;
  }

  z_now() {
    return this.zNow();
  }

  initialBody(body) {
    const baseBody = body.copy();
    baseBody.move({ z: -baseBody.zMin() });
    this._baseGeometry = baseBody.geometry();
  }

  initial_body(body) {
    this.initialBody(body);
  }

  flip() {
    this._container.flip();
    this._container.move({ z: -this._container.zMin() });
    this._zNow = this._container.zMax();
  }

  fillThk(material, thk) {
    const baseGeometry = this._requireBaseGeometry();
    if (math.fLe(thk, 0)) {
      throw new Error("thk must be positive");
    }

    const geometry = baseGeometry.copyWithThk(thk);
    const newLayer = new Body(geometry, material);
    newLayer.move({ z: this._zNow });

    this._container.addBody(newLayer);
    this._zNow += thk;
    return newLayer;
  }

  fill_thk(material, thk) {
    return this.fillThk(material, thk);
  }

  fill(material, toZ) {
    const baseGeometry = this._requireBaseGeometry();
    if (math.fLe(toZ, this._zNow)) {
      throw new Error("to_z must be above current z_now");
    }

    const layerThk = toZ - this._zNow;
    const geometry = baseGeometry.copyWithThk(layerThk);
    const newLayer = new Body(geometry, material);
    newLayer.move({ z: this._zNow });

    this._container.addBody(newLayer);
    this._zNow = toZ;
    return newLayer;
  }

  addBody(body) {
    return this._container.addBody(body);
  }

  add_body(body) {
    return this.addBody(body);
  }

  grindTo(toZ) {
    const stillExists = this._container.grindTo(toZ);
    this._zNow = Math.min(this._zNow, toZ);
    return stillExists;
  }

  grind_to(toZ) {
    return this.grindTo(toZ);
  }

  addContainers(dies) {
    dies.forEach((die) => {
      die.move({ z: this._zNow - die.zMin() });
      this._container.addChild(die);
    });
  }

  add_containers(dies) {
    this.addContainers(dies);
  }

  digVia(thk, material, density) {
    const baseGeometry = this._requireBaseGeometry();
    if (math.fLe(thk, 0)) {
      throw new Error("thk must be positive");
    }
    if (math.fLt(this._zNow - thk, 0)) {
      throw new Error("dig_via cannot dig below z=0");
    }

    const geometry = baseGeometry.copyWithThk(thk);
    const viaLayer = new Via(geometry, density, material, "-z");
    viaLayer.move({ z: this._zNow - thk });
    return this._container.addVia(viaLayer);
  }

  dig_via(thk, material, density) {
    return this.digVia(thk, material, density);
  }

  growVia(thk, material, density) {
    const baseGeometry = this._requireBaseGeometry();
    if (math.fLe(thk, 0)) {
      throw new Error("thk must be positive");
    }

    const geometry = baseGeometry.copyWithThk(thk);
    const viaLayer = new Via(geometry, density, material, "+z");
    viaLayer.move({ z: this._zNow });
    return this._container.addVia(viaLayer);
  }

  grow_via(thk, material, density) {
    return this.growVia(thk, material, density);
  }

  growCircuit(thk, material, density) {
    const baseGeometry = this._requireBaseGeometry();
    if (math.fLe(thk, 0)) {
      throw new Error("thk must be positive");
    }

    const geometry = baseGeometry.copyWithThk(thk);
    const circuitLayer = new Circuit(geometry, density, material);
    circuitLayer.move({ z: this._zNow });
    return this._container.addCircuit(circuitLayer);
  }

  grow_circuit(thk, material, density) {
    return this.growCircuit(thk, material, density);
  }
}
