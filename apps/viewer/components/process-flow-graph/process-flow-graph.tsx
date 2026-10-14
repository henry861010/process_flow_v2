"use client";

import * as React from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ViewportPortal,
  getBezierPath,
  useConnection,
  useInternalNode,
  useNodeId,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { CircleDot, Eye, Pencil, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  clickConnectionCandidate,
  clickConnectionReducer,
  type ClickConnectionState,
  type ClickHandle,
} from "./click-connection-state";

export type ProcessFlowGraphMode = "edit" | "view";
export type ProcessFlowGraphStatus =
  | "neutral"
  | "ready"
  | "incomplete"
  | "error";
export type ProcessFlowGraphNodeStatus = ProcessFlowGraphStatus;

export type ProcessFlowGraphPort = {
  id: string;
  name: string;
};

export type ProcessFlowGraphStepTemplate = {
  name: string;
  version: string;
};

export type ProcessFlowGraphNodeData = Record<string, unknown> & {
  nodeKind: "flowInput" | "processStep";
  graphMode?: ProcessFlowGraphMode;
  displayLabel?: string;
  displaySublabel?: string;
  icon?: string;
  iconScale?: number;
  editId?: string;
  pickId?: string;
  status?: ProcessFlowGraphNodeStatus;
  statusLabel?: string;
  stepRefId?: string;
  template?: ProcessFlowGraphStepTemplate;
  geometryInputPorts?: ProcessFlowGraphPort[];
  outputPortId?: string;
  terminalGeometryViewVisible?: boolean;
  terminalGeometryViewDisabled?: boolean;
  terminalGeometryViewTitle?: string;
  onTerminalGeometryView?: () => void;
  onDelete?: (nodeId: string) => void;
  onEdit?: (nodeId: string) => void;
  onPick?: (nodeId: string) => void;
};

export type ProcessFlowGraphEdgeData = Record<string, unknown> & {
  sourceKind: "flowInput" | "stepOutput";
  targetStepRefId: string;
  targetInputPortId: string;
  slotLabel: string;
  sourceLabel: string;
  graphMode?: ProcessFlowGraphMode;
  status?: ProcessFlowGraphStatus;
  geometryViewVisible?: boolean;
  geometryViewDisabled?: boolean;
  geometryViewTitle?: string;
  onDelete?: (edgeId: string) => void;
  onGeometryView?: () => void;
};

type ReactFlowBaseProps = React.ComponentProps<typeof ReactFlow>;

type ProcessFlowGraphProps<
  TNode extends Node = Node,
  TEdge extends Edge = Edge,
> = {
  mode: ProcessFlowGraphMode;
  nodes: TNode[];
  edges: TEdge[];
  className?: string;
  fitView?: boolean;
  minZoom?: number;
  maxZoom?: number;
  panOnScroll?: boolean;
  elementsSelectable?: boolean;
  edgesReconnectable?: boolean;
  reconnectRadius?: number;
  showMiniMap?: boolean;
  topRightOverlay?: React.ReactNode;
  emptyState?: React.ReactNode;
  defaultEdgeOptions?: ReactFlowBaseProps["defaultEdgeOptions"];
  onNodesChange?: (changes: NodeChange<TNode>[]) => void;
  onEdgesChange?: (changes: EdgeChange<TEdge>[]) => void;
  onConnect?: (connection: Connection) => void;
  onConnectStart?: ReactFlowBaseProps["onConnectStart"];
  onConnectEnd?: ReactFlowBaseProps["onConnectEnd"];
  onReconnect?: (oldEdge: TEdge, connection: Connection) => void;
  onReconnectStart?: ReactFlowBaseProps["onReconnectStart"];
  onReconnectEnd?: ReactFlowBaseProps["onReconnectEnd"];
  isValidConnection?: (connection: Connection | TEdge) => boolean;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onNodeClick?: (event: React.MouseEvent, node: TNode) => void;
  onNodeDoubleClick?: (event: React.MouseEvent, node: TNode) => void;
  interactionKey?: string | number;
  onPaneClick?: ReactFlowBaseProps["onPaneClick"];
  onMoveEnd?: ReactFlowBaseProps["onMoveEnd"];
  miniMapNodeColor?: (node: TNode) => string;
};

