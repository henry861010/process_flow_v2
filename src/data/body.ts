import { Geometry, type GeometryJson, type MoveInput, moveArgs } from "./geometry.js";

export class Body extends Geometry {
  private _geometry: Geometry;
  private _material: string;

  constructor(geometry: Geometry, material: string) {
    super();
    this._geometry = geometry;
    this._material = material;
  }

  zMin(): number {
    return this._geometry.zMin();
  }

  zMax(): number {
    return this._geometry.zMax();
  }

  thk(): number {
    return this._geometry.thk();
  }

  geometry(): Geometry {
    return this._geometry.copy();
  }

  material(): string {
    return this._material;
  }

  copy(): Body {
    return new Body(this._geometry.copy(), this._material);
  }

  copyWithThk(thk: number): Body {
    return new Body(this._geometry.copyWithThk(thk), this._material);
  }

  move(...args: MoveInput[]): void {
    const { x, y, z } = moveArgs(args);
    this._geometry.move({ x, y, z });
  }

  clipTopTo(toZ: number): boolean {
    return this._geometry.clipTopTo(toZ);
  }

  flip(aroundZ = 0): void {
    this._geometry.flip(aroundZ);
  }

  json(): GeometryJson {
    return {
      geometry: this._geometry.json(),
      material: this._material,
    };
  }
}
