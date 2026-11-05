import { describe, expect, it, vi } from "vitest";
import { LIBRARY_NODE_SIZES, libraryInsertionPosition } from "./library-insertion";

type PositionedNode = Parameters<typeof libraryInsertionPosition>[2][number];
const viewport = { x: 3000, y: -800, width: 1000, height: 600 };
const nodeAt = (x: number, y: number, type = "flowInput"): PositionedNode => ({ position: { x, y }, type });

describe("library insertion placement", () => {
  it.each(["flowInput", "processStep"] as const)("centers the %s body in flow coordinates", (type) => {
    const size = LIBRARY_NODE_SIZES[type];
    const position = libraryInsertionPosition(viewport, type, []);
    expect(position.x + size.width / 2).toBe(viewport.x + viewport.width / 2);
    expect(position.y + size.height / 2).toBe(viewport.y + viewport.height / 2);
  });

  it("chooses the nearest available slot when the center is occupied", () => {
    const center = libraryInsertionPosition(viewport, "processStep", []);
    const position = libraryInsertionPosition(viewport, "processStep", [nodeAt(center.x, center.y, "processStep")]);
    expect(position.x).toBe(center.x);
    expect(Math.abs(position.y - center.y)).toBe(156);
  });

  it("uses measured bounds instead of fallback dimensions for existing nodes", () => {
    const center = libraryInsertionPosition(viewport, "flowInput", []);
    const obstacle = nodeAt(center.x - 200, center.y);
    expect(libraryInsertionPosition(viewport, "flowInput", [obstacle])).toEqual(center);
    obstacle.measured = { width: 400, height: 132 };
    expect(libraryInsertionPosition(viewport, "flowInput", [obstacle])).not.toEqual(center);
  });

  it("keeps repeated insertions visible and separate until the local slots fill up", () => {
    const nodes: PositionedNode[] = [];
    for (let index = 0; index < 9; index++) {
      const position = libraryInsertionPosition(viewport, "flowInput", nodes);
      expect(position.x).toBeGreaterThanOrEqual(viewport.x);
      expect(position.y).toBeGreaterThanOrEqual(viewport.y);
      expect(position.x + 132).toBeLessThanOrEqual(viewport.x + viewport.width);
      expect(position.y + 132).toBeLessThanOrEqual(viewport.y + viewport.height);
      expect(nodes.every((node) => Math.abs(node.position.x - position.x) >= 132 ||
        Math.abs(node.position.y - position.y) >= 132)).toBe(true);
      nodes.push(nodeAt(position.x, position.y));
    }
  });

  it.each([{ width: 100, height: 600 }, { width: 1000, height: 100 }])(
    "falls back to the center if the viewport is smaller than the new node: %j", (size) => {
      const small = { ...viewport, ...size };
      expect(libraryInsertionPosition(small, "processStep", [nodeAt(0, 0)])).toEqual({
        x: small.x + (small.width - 248) / 2, y: small.y + (small.height - 132) / 2,
      });
    },
  );

  it("falls back to center when no visible candidate is free", () => {
    const obstacle = { ...nodeAt(viewport.x, viewport.y), measured: { width: viewport.width, height: viewport.height } };
    expect(libraryInsertionPosition(viewport, "flowInput", [obstacle]))
      .toEqual(libraryInsertionPosition(viewport, "flowInput", []));
  });

  it("limits the search to 49 collision scans even for a long flow with every candidate blocked", () => {
    const large = { x: 0, y: 0, width: 10000, height: 10000 };
    const nodes = Array.from({ length: 10000 }, (_, i) => nodeAt(20000 + i * 200, 0));
    nodes.push({ ...nodeAt(0, 0), measured: { width: large.width, height: large.height } });
    const scan = vi.spyOn(Array.prototype, "some");
    let scans: number;
    let position;
    try {
      position = libraryInsertionPosition(large, "flowInput", nodes);
      scans = scan.mock.calls.length;
    } finally {
      scan.mockRestore();
    }
    expect(scans).toBe(49);
    expect(position).toEqual({ x: 4934, y: 4934 });
  });
});
