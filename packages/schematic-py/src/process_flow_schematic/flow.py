"""Flow-wide schematic planning and generic provenance binding.

The application supplies resource resolution and registered step descriptions.
This module depends on neither API models nor physical/process execution.
"""
from __future__ import annotations

import json
import heapq
from collections import defaultdict
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field, replace
from typing import Any

from .contracts import SchematicFeatureSlot, SchematicLayoutPlan, SchematicSlot
from .scene import PhysicalSample, SceneState, SchematicDelta, apply_delta, namespace_id, resolve_physical_data
from .geometry import geometry_bounds
from .scene_layout import SceneLayoutPlan, SceneLayoutPolicy, make_scene_layout_plan
from .source import describe_source_scene, normalize_scene_members


@dataclass(frozen=True)
class FlowSource:
    kind: str
    owner_id: str
    output_port_id: str | None = None


@dataclass(frozen=True)
class FlowNode:
    id: str
    program: str
    inputs: tuple[tuple[str, FlowSource], ...]


@dataclass
class FlowSchematicPlan:
    fingerprint: str
    layouts: dict[str, SchematicLayoutPlan] = field(default_factory=dict)
    scene_layouts: dict[str, SceneLayoutPlan] = field(default_factory=dict)
    outputs: dict[str, SceneState] = field(default_factory=dict)
    inputs: dict[str, SceneState] = field(default_factory=dict)
    input_bindings: dict[str, dict[str, str]] = field(default_factory=dict)
    input_assemblies: dict[str, set[str]] = field(default_factory=dict)
    nodes: dict[str, FlowNode] = field(default_factory=dict)
    deltas: dict[str, SchematicDelta] = field(default_factory=dict)
    layout_failures: dict[str, str] = field(default_factory=dict)

    @property
    def cache_weight(self):
        return len(json.dumps(asdict(self), default=lambda value: sorted(value), separators=(",", ":")).encode())

    def scene_for(self, target):
        return self.outputs.get(target.get("stepRefId")) if target["type"] == "stepOutput" else self.inputs.get(target["flowInputId"])

    def layout_for(self, target):
        state = self.scene_for(target)
        if state is None:
            return None
        if target["type"] == "flowInput":
            phases = self.input_assemblies.get(target["flowInputId"], set())
            if len(phases) == 1:
                return self.layouts.get(next(iter(phases)))
        return self.layouts.get(state.phase_id)


def transport_layout(plan: SceneLayoutPlan) -> SchematicLayoutPlan:
    return SchematicLayoutPlan(
        tuple(SchematicSlot(slot.id, slot.group_key, slot.x, slot.width, slot.region_id) for slot in plan.slots),
        plan.width, fingerprint=plan.fingerprint, notes=plan.notes,
        features=tuple(SchematicFeatureSlot(feature.object_id, feature.region_id, feature.centers, feature.width)
                       for feature in plan.features if feature.layout == "distributed"),
    )


