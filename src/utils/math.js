export class MathHelpers {
  static fEq(a, b, tolerance = 0.00001) {
    return Math.abs(a - b) <= tolerance;
  }

  static fNe(a, b, tolerance = 0.00001) {
    return Math.abs(a - b) > tolerance;
  }

  static fGt(a, b, tolerance = 0.00001) {
    return Math.abs(a - b) > tolerance && a > b;
  }

  static fGe(a, b, tolerance = 0.00001) {
    return Math.abs(a - b) <= tolerance || a > b;
  }

  static fLt(a, b, tolerance = 0.00001) {
    return Math.abs(a - b) > tolerance && a < b;
  }

  static fLe(a, b, tolerance = 0.00001) {
    return Math.abs(a - b) <= tolerance || a < b;
  }

  static fIsInt(a, tolerance = 0.00001) {
    return (
      (typeof a === "number" || typeof a === "bigint") &&
      Number.isFinite(Number(a)) &&
      Math.abs(Number(a) - Math.round(Number(a))) <= tolerance
    );
  }

  static fZero(a, tolerance = 0.00001) {
    return Math.abs(a) < tolerance ? 0 : a;
  }
}

export const math = MathHelpers;
