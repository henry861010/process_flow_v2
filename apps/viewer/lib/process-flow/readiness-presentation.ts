import type { ConfigurationReadiness } from "@/lib/process-flow/configuration";
import type { GeometryBinding } from "@/lib/process-flow/types";

export function geometryInputDisplayName(name: string) {
  return name.trim().toLowerCase() === "flow input" ? "Geometry input" : name;
}

export function geometryInputStatusLabel(
  readiness: ConfigurationReadiness,
  bindingKind: GeometryBinding["kind"] | undefined,
) {
  if (readiness.status === "ready") {
    return bindingKind === "embedded" ? "Embedded" : "Catalog";
  }
  if (readiness.status === "neutral") return "Optional";
  if (readiness.status === "error") return "Invalid";
  return "Unbound";
}

export function geometryInputSublabel(readiness: ConfigurationReadiness) {
  if (readiness.status === "neutral") return "Optional - unbound";
  if (readiness.status === "error") return "Invalid geometry binding";
  return "Select geometry - unbound";
}

export function stepReadinessStatusLabel(
  readiness: ConfigurationReadiness,
  currentStepRefId: string,
) {
  if (readiness.status === "ready") return "Ready";
  if (readiness.status === "error") {
    if (readiness.code === "missing-input-edge") return "Missing input";
    if (
      readiness.code === "geometry-constraint" ||
      readiness.code === "unresolved-geometry"
    ) {
      return "Invalid input";
    }
    if (readiness.code === "missing-step-template") return "Missing step";
    return "Invalid flow";
  }
  if (readiness.stepRefId && readiness.stepRefId !== currentStepRefId) {
    return "Waiting upstream";
  }
  if (readiness.code === "unbound-geometry") return "Waiting for input";
  if (readiness.code === "incomplete-parameter") return "Parameters";
  return "Incomplete";
}