def plan_flow(nodes: tuple[FlowNode, ...], *, fingerprint: str, registry,
              resolve_input: Callable[[str], Mapping],
              resolve_parameters: Callable[[str], Mapping],
              describe: Callable[[FlowNode, Mapping, Mapping[str, SceneState]], SchematicDelta],
              active_ports: Callable[[FlowNode, Mapping], tuple[str, ...]] | None = None) -> FlowSchematicPlan:
    plan = FlowSchematicPlan(fingerprint, nodes={node.id: node for node in nodes})
    history: dict[str, list[SceneState]] = defaultdict(list)
    notes: dict[str, list[str]] = defaultdict(list)
    failures, visiting = {}, set()

    def remember(state):
        history[state.phase_id].append(state)
        return state

    def input_scene(input_id):
        if input_id not in plan.inputs:
            state, bindings = describe_source_scene(resolve_input(input_id), registry, source_id=input_id)
            plan.inputs[input_id], plan.input_bindings[input_id] = state, bindings
            remember(state)
        return plan.inputs[input_id]

    def source_scene(source):
        if source.kind == "flowInput":
            return input_scene(source.owner_id)
        if source.kind != "stepOutput" or source.output_port_id not in (None, "result_geometry"):
            raise ValueError("Unsupported schematic source")
        return output_scene(source.owner_id)

    def output_scene(node_id):
        if node_id in plan.outputs:
            return plan.outputs[node_id]
        if node_id in failures:
            raise ValueError(failures[node_id])
        if node_id in visiting:
            raise ValueError("dependency cycle")
        visiting.add(node_id)
        main = None
        try:
            node = plan.nodes[node_id]
            main_sources = [source for port, source in node.inputs if port == "main_geometry"]
            if len(main_sources) != 1:
                raise ValueError("main_geometry needs one connected source")
            main_source = main_sources[0]
            main = source_scene(main_source)
            if main_source.kind == "flowInput":
                phase = namespace_id(main_source.owner_id, f"assembly:{node_id}")
                main = replace(main, phase_id=phase)
                plan.input_assemblies.setdefault(main_source.owner_id, set()).add(phase)
            remember(main)
            # Resolve only this ready step. Missing future data must not resolve
            # generators or execute any physical operations beyond the horizon.
            parameters = resolve_parameters(node_id)
            sources = {"main_geometry": main}
            enabled_ports = set(active_ports(node, parameters)) if active_ports else {port for port, _ in node.inputs}
            for port, source in sorted(node.inputs, key=lambda item: (item[0], item[1].owner_id)):
                if port == "main_geometry" or port not in enabled_ports:
                    continue
                if port in sources:
                    raise ValueError(f"{port} needs at most one connected source")
                sources[port] = source_scene(source)
            delta = describe(node, parameters, sources)
            state = normalize_scene_members(apply_delta(main, delta))
            plan.outputs[node_id], plan.deltas[node_id] = state, delta
            return remember(state)
        except (ValueError, KeyError, StopIteration) as error:
            reason = str(error) or "required recipe or geometry is unavailable"
            failures[node_id] = reason
            if main is not None:
                notes[main.phase_id].append(f"Layout lookahead stopped at {node_id}: {reason}.")
            raise ValueError(reason) from error
        finally:
            visiting.discard(node_id)

    # Kahn's ready queue gives equal-priority nodes a stable stepRefId order;
    # a DFS could let a lexically early descendant pull a later source first.
    dependencies = {node.id: {source.owner_id for _, source in node.inputs
                             if source.kind == "stepOutput" and source.owner_id in plan.nodes}
                    for node in nodes}
    dependents = defaultdict(set)
    for node_id, sources in dependencies.items():
        for source_id in sources:
            dependents[source_id].add(node_id)
    ready = [node_id for node_id, sources in dependencies.items() if not sources]
    heapq.heapify(ready)
    ordered = []
    while ready:
        node_id = heapq.heappop(ready)
        ordered.append(node_id)
        for dependent in dependents[node_id]:
            dependencies[dependent].remove(node_id)
            if not dependencies[dependent]:
                heapq.heappush(ready, dependent)
    # Keep cycle diagnostics path-local through output_scene's normal handling.
    ordered.extend(sorted(set(plan.nodes) - set(ordered)))
    for node_id in ordered:
        try:
            output_scene(node_id)
        except ValueError:
            pass
    for phase_id, states in history.items():
        phase_fingerprint = namespace_id(fingerprint, phase_id)
        try:
            scene_plan = make_scene_layout_plan(states, fingerprint=phase_fingerprint)
        except ValueError as error:
            # A contradictory region graph must not disable unrelated phases
            # or make current components disappear. An empty reservation plan
            # causes snapshot composition to use its visible local fallback.
            reason = str(error) or "the declared scene could not be arranged"
            plan.layout_failures[phase_id] = reason
            fallback_notes = tuple(dict.fromkeys((
                *(note for state in states for note in state.notes), *notes[phase_id],
                f"Shared layout could not be planned for phase {phase_id}: {reason}. This assembly uses a local layout.",
            )))
            plan.layouts[phase_id] = SchematicLayoutPlan(
                (), SceneLayoutPolicy().minimum_width, fingerprint=phase_fingerprint, notes=fallback_notes)
            continue
        scene_plan = replace(scene_plan, notes=tuple(dict.fromkeys((*scene_plan.notes, *notes[phase_id]))))
        plan.scene_layouts[phase_id] = scene_plan
        plan.layouts[phase_id] = transport_layout(scene_plan)
    return plan


def _physical_nodes(structure):
    def walk(container):
        yield str(container["id"]), "container", container
        for collection, kind in (("bodies", "body"), ("vias", "via"), ("circuits", "circuit"), ("bumps", "bump")):
            for node in container.get(collection, ()):
                yield str(node["id"]), kind, node
        for child in container.get("children", ()):
            yield from walk(child)
    return tuple(walk(structure["root"]))


class SnapshotBindings(dict):
    """Compatibility mapping plus the bound semantic snapshot used by renderers."""

    def __init__(self, mapping, *, scene, logical, physical_data):
        super().__init__(mapping)
        self.scene = scene
        self.logical = dict(logical)
        self.physical_data = tuple(physical_data)


def _display_bindings(state, logical, structure, snapshot_id="snapshot"):
    objects = state.object_map
    result = dict(logical)
    for physical_id, kind, _ in _physical_nodes(structure):
        if kind != "container":
            continue
        obj = objects.get(logical.get(physical_id))
        while obj is not None:
            if obj.layout == "member":
                result[physical_id] = obj.group_key or obj.id
                break
            obj = objects.get(obj.parent_id)
    samples, by_object = {}, defaultdict(list)
    for physical_id, kind, node in _physical_nodes(structure):
        if kind == "container":
            continue
        bounds = geometry_bounds(node.get("geometry", {}))
        object_id = logical.get(physical_id)
        if bounds is None or bounds.thickness <= 0 or object_id not in objects:
            continue
        density = node.get("density") if kind != "body" else None
        samples[physical_id] = PhysicalSample(physical_id, bounds.z_min, bounds.z_max,
                                               str(node.get("material", "")), density)
        by_object[object_id].append(physical_id)
    resolved = resolve_physical_data(state, samples, by_object, snapshot_id=snapshot_id,
                                     unit=str(structure.get("unitSystem", "um")))
    return SnapshotBindings(result, scene=state, logical=logical, physical_data=resolved)


