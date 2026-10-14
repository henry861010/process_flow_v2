import { describe, expect, it } from "vitest";
import { clickConnectionCandidate, clickConnectionReducer } from "./click-connection-state";

const source = { nodeId: "step-a", handleId: "result_geometry" };
const pointer = { x: 200, y: 150 };
const start = () => clickConnectionReducer(null, { type: "source", handle: source, pointer });

describe("click connections", () => {
  it("starts without a target and follows the pointer without changing the source", () => {
    const state = start();
    expect(state).toEqual({ source, pointer, target: null });
    expect(clickConnectionReducer(state, {
      type: "pointer", pointer: { x: 400, y: 250 }, target: null,
    })).toEqual({ source, pointer: { x: 400, y: 250 }, target: null });
  });

  it("tracks the specific input port and clears it when switching sources", () => {
    const hovered = clickConnectionReducer(start(), {
      type: "pointer", pointer, target: { nodeId: "step-b", handleId: "die_geometry" },
    });
    expect(hovered?.target?.handleId).toBe("die_geometry");
    const replacement = { nodeId: "step-c", handleId: "result_geometry" };
    expect(clickConnectionReducer(hovered, { type: "source", handle: replacement, pointer }))
      .toEqual({ source: replacement, pointer, target: null });
  });

  it("toggles the same source off and allows a different handle on the same node", () => {
    expect(clickConnectionReducer(start(), { type: "source", handle: source, pointer })).toBeNull();
    expect(clickConnectionReducer(start(), {
      type: "source", handle: { ...source, handleId: "alternate" }, pointer,
    })?.source.handleId).toBe("alternate");
  });

  it("does not restart a canceled connection when a stale pointer event arrives", () => {
    const canceled = clickConnectionReducer(start(), { type: "cancel" });
    expect(canceled).toBeNull();
    expect(clickConnectionReducer(canceled, {
      type: "pointer", pointer, target: { nodeId: "step-b", handleId: "main_geometry" },
    })).toBeNull();
  });

  it("builds connections to the clicked input rather than defaulting to the first port", () => {
    expect(clickConnectionCandidate(source, { nodeId: "step-b", handleId: "die_geometry" }))
      .toEqual({ source: "step-a", sourceHandle: "result_geometry", target: "step-b", targetHandle: "die_geometry" });
    expect(clickConnectionCandidate({ nodeId: "geometry-a", handleId: "out" }, {
      nodeId: "step-b", handleId: "main_geometry",
    }).sourceHandle).toBe("out");
  });
});
