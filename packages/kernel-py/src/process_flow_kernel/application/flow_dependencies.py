from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .flow_validation import FlowGraphAnalysis


@dataclass(frozen=True, slots=True)
class FlowDependencies:
    step_ref_ids: frozenset[str]
    incoming_edges_by_port: Mapping[tuple[str, str], Mapping[str, Any]]
    flow_input_ids: frozenset[str]


def analyze_flow_dependencies(
    analysis: FlowGraphAnalysis,
    configuration: Mapping[str, Any],
    root_step_ref_ids: set[str] | None = None,
) -> FlowDependencies:
    """Trace demand without changing or relaxing the validated template topology."""
    pending = list(
        analysis.terminal_step_ref_ids
        if root_step_ref_ids is None
        else root_step_ref_ids
    )
    included: set[str] = set()
    edges = {}
    flow_inputs: set[str] = set()
    configurations = configuration.get("stepConfigurations", {})
    while pending:
        step_ref_id = pending.pop()
        if step_ref_id in included:
            continue
        if step_ref_id not in analysis.step_refs_by_id:
            raise ValueError(f"Preview stepRefId not found: {step_ref_id}")
        included.add(step_ref_id)
        template = analysis.step_templates_by_ref_id[step_ref_id]
        placements = configurations.get(step_ref_id, {}).get("parameterValues", {}).get(
            "placements"
        )
        zero_placements = (
            template.get("program") == "pnp/pnp"
            and isinstance(placements, list)
            and not placements
        )
        for port in template.get("inputPorts", []):
            port_id = port["portId"]
            if zero_placements and port_id == "die_geometry":
                continue
            key = (step_ref_id, port_id)
            edge = analysis.incoming_edges_by_port.get(key)
            if edge is None:
                continue
            edges[key] = edge
            source = edge["source"]
            if source["kind"] == "flowInput":
                flow_inputs.add(source["flowInputId"])
            else:
                pending.append(source["stepRefId"])
    return FlowDependencies(frozenset(included), edges, frozenset(flow_inputs))
