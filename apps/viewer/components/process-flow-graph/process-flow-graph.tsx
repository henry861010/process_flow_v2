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
  getBezierPath,
  useConnection,
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
  onPaneClick?: ReactFlowBaseProps["onPaneClick"];
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
  onPaneClick,
  miniMapNodeColor,
}: ProcessFlowGraphProps<TNode, TEdge>) {
  const canEditTopology = mode === "edit";

  return (
    <section
      className={cn(
        "relative min-h-0 flex-1 bg-[linear-gradient(90deg,rgba(15,118,110,0.05)_1px,transparent_1px),linear-gradient(180deg,rgba(15,118,110,0.05)_1px,transparent_1px)] bg-[length:32px_32px]",
        className,
      )}
    >
      <ReactFlow<TNode, TEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={canEditTopology}
        nodesConnectable={canEditTopology}
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
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onReconnectStart={onReconnectStart}
        onReconnectEnd={onReconnectEnd}
        isValidConnection={isValidConnection}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
      >
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
      {emptyState}
    </section>
  );
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
        <Handle
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
      <Handle
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
    activeSourceHandleId !== outputPortId;

  return (
    <div
      className={cn(
        "relative rounded-md border-2 bg-white shadow-sm transition",
        graphMode === "edit"
          ? "group w-[248px]"
          : "w-[252px] cursor-pointer hover:shadow-md",
        error
          ? "border-destructive"
          : ready
            ? "border-emerald-500"
            : status === "neutral"
              ? "border-muted-foreground/40"
              : "border-amber-500",
      )}
      title={graphMode === "view" ? "Edit step values" : undefined}
      onDoubleClick={(event) => {
        if (graphMode !== "view") {
          return;
        }
        event.stopPropagation();
        data.onEdit?.(editId);
      }}
    >
      <div className="absolute left-0 top-3 flex -translate-x-1/2 flex-col gap-2">
        {inputPorts.map((port) => {
          const labelVisible = activeTargetPortId === port.id;

          return (
            <div key={port.id} className="group/input relative flex items-center">
              <Handle
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

      <Handle
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

      <div className="border-b bg-muted/40 px-3 py-2">
        {graphMode === "edit" ? (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="line-clamp-2 text-sm font-semibold leading-snug">
                {nodeTitle}
              </div>
              {displaySublabel ? (
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {displaySublabel}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
              {data.onEdit ? (
                <button
                  className="nodrag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white hover:text-foreground"
                  title="Edit values"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onEdit?.(editId);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {data.onDelete ? (
                <button
                  className="nodrag flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white hover:text-destructive"
                  title="Delete step"
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onDelete?.(id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="line-clamp-2 text-sm font-semibold leading-snug">
              {nodeTitle}
            </div>
            {displaySublabel ? (
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {displaySublabel}
              </div>
            ) : null}
          </>
        )}
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
          props.selected ? "!stroke-primary" : getEdgeStatusClasses(status),
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
