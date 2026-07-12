import type { BoundsTuple } from "@/components/viewer/model-loader";

/**
 * Smallest stable display-space separation for clipping and exact caps.
 *
 * CAD section coordinates remain unchanged. This value only prevents a
 * tessellated wall at the requested plane from depth-occluding the exact cap.
 */
export function sectionDisplayEpsilon(bounds: BoundsTuple) {
  const modelScale = Math.max(...bounds.size, 1);
  const coordinateMagnitude = Math.max(
    ...bounds.min.map((value) => Math.abs(value)),
    ...bounds.max.map((value) => Math.abs(value)),
    1,
  );
  // BufferGeometry positions are Float32. Four approximate ULPs keep the cap
  // on the retained side even for models whose coordinates are far from zero.
  const float32Guard = coordinateMagnitude * 2 ** -21;
  return Math.max(modelScale * 1e-6, float32Guard);
}