def bind_flow_snapshots(plan: FlowSchematicPlan, snapshots) -> dict[str | None, dict[str, str]]:
    """Consume qualified execution provenance. No process-specific matching."""
    logical_by_output = {}
    display = {}
    for snapshot in snapshots:
        node_id = snapshot.step_ref_id
        if node_id is None:
            input_id = snapshot.target["flowInputId"]
            state = plan.inputs.get(input_id)
            if state is not None:
                display[None] = _display_bindings(state, plan.input_bindings[input_id], snapshot.geometry_structure, input_id)
            continue
        state = plan.outputs.get(node_id)
        if state is None:
            display[node_id] = {}
            continue
        flow_node = plan.nodes[node_id]
        inputs = dict(flow_node.inputs)
        source_maps = {port: (plan.input_bindings.get(source.owner_id, {}) if source.kind == "flowInput"
                              else logical_by_output.get(source.owner_id, {})) for port, source in inputs.items()}
        main = source_maps.get("main_geometry", {})
        derivations = defaultdict(list)
        for derived in plan.deltas[node_id].derivations:
            derivations[(derived.input_port_id, derived.source_object_id)].append(derived.target_object_id)
        objects = state.object_map
        logical = {}
        unresolved = []
        provenance = getattr(snapshot, "provenance", None) or {}
        for physical_id, kind, node in _physical_nodes(snapshot.geometry_structure):
            entry = provenance.get(physical_id, {})
            created_here = (entry.get("createdBy") or {}).get("stepRefId") == node_id
            # Inherited source ancestry can mention an auxiliary input reused
            # by this step. Retained nodes belong to the main input, not to a
            # new copy of that same source. A joint also retains its upper ID.
            if not created_here and physical_id in main and main[physical_id] in objects:
                logical[physical_id] = main[physical_id]
                continue
            candidates = []
            for origin in entry.get("sources", ()):
                port = origin.get("inputPortId")
                source = inputs.get(port)
                if source is None or (origin.get("kind"), origin.get("ownerId")) != (source.kind, source.owner_id):
                    continue
                if not created_here and port != "main_geometry":
                    continue
                if origin.get("outputPortId") != source.output_port_id:
                    continue
                source_object = source_maps.get(port, {}).get(origin.get("nodeId"))
                if source_object is None:
                    continue
                targets = derivations.get((port, source_object), ())
                candidates.extend(target for target in targets if target in objects)
                if not targets and port == "main_geometry" and source_object in objects:
                    candidates.append(source_object)
            candidates = list(dict.fromkeys(candidates))
            if len(candidates) == 1:
                logical[physical_id] = candidates[0]
            elif not candidates and physical_id in main and main[physical_id] in objects:
                logical[physical_id] = main[physical_id]
            else:
                unresolved.append((physical_id, kind, node, entry))
        # Creation correspondence is scoped to the actual producing operation.
        # Multiple generated layers follow that operation's creation ordinal,
        # never a container's appended-child position or a display label.
        new_objects = [obj for obj in state.objects if obj.source_ref and obj.source_ref.startswith(f"step:{node_id}:")]
        by_kind = defaultdict(list)
        for obj in new_objects:
            by_kind["body" if obj.kind == "body" else obj.role].append(obj)
        pending = defaultdict(list)
        for physical_id, kind, node, entry in unresolved:
            created = entry.get("createdBy") or {}
            if created.get("stepRefId") == node_id:
                pending[kind].append((physical_id, node, created))
        # Repeated physical instances can share one logical parent/cohort.
        # Bind a newly created child by that owner before ordinal fallback;
        # batch operations must not mix distinct target cohorts.
        owners = {str(child["id"]): parent_id
                  for parent_id, parent_kind, parent in _physical_nodes(snapshot.geometry_structure)
                  if parent_kind == "container"
                  for collection in ("bodies", "vias", "circuits", "bumps", "children")
                  for child in parent.get(collection, ())}
        for kind, nodes in pending.items():
            targets = by_kind.get(kind, ())
            remaining = []
            for physical_id, node, created in nodes:
                owner = logical.get(owners.get(physical_id))
                owned_targets = [target for target in targets if owner is not None and target.parent_id == owner]
                if len(owned_targets) == 1:
                    logical[physical_id] = owned_targets[0].id
                else:
                    remaining.append((physical_id, node, created))
            bound_targets = set(logical.values())
            targets = [target for target in targets if target.id not in bound_targets]
            ordered = sorted(remaining, key=lambda value: (value[2].get("ordinal", 0), value[0]))
            if len(targets) == 1:
                logical.update((physical_id, targets[0].id) for physical_id, _, _ in ordered)
            elif len(targets) == len(ordered):
                logical.update((physical_id, target.id) for (physical_id, _, _), target in zip(ordered, targets))
        logical_by_output[node_id] = logical
        display[node_id] = _display_bindings(state, logical, snapshot.geometry_structure, node_id)
    return display
