import { Geometry, type GeometryJson, type MoveInput, moveArgs } from "./geometry.js";

export class Circuit extends Geometry {
  private _geometry: Geometry;
  private _density: number;
  private _material: string;

  constructor(geometry: Geometry, density: number, material: string) {
    super();
    this._geometry = geometry;
    this._density = density;
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

  density(): number {
    return this._density;
  }

  material(): string {
    return this._material;
  }

  copy(): Circuit {
    return new Circuit(this._geometry.copy(), this._density, this._material);
  }

  copyWithThk(thk: number): Circuit {
    return new Circuit(
      this._geometry.copyWithThk(thk),
      this._density,
      this._material,
    );
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
      density: this._density,
    };
  }
}
