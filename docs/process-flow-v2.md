# Process Flow V2 Contract

This document defines the V2 process-flow contract used by the API, compiler,
kernel, and viewer. V2 is a breaking replacement for the previous
`geometryRef` and `StepValueSet` model.

## Ownership Boundaries

- `ProcessStepTemplate` defines geometry ports and non-geometry parameters.
- `ProcessFlowTemplate` defines flow-level inputs, step references, and graph
  topology. It never stores product geometry selections or parameter values.
- `ProcessFlowWorkspace` is a mutable, potentially incomplete instance draft.
- `ProcessFlowInstance` is an immutable, complete product configuration.
- `FlowCompiler` resolves external resources and creates an `ExecutionPlan`.
- `GeometryKernel` executes an `ExecutionPlan` and never reads a repository.

Every persisted V2 object has `schemaVersion: 2`.

## ProcessStepTemplate

```json
{
  "schemaVersion": 2,
  "id": "step_tpl_pnp_2_0_0",
  "version": "V2.0.0",
  "name": "PnP",
  "category": "assembly.pnp",
  "program": "pnp/pnp",
  "description": "Places a component geometry into the primary geometry.",
  "owner": "integration.platform",
  "inputPorts": [
    {
      "portId": "main_geometry",
      "name": "Main geometry",
      "dataType": "geometry",
      "role": "primary",
      "required": true
    },
    {
      "portId": "die_geometry",
      "name": "Die geometry",
      "dataType": "geometry",
      "role": "auxiliary",
      "required": true
    }
  ],
  "outputPorts": [
    {
      "portId": "result_geometry",
      "name": "Result geometry",
      "dataType": "geometry"
    }
  ],
  "parameterDefinitions": []
}
```

V2 process steps have exactly one primary geometry input named
`main_geometry` and exactly one geometry output named `result_geometry`.
Additional geometry inputs use `role: "auxiliary"`. Port ids and parameter ids
must be unique within their own collections.

`geometryRef` is not a parameter type. Geometry is transferred only through
ports.

## ProcessFlowTemplate

```json
{
  "schemaVersion": 2,
  "id": "flow_tpl_cowosl_2_0_0",
  "name": "CoWoS-L",
  "version": "V2.0.0",
  "description": "Reusable technology flow.",
  "owner": "integration.platform",
  "flowInputs": [
    {
      "flowInputId": "incoming_substrate",
      "name": "Incoming substrate",
      "dataType": "geometry",
      "required": true,
      "geometryConstraints": {
        "entityTypes": ["wafer", "panel"]
      }
    }
  ],
  "stepRefs": [
    {
      "stepRefId": "pnp",
      "stepLabel": "PnP",
      "processStepTemplateId": "step_tpl_pnp_2_0_0"
    }
  ],
  "flowEdges": [
    {
      "edgeId": "edge_substrate_to_pnp",
      "source": {
        "kind": "flowInput",
        "flowInputId": "incoming_substrate"
      },
      "target": {
        "stepRefId": "pnp",
        "inputPortId": "main_geometry"
      }
    }
  ]
}
```

An edge source is one of:

```json
{ "kind": "flowInput", "flowInputId": "incoming_substrate" }
```

```json
{
  "kind": "stepOutput",
  "stepRefId": "pnp",
  "outputPortId": "result_geometry"
}
```

Every required input port has exactly one incoming edge. Graph cycles and
multiple incoming edges are invalid. V2 initially permits one consumer per
step output port; the payload shape does not need to change when that policy is
relaxed later.

Every declared flow input must be connected. A flow input with
`required: false` may omit its binding only when all of its target step ports
are also optional. A required target port makes the source binding required.

## Shared Flow Configuration

Workspace, instance, and preview payloads share the following configuration
shape:

```json
{
  "inputBindings": {
    "incoming_substrate": {
      "kind": "catalog",
      "geometryId": "geom_panel_001"
    }
  },
  "stepConfigurations": {
    "pnp": {
      "parameterValues": {
        "coordinates": [[0, 0]]
      }
    }
  }
}
```

`stepConfigurations` does not repeat the process-step template id. That
binding belongs to `ProcessFlowTemplate.stepRefs`.

## ProcessFlowWorkspace

```json
{
  "schemaVersion": 2,
  "id": "workspace_001",
  "name": "Customer package study",
  "processFlowTemplateId": "flow_tpl_cowosl_2_0_0",
  "revision": 1,
  "status": "draft",
  "inputBindings": {
    "incoming_substrate": {
      "kind": "catalog",
      "geometryId": "geom_panel_001"
    },
    "incoming_die": {
      "kind": "embedded",
      "localId": "draft_hbm_001"
    }
  },
  "stepConfigurations": {},
  "embeddedGeometries": {
    "draft_hbm_001": {
      "name": "HBM study",
      "entityType": "hbm",
      "category": "die.hbm",
      "structureFormat": "standard",
      "structure": {}
    }
  }
}
```

A workspace may be incomplete. Saving a draft validates payload shape and
reference consistency, but does not require every input or parameter.
Workspace updates use optimistic revision checks.

## ProcessFlowInstance

```json
{
  "schemaVersion": 2,
  "id": "flow_instance_customer_a",
  "name": "Customer A",
  "processFlowTemplateId": "flow_tpl_cowosl_2_0_0",
  "inputBindings": {
    "incoming_substrate": {
      "kind": "catalog",
      "geometryId": "geom_panel_001"
    }
  },
  "stepConfigurations": {}
}
```

An instance is complete and immutable. Every input binding is a catalog
binding. Editing an instance in place is not supported.

## Compile and Execute

Compilation performs these steps without executing process modules:

1. Resolve step templates referenced by the flow template.
2. Validate topology, ports, bindings, and parameter values.
3. Resolve catalog bindings through a repository-backed resolver.
4. Resolve embedded bindings from the workspace payload.
5. Normalize all external geometry structures.
6. Produce an `ExecutionPlan` with full external structures and explicit
   upstream-output references.

The kernel receives only the execution plan. A planned input source is either
an external structure key or a step-output reference. The kernel clones an
upstream geometry state before passing it to a downstream step.

## Workspace Commit

Committing a workspace is atomic and idempotent:

1. Validate the complete workspace.
2. Materialize referenced embedded geometries as immutable catalog entities.
3. Rewrite embedded bindings to catalog bindings.
4. Insert a new immutable `ProcessFlowInstance`.
5. Mark the workspace `committed` and record `committedInstanceId`.

`committedInstanceId` supports retry safety. It does not establish lineage
between process-flow instances.

The committed workspace stores the rewritten catalog bindings and clears its
`embeddedGeometries` map.

## Editor Save Paths

- Flow Template Editor can save only the immutable topology. After that save,
  topology is locked while its working configuration remains available for an
  optional instance save.
- Before the template exists, Save Template & Instance inserts both resources
  atomically.
- Flow Instance Workspace always starts from an existing template. Its first
  Save Draft creates a workspace; subsequent saves use optimistic revisions.
- Workspace commit creates a new instance. V2 does not clone or overwrite an
  existing instance.

## Local Database Version

The SQLite `schema_metadata.databaseSchemaVersion` is `2`. Because the product
has not been released, an unversioned or non-V2 local database is cleared and
reseeded with V2 fixtures rather than migrated.