const nodeTypes = {
  flowInput: FlowInputNode,
  processStep: ProcessStepNode,
} as NodeTypes;

const edgeTypes = {
  dataFlow: DataFlowEdge,
};

const DEFAULT_GEOMETRY_ICON_SCALE = 0.8;
const warnedMissingGeometryIconUrls = new Set<string>();

const ClickConnectionContext = React.createContext<{
  state: ClickConnectionState;
  enabled: boolean;
  validTarget: boolean;
  cancel: () => void;
  clickHandle: (event: React.MouseEvent, handle: ClickHandle, type: "source" | "target") => void;
} | null>(null);

export function ProcessFlowGraph<
  TNode extends Node = Node,
  TEdge extends Edge = Edge,
>({
  mode,
  nodes,
  edges,
  className,
  fitView,
  minZoom = 0.35,
  maxZoom = 1.4,
  panOnScroll,
  elementsSelectable,
  edgesReconnectable,
  reconnectRadius,
  showMiniMap = true,
  topRightOverlay,
  emptyState,
  defaultEdgeOptions,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onConnectStart,
  onConnectEnd,
  onReconnect,
  onReconnectStart,
  onReconnectEnd,
  isValidConnection,
  onDrop,
  onDragOver,
  onNodeClick,
  onNodeDoubleClick,
  interactionKey,
  onPaneClick,
  onMoveEnd,
  miniMapNodeColor,
}: ProcessFlowGraphProps<TNode, TEdge>) {
  const canEditTopology = mode === "edit";
  const [clickConnection, dispatchConnection] = React.useReducer(clickConnectionReducer, null);
  const suppressHandleClick = React.useRef(false);
  const cancelClickConnection = React.useCallback(() => dispatchConnection({ type: "cancel" }), []);
  const sourceExists = clickConnection && nodes.some((node) => {
    const data = getGraphNodeData(node);
    return node.id === clickConnection.source.nodeId &&
      clickConnection.source.handleId === (data.nodeKind === "flowInput" ? "out" : data.outputPortId ?? "result_geometry");
  });
  const activeConnection = canEditTopology && sourceExists ? clickConnection : null;

  React.useEffect(cancelClickConnection, [canEditTopology, interactionKey, cancelClickConnection]);
  React.useEffect(() => {
    if (clickConnection && !sourceExists) cancelClickConnection();
  }, [clickConnection, sourceExists, cancelClickConnection]);
  const connectionActive = Boolean(activeConnection);
  React.useEffect(() => {
    if (!connectionActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelClickConnection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [connectionActive, cancelClickConnection]);

  function validClickTarget(target: ClickHandle) {
    if (!activeConnection) return false;
    const node = nodes.find((node) => node.id === target.nodeId);
    const data = node && getGraphNodeData(node);
    return Boolean(data?.nodeKind === "processStep" &&
      data.geometryInputPorts?.some((port) => port.id === target.handleId) &&
      activeConnection.source.nodeId !== target.nodeId &&
      (isValidConnection?.(clickConnectionCandidate(activeConnection.source, target)) ?? true));
  }

  function clickHandle(event: React.MouseEvent, handle: ClickHandle, type: "source" | "target") {
    event.stopPropagation();
    if (!canEditTopology || suppressHandleClick.current || event.detail > 1) return;
    if (type === "source") {
      dispatchConnection({ type: "source", handle, pointer: { x: event.clientX, y: event.clientY } });
    } else if (activeConnection && validClickTarget(handle)) {
      onConnect?.(clickConnectionCandidate(activeConnection.source, handle));
      cancelClickConnection();
    }
  }

  const connectionContext = {
    state: activeConnection,
    enabled: canEditTopology,
    validTarget: Boolean(activeConnection?.target && validClickTarget(activeConnection.target)),
    cancel: cancelClickConnection,
    clickHandle,
  };

  return (
    <ClickConnectionContext.Provider value={connectionContext}>
      <section
        onPointerDownCapture={() => { suppressHandleClick.current = false; }}
        onPointerMove={(event) => {
          if (!activeConnection) return;
          const handle = (event.target as Element).closest<HTMLElement>(".react-flow__handle.target");
          dispatchConnection({
            type: "pointer",
            pointer: { x: event.clientX, y: event.clientY },
            target: handle?.dataset.nodeid && handle.dataset.handleid
              ? { nodeId: handle.dataset.nodeid, handleId: handle.dataset.handleid }
              : null,
          });
        }}
        className={cn(
          "relative min-h-0 flex-1 bg-[linear-gradient(90deg,rgba(15,118,110,0.05)_1px,transparent_1px),linear-gradient(180deg,rgba(15,118,110,0.05)_1px,transparent_1px)] bg-[length:32px_32px]",
          className,
        )}
      >
        <ReactFlow<TNode, TEdge>
          onMoveEnd={onMoveEnd}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={canEditTopology}
          nodesConnectable={canEditTopology}
          connectOnClick={false}
          zoomOnDoubleClick={false}
          edgesReconnectable={canEditTopology ? edgesReconnectable : false}
          elementsSelectable={elementsSelectable}
          panOnScroll={panOnScroll}
          minZoom={minZoom}
          maxZoom={maxZoom}
          fitView={fitView}
          reconnectRadius={reconnectRadius}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={(...args) => {
            suppressHandleClick.current = true;
            cancelClickConnection();
            onConnectStart?.(...args);
          }}
          onConnectEnd={onConnectEnd}
          onReconnect={onReconnect}
          onReconnectStart={(...args) => {
            suppressHandleClick.current = true;
            cancelClickConnection();
            onReconnectStart?.(...args);
          }}
          onReconnectEnd={onReconnectEnd}
          isValidConnection={isValidConnection}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeDragStart={cancelClickConnection}
          onNodeClick={(event, node) => {
            onNodeClick?.(event, node);
            const data = getGraphNodeData(node);
            if (data.nodeKind === "processStep" && canEditTopology && event.detail === 1) {
              dispatchConnection({
                type: "source",
                handle: { nodeId: node.id, handleId: data.outputPortId ?? "result_geometry" },
                pointer: { x: event.clientX, y: event.clientY },
              });
            } else if (data.nodeKind !== "processStep") {
              cancelClickConnection();
            }
          }}
          onNodeDoubleClick={(event, node) => {
            if (getGraphNodeData(node).nodeKind !== "processStep") return;
            cancelClickConnection();
            onNodeDoubleClick?.(event, node);
          }}
          onPaneClick={(event) => {
            cancelClickConnection();
            onPaneClick?.(event);
          }}
        >
          {activeConnection ? <ClickConnectionPreview state={activeConnection} valid={connectionContext.validTarget} /> : null}
          <Background color="rgba(15, 118, 110, 0.18)" gap={32} />
          <Controls position="bottom-left" />
          {showMiniMap ? (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(node) =>
                miniMapNodeColor?.(node as TNode) ??
                graphStatusColor(getGraphNodeData(node).status ?? "neutral")
              }
            />
          ) : null}
        </ReactFlow>
        {topRightOverlay ? (
          <div className="absolute right-3 top-3 z-10">{topRightOverlay}</div>
        ) : null}
        {emptyState}
      </section>
    </ClickConnectionContext.Provider>
  );
}

function ClickConnectionPreview({ state, valid }: { state: NonNullable<ClickConnectionState>; valid: boolean }) {
  const sourceNode = useInternalNode(state.source.nodeId);
  const { getInternalNode, screenToFlowPosition } = useReactFlow();
  // Recompute the screen-space pointer after zooming or panning the viewport.
  useViewport();
  const sourceHandle = sourceNode?.internals.handleBounds?.source?.find((handle) => handle.id === state.source.handleId);
  if (!sourceNode || !sourceHandle) return null;
  const source = {
    x: sourceNode.internals.positionAbsolute.x + sourceHandle.x + sourceHandle.width / 2,
    y: sourceNode.internals.positionAbsolute.y + sourceHandle.y + sourceHandle.height / 2,
  };
  const targetNode = state.target ? getInternalNode(state.target.nodeId) : undefined;
  const targetHandle = targetNode?.internals.handleBounds?.target?.find((handle) => handle.id === state.target?.handleId);
  const target = targetNode && targetHandle ? {
    x: targetNode.internals.positionAbsolute.x + targetHandle.x + targetHandle.width / 2,
    y: targetNode.internals.positionAbsolute.y + targetHandle.y + targetHandle.height / 2,
  } : screenToFlowPosition(state.pointer, { snapToGrid: false });
  const [path] = getBezierPath({
    sourceX: source.x, sourceY: source.y, sourcePosition: Position.Right,
    targetX: target.x, targetY: target.y, targetPosition: Position.Left,
  });
  return (
    <ViewportPortal>
      <svg aria-hidden="true" data-testid="click-connection-preview" className="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible">
        <path d={path} fill="none" strokeWidth={2.5} strokeDasharray="6 4"
          className={state.target ? valid ? "stroke-emerald-500" : "stroke-destructive" : "stroke-primary"} />
      </svg>
    </ViewportPortal>
  );
}

function ClickConnectionHandle(props: React.ComponentProps<typeof Handle>) {
  const connection = React.useContext(ClickConnectionContext);
  const nodeId = useNodeId();
  const { type = "source", id, className, ...rest } = props;
  const activeSource = connection?.state?.source.nodeId === nodeId && connection.state.source.handleId === id;
  const activeTarget = connection?.state?.target?.nodeId === nodeId && connection.state.target.handleId === id;
  return <Handle {...rest} id={id} type={type}
    isConnectable={connection?.enabled ?? props.isConnectable}
    isConnectableStart={connection?.enabled ?? props.isConnectableStart}
    isConnectableEnd={connection?.enabled ?? props.isConnectableEnd}
    className={cn(className, activeSource && "ring-2 ring-primary ring-offset-2",
      activeTarget && (connection?.validTarget ? "ring-2 ring-emerald-500 ring-offset-2" : "ring-2 ring-destructive ring-offset-2"))}
    onClick={(event) => {
      event.stopPropagation();
      if (nodeId && id) connection?.clickHandle(event, { nodeId, handleId: id }, type);
    }}
    onDoubleClick={(event) => event.stopPropagation()} />;
}

function FlowInputNode({
  id,
  data,
  selected,
}: NodeProps<Node<ProcessFlowGraphNodeData>>) {
  const graphMode = data.graphMode ?? "edit";
  const status = data.status ?? "incomplete";
  const ready = status === "ready";
  const label = data.displayLabel ?? "Select geometry";
  const sublabel = data.displaySublabel;
  const pickId = data.pickId ?? id;
  const iconUrl = getGeometryIconUrl(data.icon);
  const iconLoadStatus = useGeometryIconLoadStatus(iconUrl);
  const iconScale = normalizeGeometryIconScale(data.iconScale);
  const statusClasses = getFlowInputStatusClasses(status);

  if (iconUrl && iconLoadStatus === "ready") {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center text-center transition",
          graphMode === "edit"
            ? "group h-[132px] w-[132px]"
            : "h-[138px] w-[138px] cursor-pointer hover:shadow-md",
          "rounded-xl ring-2 ring-transparent hover:ring-primary/20",
          selected && "ring-primary/40",
        )}
        title={graphMode === "view" ? "Select initial geometry" : undefined}
        onDoubleClick={(event) => {
          if (graphMode !== "view") {
            return;
          }
          event.stopPropagation();
          data.onPick?.(pickId);
        }}
      >
        <ClickConnectionHandle
          type="source"
          id="out"
          position={Position.Right}
          isConnectable={graphMode === "edit"}
          className="!h-4 !w-4 !border-2 !border-white !bg-primary"
        />
        <div
          aria-hidden="true"
          className={cn("transition-colors", statusClasses.icon)}
          style={getGeometryIconMaskStyle(iconUrl, iconScale)}
        />
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 text-center",
            graphMode === "edit" ? "w-[132px]" : "w-[138px]",
          )}
        >
          <div className="line-clamp-2 text-xs font-semibold leading-tight">{label}</div>
          {sublabel ? (
            <div
              className={cn(
                "mt-1 truncate text-[10px] text-muted-foreground",
                graphMode === "edit" ? "max-w-[132px]" : "max-w-[138px]",
              )}
            >
              {sublabel}
            </div>
          ) : null}
          {graphMode === "view" ? (
            <Badge
              variant={ready ? "signal" : "outline"}
              className={cn("mt-2", getStatusBadgeClasses(status))}
            >
              {data.statusLabel ?? (ready ? "Bound" : "Unbound")}
            </Badge>
          ) : null}
        </div>
        {graphMode === "edit" && data.onDelete ? (
          <button
            className="nodrag absolute -right-1 -top-1 hidden h-7 w-7 items-center justify-center rounded-full border bg-white text-muted-foreground shadow-sm transition hover:text-destructive group-hover:flex"
            title="Delete geometry input"
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete?.(id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center rounded-full border-4 bg-white p-4 text-center shadow-sm transition",
        graphMode === "edit"
          ? "group h-[132px] w-[132px]"
          : "h-[138px] w-[138px] cursor-pointer hover:shadow-md",
        statusClasses.border,
      )}
      title={graphMode === "view" ? "Select initial geometry" : undefined}
      onDoubleClick={(event) => {
        if (graphMode !== "view") {
          return;
        }
        event.stopPropagation();
        data.onPick?.(pickId);
      }}
    >
      <ClickConnectionHandle
        type="source"
        id="out"
        position={Position.Right}
        isConnectable={graphMode === "edit"}
        className="!h-4 !w-4 !border-2 !border-white !bg-primary"
      />
      <CircleDot className="mb-2 h-5 w-5 text-primary" />
      <div className="line-clamp-2 text-xs font-semibold leading-tight">{label}</div>
      {sublabel ? (
        <div
          className={cn(
            "mt-1 truncate text-[10px] text-muted-foreground",
            graphMode === "edit" ? "max-w-[92px]" : "max-w-[100px]",
          )}
        >
          {sublabel}
        </div>
      ) : null}
      {graphMode === "view" ? (
        <Badge
          variant={ready ? "signal" : "outline"}
          className={cn("mt-2", getStatusBadgeClasses(status))}
        >
          {data.statusLabel ?? (ready ? "Bound" : "Unbound")}
        </Badge>
      ) : null}
      {graphMode === "edit" && data.onDelete ? (
        <button
          className="nodrag absolute -right-1 -top-1 hidden h-7 w-7 items-center justify-center rounded-full border bg-white text-muted-foreground shadow-sm transition hover:text-destructive group-hover:flex"
          title="Delete geometry input"
          onClick={(event) => {
            event.stopPropagation();
            data.onDelete?.(id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ProcessStepNode({ id, data }: NodeProps<Node<ProcessFlowGraphNodeData>>) {
  const clickConnection = React.useContext(ClickConnectionContext);
  const graphMode = data.graphMode ?? "edit";
  const status = data.status ?? "incomplete";
  const ready = status === "ready";
  const error = status === "error";
  const inputPorts = data.geometryInputPorts ?? [];
  const template = data.template ?? { name: data.displayLabel ?? "Process step", version: "" };
  const displayLabel =
    typeof data.displayLabel === "string" && data.displayLabel.trim()
      ? data.displayLabel.trim()
      : undefined;
  const displaySublabel =
    typeof data.displaySublabel === "string" && data.displaySublabel.trim()
      ? data.displaySublabel.trim()
      : undefined;
  const nodeTitle = displayLabel ?? template.name;
  const editId = data.editId ?? data.stepRefId ?? id;
  const activeTargetPortId = useConnection((connection) =>
    connection.toHandle?.nodeId === id && connection.toHandle.type === "target"
      ? connection.toHandle.id
      : null,
  );
  const activeSourceHandleId = useConnection((connection) =>
    connection.fromHandle?.nodeId === id && connection.fromHandle.type === "source"
      ? connection.fromHandle.id
      : null,
  );
  const terminalViewDisabled = Boolean(data.terminalGeometryViewDisabled);
  const outputPortId = data.outputPortId ?? "result_geometry";
  const terminalViewVisible =
    Boolean(data.terminalGeometryViewVisible && data.onTerminalGeometryView) &&
    activeSourceHandleId !== outputPortId &&
    clickConnection?.state?.source.nodeId !== id;

  return (
    <div
      className={cn(
        "relative grid grid-rows-[3fr_2fr] rounded-md border-2 bg-white shadow-sm transition",
        graphMode === "edit"
          ? "group h-[132px] w-[248px]"
          : "h-[138px] w-[252px] cursor-pointer hover:shadow-md",
        error
          ? "border-destructive"
          : ready
            ? "border-emerald-500"
            : status === "neutral"
              ? "border-muted-foreground/40"
              : "border-amber-500",
      )}
      title={graphMode === "edit" ? "Click to connect; double-click to edit step" : "Double-click to edit step"}
    >
      <div className="absolute left-0 top-3 flex -translate-x-1/2 flex-col gap-2">
        {inputPorts.map((port) => {
          const labelVisible = activeTargetPortId === port.id ||
            (clickConnection?.state?.target?.nodeId === id && clickConnection.state.target.handleId === port.id);

          return (
            <div key={port.id} className="group/input relative flex items-center">
              <ClickConnectionHandle
                type="target"
                id={port.id}
                position={Position.Left}
                isConnectable={graphMode === "edit"}
                className="!relative !left-auto !top-auto !h-4 !w-4 !translate-x-0 !translate-y-0 !border-2 !border-white !bg-cyan-600"
              />
              <div
                className={cn(
                  "pointer-events-none absolute left-5 z-20 hidden max-w-[150px] rounded-md border bg-white px-2 py-1 text-[10px] font-medium shadow-sm group-hover/input:block group-focus-within/input:block",
                  labelVisible && "block",
                )}
              >
                {port.name}
              </div>
            </div>
          );
        })}
      </div>

      <ClickConnectionHandle
        type="source"
        id={outputPortId}
        position={Position.Right}
        isConnectable={graphMode === "edit"}
        className="!h-4 !w-4 !border-2 !border-white !bg-primary"
      />

      {terminalViewVisible ? (
        <div className="nodrag nopan pointer-events-none absolute left-full top-1/2 z-20 ml-3 flex -translate-y-1/2 items-center">
          <div className="h-px w-5 bg-border/80" />
          <button
            className={cn(
              "pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary bg-white text-primary shadow-sm transition hover:bg-primary hover:text-primary-foreground",
              terminalViewDisabled &&
                "cursor-not-allowed border-muted-foreground/30 text-muted-foreground opacity-60 hover:bg-white hover:text-muted-foreground",
            )}
            title={data.terminalGeometryViewTitle ?? "Preview final geometry state"}
            aria-label={data.terminalGeometryViewTitle ?? "Preview final geometry state"}
            disabled={terminalViewDisabled}
            onClick={(event) => {
              event.stopPropagation();
              if (terminalViewDisabled) {
                return;
              }
              data.onTerminalGeometryView?.();
            }}
          >
            <Eye className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-col justify-center border-b bg-muted/40 px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="line-clamp-2 text-base font-semibold leading-tight">{nodeTitle}</div>
            {displaySublabel ? (
              <div className="mt-1 truncate text-xs text-muted-foreground">{displaySublabel}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-1">
            {graphMode === "edit" && data.onDelete ? (
              <button
                type="button"
                className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-white hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100"
                title="Delete step"
                aria-label={`Delete step ${nodeTitle}`}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  clickConnection?.cancel();
                  data.onDelete?.(id);
                }}
              >
                <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {data.onEdit ? (
              <button
                type="button"
                className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Edit step"
                aria-label={`Edit step ${nodeTitle}`}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  clickConnection?.cancel();
                  data.onEdit?.(editId);
                }}
              >
                <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="truncate text-muted-foreground">{template.version}</span>
        <Badge
          variant={ready ? "signal" : "outline"}
          className={cn(getStatusBadgeClasses(status))}
        >
          {data.statusLabel ??
            (error
              ? "Invalid"
              : ready
                ? "Ready"
                : status === "neutral"
                  ? "Optional"
                  : "Incomplete")}
        </Badge>
      </div>
    </div>
  );
}

function DataFlowEdge(props: EdgeProps<Edge<ProcessFlowGraphEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath(props);
  const data = props.data;
  const graphMode = data?.graphMode ?? "edit";
  const status = data?.status ?? "neutral";
  const clickConnection = React.useContext(ClickConnectionContext);
  const sourceIsBeingReconnected = useConnection((connection) => {
    const sourceHandleId = props.sourceHandleId ?? "result_geometry";
    return (
      connection.fromHandle?.type === "source" &&
      connection.fromHandle.nodeId === props.source &&
      (connection.fromHandle.id ?? "result_geometry") === sourceHandleId
    );
  });
  const canViewGeometry =
    Boolean(data?.onGeometryView) &&
    (data?.geometryViewVisible === true || data?.sourceKind === "stepOutput");
  const geometryViewDisabled = Boolean(data?.geometryViewDisabled);

  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        markerEnd={props.markerEnd}
        interactionWidth={graphMode === "edit" ? 18 : 16}
        className={cn(
          "!stroke-[2.5px]",
          (sourceIsBeingReconnected ||
            (clickConnection?.state?.source.nodeId === props.source &&
              clickConnection.state.source.handleId === (props.sourceHandleId ?? "result_geometry")))
            ? "!stroke-muted-foreground/35"
            : props.selected
              ? "!stroke-primary"
              : getEdgeStatusClasses(status),
        )}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 text-[10px]"
          style={{ transform: `translate(${labelX}px, ${labelY}px)` }}
        >
          {canViewGeometry ? (
            <button
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary bg-white text-primary shadow-sm transition hover:bg-primary hover:text-primary-foreground",
                geometryViewDisabled &&
                  "cursor-not-allowed border-muted-foreground/30 text-muted-foreground opacity-60 hover:bg-white hover:text-muted-foreground",
              )}
              title={data?.geometryViewTitle ?? "View geometry state"}
              disabled={geometryViewDisabled}
              onClick={(event) => {
                event.stopPropagation();
                data?.onGeometryView?.();
              }}
            >
              <Eye className="h-4 w-4" />
            </button>
          ) : null}
          <span
            className={cn(
              "truncate rounded-md border bg-white/95 px-2 py-1 text-muted-foreground shadow-sm",
              graphMode === "edit" ? "max-w-[120px]" : "max-w-[132px]",
              getEdgeLabelStatusClasses(status),
            )}
          >
            {data?.slotLabel}
          </span>
          {graphMode === "edit" && data?.onDelete ? (
            <button
              className="flex h-6 w-6 items-center justify-center rounded-full border bg-white/95 text-muted-foreground shadow-sm transition hover:bg-destructive/10 hover:text-destructive"
              title="Delete edge"
              onClick={(event) => {
                event.stopPropagation();
                data.onDelete?.(props.id);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function getGraphNodeData(node: Node): Partial<ProcessFlowGraphNodeData> {
  return (node.data ?? {}) as Partial<ProcessFlowGraphNodeData>;
}

function getFlowInputStatusClasses(
  status: ProcessFlowGraphNodeStatus,
) {
  if (status === "ready") {
    return {
      border: "border-emerald-500",
      icon: "bg-emerald-500",
    };
  }
  if (status === "error") {
    return {
      border: "border-destructive",
      icon: "bg-destructive",
    };
  }
  if (status === "neutral") {
    return {
      border: "border-muted-foreground/40",
      icon: "bg-muted-foreground",
    };
  }
  return {
    border: "border-amber-500",
    icon: "bg-amber-500",
  };
}

function getStatusBadgeClasses(status: ProcessFlowGraphStatus) {
  if (status === "error") return "border-destructive/30 text-destructive";
  if (status === "incomplete") return "border-amber-300 text-amber-700";
  if (status === "neutral") return "border-muted-foreground/30 text-muted-foreground";
  return undefined;
}

function getEdgeStatusClasses(status: ProcessFlowGraphStatus) {
  if (status === "ready") return "!stroke-emerald-500";
  if (status === "incomplete") return "!stroke-amber-500";
  if (status === "error") return "!stroke-destructive";
  return "!stroke-muted-foreground/45";
}

function getEdgeLabelStatusClasses(status: ProcessFlowGraphStatus) {
  if (status === "ready") return "border-emerald-200";
  if (status === "incomplete") return "border-amber-300 text-amber-800";
  if (status === "error") return "border-destructive/30 text-destructive";
  return "border-muted-foreground/20";
}

function graphStatusColor(status: ProcessFlowGraphStatus) {
  if (status === "ready") return "#10b981";
  if (status === "incomplete") return "#f59e0b";
  if (status === "error") return "#dc2626";
  return "#94a3b8";
}

function getGeometryIconUrl(icon: unknown) {
  if (typeof icon !== "string") {
    return null;
  }

  const segments = icon
    .trim()
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  return `/resources/icons/${segments.map(encodeURIComponent).join("/")}.svg`;
}

function normalizeGeometryIconScale(iconScale: unknown) {
  return typeof iconScale === "number" &&
    Number.isFinite(iconScale) &&
    iconScale > 0 &&
    iconScale <= 1
    ? iconScale
    : DEFAULT_GEOMETRY_ICON_SCALE;
}

function getGeometryIconMaskStyle(
  iconUrl: string,
  iconScale: number,
): React.CSSProperties {
  const size = `${iconScale * 100}%`;

  return {
    width: size,
    height: size,
    maskImage: `url("${iconUrl}")`,
    WebkitMaskImage: `url("${iconUrl}")`,
    maskPosition: "center",
    WebkitMaskPosition: "center",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskSize: "contain",
    WebkitMaskSize: "contain",
  };
}

function useGeometryIconLoadStatus(iconUrl: string | null) {
  const [status, setStatus] = React.useState<
    "idle" | "checking" | "ready" | "missing"
  >(iconUrl ? "checking" : "idle");

  React.useEffect(() => {
    if (!iconUrl) {
      setStatus("idle");
      return;
    }

    let active = true;
    const image = new Image();
    setStatus("checking");

    image.onload = () => {
      if (active) {
        setStatus("ready");
      }
    };
    image.onerror = () => {
      if (!active) {
        return;
      }

      setStatus("missing");
      if (!warnedMissingGeometryIconUrls.has(iconUrl)) {
        warnedMissingGeometryIconUrls.add(iconUrl);
        console.warn(`Geometry icon not found, falling back to block: ${iconUrl}`);
      }
    };
    image.src = iconUrl;

    return () => {
      active = false;
    };
  }, [iconUrl]);

  return status;
}
