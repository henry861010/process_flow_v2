export function normalizeStepLabel(label: unknown, fallback: string) {
  return typeof label === "string" && label.trim() ? label.trim() : fallback;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
