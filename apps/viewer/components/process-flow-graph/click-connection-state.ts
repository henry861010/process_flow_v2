import type { Connection } from "@xyflow/react";

export type ClickHandle = { nodeId: string; handleId: string };
export type ClickConnectionState = {
  source: ClickHandle;
  pointer: { x: number; y: number };
  target: ClickHandle | null;
} | null;

export type ClickConnectionAction =
  | { type: "source"; handle: ClickHandle; pointer: { x: number; y: number } }
  | { type: "pointer"; pointer: { x: number; y: number }; target: ClickHandle | null }
  | { type: "cancel" };

export function clickConnectionReducer(
  state: ClickConnectionState,
  action: ClickConnectionAction,
): ClickConnectionState {
  if (action.type === "cancel") return null;
  if (action.type === "source") {
    if (state?.source.nodeId === action.handle.nodeId && state.source.handleId === action.handle.handleId) {
      return null;
    }
    return { source: action.handle, pointer: action.pointer, target: null };
  }
  return state ? { ...state, pointer: action.pointer, target: action.target } : null;
}

export function clickConnectionCandidate(source: ClickHandle, target: ClickHandle): Connection {
  return {
    source: source.nodeId,
    sourceHandle: source.handleId,
    target: target.nodeId,
    targetHandle: target.handleId,
  };
}
