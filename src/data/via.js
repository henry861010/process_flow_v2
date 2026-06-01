import { Geometry, moveArgs } from "./geometry.js";

export class Via extends Geometry {
  constructor(geometry, density, material) {
    super();
    this._geometry = geometry;
    this._density = density;
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

  density() {
    return this._density;
  }

  material() {
    return this._material;
  }

  copy() {
    return new Via(this._geometry.copy(), this._density, this._material);
  }

  copyWithThk(thk) {
    return new Via(
      this._geometry.copyWithThk(thk),
      this._density,
      this._material,
    );
  }

  move(...args) {
    const { x, y, z } = moveArgs(args);
    this._geometry.move({ x, y, z });
  }

  clipTopTo(toZ) {
    return this._geometry.clipTopTo(toZ);
  }

  flip(aroundZ = 0) {
    this._geometry.flip(aroundZ);
  }

  json() {
    return {
      geometry: this._geometry.json(),
      material: this._material,
      density: this._density,
    };
  }
}
