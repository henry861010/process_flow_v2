export class MathHelpers {
  static fEq(a: number, b: number, tolerance = 0.00001): boolean {
    return Math.abs(a - b) <= tolerance;
  }

  static fNe(a: number, b: number, tolerance = 0.00001): boolean {
    return Math.abs(a - b) > tolerance;
  }

  static fGt(a: number, b: number, tolerance = 0.00001): boolean {
    return Math.abs(a - b) > tolerance && a > b;
  }

  static fGe(a: number, b: number, tolerance = 0.00001): boolean {
    return Math.abs(a - b) <= tolerance || a > b;
  }

  static fLt(a: number, b: number, tolerance = 0.00001): boolean {
    return Math.abs(a - b) > tolerance && a < b;
  }

  static fLe(a: number, b: number, tolerance = 0.00001): boolean {
    return Math.abs(a - b) <= tolerance || a < b;
  }

  static fIsInt(a: number | bigint, tolerance = 0.00001): boolean {
    return (
      (typeof a === "number" || typeof a === "bigint") &&
      Number.isFinite(Number(a)) &&
      Math.abs(Number(a) - Math.round(Number(a))) <= tolerance
    );
  }

  static fZero(a: number, tolerance = 0.00001): number {
    return Math.abs(a) < tolerance ? 0 : a;
  }
}

export const math = MathHelpers;
