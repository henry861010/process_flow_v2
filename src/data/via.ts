import { Geometry, type GeometryJson, type MoveInput, moveArgs } from "./geometry.js";

type Direction = "+z" | "-z";

export class Via extends Geometry {
  private _geometry: Geometry;
  private _density: number;
  private _material: string;
  private _direction: Direction;

  constructor(geometry: Geometry, density: number, material: string, direction?: string) {
    super();
    assertDirection(direction);
    this._geometry = geometry;
    this._density = density;
    this._material = material;
    this._direction = direction;
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

  direction(): Direction {
    return this._direction;
  }

  copy(): Via {
    return new Via(
      this._geometry.copy(),
      this._density,
      this._material,
      this._direction,
    );
  }

  copyWithThk(thk: number): Via {
    return new Via(
      this._geometry.copyWithThk(thk),
      this._density,
      this._material,
      this._direction,
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
    this._direction = reverseDirection(this._direction);
  }

  json(): GeometryJson {
    return {
      geometry: this._geometry.json(),
      material: this._material,
      density: this._density,
      direction: this._direction,
    };
  }
}

function assertDirection(direction: unknown): asserts direction is Direction {
  if (direction !== "+z" && direction !== "-z") {
    throw new Error(`Via direction must be "+z" or "-z"; received ${direction}`);
  }
}

function reverseDirection(direction: Direction): Direction {
  return direction === "+z" ? "-z" : "+z";
}
