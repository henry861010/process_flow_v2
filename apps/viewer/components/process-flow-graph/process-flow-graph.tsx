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
export type ProcessFlowGraphNodeStatus = "outside" | "complete" | "incomplete";

export type ProcessFlowGraphField = {
  id: string;
  name: string;
};

export type ProcessFlowGraphStepTemplate = {
  name: string;
  version: string;
};

export type ProcessFlowGraphNodeData = Record<string, unknown> & {
  nodeKind: "initialGeometry" | "processStep";
  graphMode?: ProcessFlowGraphMode;
  displayLabel?: string;
  displaySublabel?: string;
  editId?: string;
  pickId?: string;
  status?: ProcessFlowGraphNodeStatus;
  statusLabel?: string;
  stepRefId?: string;
  template?: ProcessFlowGraphStepTemplate;
  geometryInputFields?: ProcessFlowGraphField[];
  onDelete?: (nodeId: string) => void;
  onEdit?: (nodeId: string) => void;
  onPick?: (nodeId: string) => void;
};

export type ProcessFlowGraphEdgeData = Record<string, unknown> & {
  sourceType: "geometryRef" | "stepOutput";
  targetStepRefId: string;
  targetFieldId: string;
  slotLabel: string;
  sourceLabel: string;
  graphMode?: ProcessFlowGraphMode;
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
  initialGeometry: InitialGeometryNode,
  processStep: ProcessStepNode,
} as NodeTypes;

const edgeTypes = {
  dataFlow: DataFlowEdge,
};

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
              (getGraphNodeData(node).nodeKind === "initialGeometry"
                ? mode === "view"
                  ? "#f59e0b"
                  : "#0f766e"
                : "#0891b2")
            }
          />
        ) : null}
      </ReactFlow>
      {emptyState}
    </section>
  );
}

function InitialGeometryNode({ id, data }: NodeProps<Node<ProcessFlowGraphNodeData>>) {
  const graphMode = data.graphMode ?? "edit";
  const status = data.status ?? "incomplete";
  const complete = status === "complete";
  const label = data.displayLabel ?? "Select geometry";
  const sublabel = data.displaySublabel;
  const pickId = data.pickId ?? id;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center rounded-full border-4 bg-white p-4 text-center shadow-sm transition",
        graphMode === "edit"
          ? "group h-[132px] w-[132px]"
          : "h-[138px] w-[138px] cursor-pointer hover:shadow-md",
        complete
          ? "border-emerald-500"
          : graphMode === "edit"
            ? "border-destructive"
            : "border-amber-500",
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
          variant={complete ? "signal" : "outline"}
          className={cn("mt-2", !complete && "border-amber-300 text-amber-700")}
        >
          {data.statusLabel ?? (complete ? "Selected" : "Required")}
        </Badge>
      ) : null}
      {graphMode === "edit" && data.onDelete ? (
        <button
          className="nodrag absolute -right-1 -top-1 hidden h-7 w-7 items-center justify-center rounded-full border bg-white text-muted-foreground shadow-sm transition hover:text-destructive group-hover:flex"
          title="Delete geometry node"
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
  const complete = status === "complete";
  const outside = status === "outside";
  const inputFields = data.geometryInputFields ?? [];
  const template = data.template ?? { name: data.displayLabel ?? "Process step", version: "" };
  const editId = data.editId ?? data.stepRefId ?? id;
  const activeTargetFieldId = useConnection((connection) =>
    connection.toHandle?.nodeId === id && connection.toHandle.type === "target"
      ? connection.toHandle.id
      : null,
  );

  return (
    <div
      className={cn(
        "relative rounded-md border-2 bg-white shadow-sm transition",
        graphMode === "edit"
          ? "group w-[248px]"
          : "w-[252px] cursor-pointer hover:shadow-md",
        outside
          ? "border-destructive"
          : complete
            ? "border-emerald-500"
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
        {inputFields.map((field) => {
          const labelVisible = activeTargetFieldId === field.id;

          return (
            <div key={field.id} className="group/input relative flex items-center">
              <Handle
                type="target"
                id={field.id}
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
                {field.name}
              </div>
            </div>
          );
        })}
      </div>

      <Handle
        type="source"
        id="out"
        position={Position.Right}
        isConnectable={graphMode === "edit"}
        className="!h-4 !w-4 !border-2 !border-white !bg-primary"
      />

      <div className="border-b bg-muted/40 px-3 py-2">
        {graphMode === "edit" ? (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="line-clamp-2 text-sm font-semibold leading-snug">
                {template.name}
              </div>
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
              {template.name}
            </div>
            {data.displaySublabel ? (
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {data.displaySublabel}
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="truncate text-muted-foreground">{template.version}</span>
        <Badge
          variant={!outside && complete ? "signal" : "outline"}
          className={cn(
            outside && "border-destructive/30 text-destructive",
            !outside && !complete && "border-amber-300 text-amber-700",
          )}
        >
          {data.statusLabel ??
            (outside ? "outside flow" : complete ? "Complete" : "Incomplete fields")}
        </Badge>
      </div>
    </div>
  );
}

function DataFlowEdge(props: EdgeProps<Edge<ProcessFlowGraphEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath(props);
  const data = props.data;
  const graphMode = data?.graphMode ?? "edit";
  const canViewGeometry = data?.sourceType === "stepOutput";

  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        markerEnd={props.markerEnd}
        interactionWidth={graphMode === "edit" ? 18 : 16}
        className={cn(
          "!stroke-[2.5px]",
          props.selected ? "!stroke-primary" : "!stroke-cyan-700",
        )}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 text-[10px]"
          style={{ transform: `translate(${labelX}px, ${labelY}px)` }}
        >
          {canViewGeometry ? (
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary bg-white text-primary shadow-sm transition hover:bg-primary hover:text-primary-foreground"
              title="View geometry state"
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
