import type { Node, Rect, XYPosition } from "@xyflow/react";

export const LIBRARY_NODE_SIZES = {
  flowInput: { width: 132, height: 132 },
  processStep: { width: 248, height: 132 },
} as const;

type LibraryNodeType = keyof typeof LIBRARY_NODE_SIZES;
type PositionedNode = Pick<Node, "position" | "type" | "measured">;

/** Search a fixed set of nearby slots only when inserting a library item. */
export function libraryInsertionPosition(
  viewport: Rect,
  nodeType: LibraryNodeType,
  nodes: PositionedNode[],
): XYPosition {
  const size = LIBRARY_NODE_SIZES[nodeType];
  const center = {
    x: viewport.x + (viewport.width - size.width) / 2,
    y: viewport.y + (viewport.height - size.height) / 2,
  };
  if (viewport.width < size.width || viewport.height < size.height) return center;

  const occupied = nodes.map((node) => {
    const fallback = LIBRARY_NODE_SIZES[node.type === "flowInput" ? "flowInput" : "processStep"];
    return {
      ...node.position,
      width: node.measured?.width ?? fallback.width,
      height: node.measured?.height ?? fallback.height,
    };
  });
  const candidates: Array<XYPosition & { distance: number }> = [];
  for (let row = -3; row <= 3; row++) {
    for (let column = -3; column <= 3; column++) {
      const dx = column * (size.width + 24);
      const dy = row * (size.height + 24);
      candidates.push({ x: center.x + dx, y: center.y + dy, distance: dx * dx + dy * dy });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const { x, y } of candidates) {
    if (x < viewport.x || y < viewport.y ||
        x + size.width > viewport.x + viewport.width ||
        y + size.height > viewport.y + viewport.height) continue;
    if (!occupied.some((rect) =>
      x < rect.x + rect.width && x + size.width > rect.x &&
      y < rect.y + rect.height && y + size.height > rect.y,
    )) return { x, y };
  }
  return center;
}
