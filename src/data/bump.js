import { Geometry, moveArgs } from "./geometry.js";

export class Bump extends Geometry {
  constructor(geometry, density, material, direction) {
    super();
    assertDirection(direction);
    this._geometry = geometry;
    this._density = density;
    this._material = material;
    this._direction = direction;
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

  direction() {
    return this._direction;
  }

  copy() {
    return new Bump(
      this._geometry.copy(),
      this._density,
      this._material,
      this._direction,
    );
  }

  copyWithThk(thk) {
    return new Bump(
      this._geometry.copyWithThk(thk),
      this._density,
      this._material,
      this._direction,
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
    this._direction = reverseDirection(this._direction);
  }

  json() {
    return {
      geometry: this._geometry.json(),
      material: this._material,
      density: this._density,
      direction: this._direction,
    };
  }
}

function assertDirection(direction) {
  if (direction !== "+z" && direction !== "-z") {
    throw new Error(`Bump direction must be "+z" or "-z"; received ${direction}`);
  }
}

function reverseDirection(direction) {
  return direction === "+z" ? "-z" : "+z";
}
