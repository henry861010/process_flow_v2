import { Geometry, moveArgs } from "./geometry.js";

export class Body extends Geometry {
  constructor(geometry, material) {
    super();
    this._geometry = geometry;
    this._material = material;
  }

  zMin() {
    return this._geometry.zMin();
  }

  zMax() {
    return this._geometry.zMax();
  }

  thk() {
    return this._geometry.thk();
  }

  geometry() {
    return this._geometry.copy();
  }

  material() {
    return this._material;
  }

  copy() {
    return new Body(this._geometry.copy(), this._material);
  }

  copyWithThk(thk) {
    return new Body(this._geometry.copyWithThk(thk), this._material);
  }

  move(...args) {
    const { x, y, z } = moveArgs(args);
    this._geometry.move({ x, y, z });
  }

  clipTopTo(toZ) {
    return this._geometry.clipTopTo(toZ);
  }

  clipXYToBox(bounds) {
    return this._geometry.clipXYToBox(bounds);
  }

  flip(aroundZ = 0) {
    this._geometry.flip(aroundZ);
  }

  json() {
    return {
      geometry: this._geometry.json(),
      material: this._material,
    };
  }
}
