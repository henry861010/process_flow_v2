from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from time import perf_counter

from .context import ProcessStepContext
from .execution_plan import ExecutionPlan, PlannedStep
from .execution_result import GeometryKernelExecutionResult
from .geometry_artifact import GeometryArtifact
from .material_instances import prepare_step_material_instances
from .options import ExecuteOptions
from ..domain.process_geometry_state import ProcessGeometryState
from ..domain.provenance import qualify_provenance_snapshot
from .step_cache import (KERNEL_CACHE_VERSION, StepExecutionRecord, StepExecutionCache,
                         artifact_fingerprint, content_fingerprint)
from ..infrastructure.module_resolver import ProcessStepModuleResolver
from ..serialization.geometry_hydration import (
    geometry_structure_to_process_geometry_state,
)


class GeometryKernel:
    def __init__(self, *, module_resolver=None, step_cache: StepExecutionCache | None = None):
        self._module_resolver = module_resolver or ProcessStepModuleResolver()
        self._step_cache = step_cache

    def execute(self, execution_plan: ExecutionPlan,
                options: ExecuteOptions | Mapping[str, Any] | None = None, *,
                cache_generation: int | None = None) -> GeometryKernelExecutionResult:
        if not isinstance(execution_plan, ExecutionPlan):
            raise TypeError("GeometryKernel.execute requires an ExecutionPlan")
        started = perf_counter()
        execute_options = ExecuteOptions.from_value(options)
        step_outputs, step_keys, external_keys = {}, {}, {}
        execution_warnings, step_warning_indices = [], {}
        stats = {"executedSteps": 0, "reusedSteps": 0,
                 "identitySeconds": 0.0, "cacheSeconds": 0.0,
                 "inputPreparationSeconds": 0.0, "processExecutionSeconds": 0.0,
                 "snapshotSeconds": 0.0}
        cache = self._step_cache
        generation = cache_generation
        if cache is not None and generation is None:
            generation = cache.generation
        for planned_step in execution_plan.steps:
            identity_started = perf_counter()
            key, module = self._cache_identity(
                planned_step, execution_plan.external_geometries, step_keys, external_keys,
            )
            stats["identitySeconds"] += perf_counter() - identity_started
            compute_seconds = 0.0

            def compute():
                nonlocal compute_seconds
                before = perf_counter()
                record = self._execute_step(planned_step, execution_plan.external_geometries,
                                            step_outputs, module, stats)
                compute_seconds += perf_counter() - before
                return record

            cache_started = perf_counter()
            if key is None:
                record, reused = compute(), False
            else:
                record, reused = cache.get_or_compute(key, compute, generation=generation)
            stats["cacheSeconds"] += perf_counter() - cache_started - compute_seconds
            stats["reusedSteps" if reused else "executedSteps"] += 1
            step_outputs[planned_step.step_ref_id] = record.artifact
            step_keys[planned_step.step_ref_id] = key
            inherited = {index for source in planned_step.geometry_inputs.values()
                         if source.kind == "stepOutput"
                         for index in step_warning_indices.get(source.step_ref_id, ())}
            own = range(len(execution_warnings), len(execution_warnings) + len(record.warnings))
            execution_warnings.extend(record.warnings)
            step_warning_indices[planned_step.step_ref_id] = sorted(inherited) + list(own)

        terminals = list(execution_plan.terminal_step_ref_ids)
        selected = execute_options.output_step_ref_id or (terminals[-1] if terminals else None)
        if not selected:
            raise ValueError("Execution plan does not contain an executable terminal step")
        if selected not in step_outputs:
            raise ValueError(f"No geometry output for step {selected}")
        stats["kernelSeconds"] = perf_counter() - started
        return GeometryKernelExecutionResult(
            step_outputs=step_outputs, selected_step_ref_id=selected, terminal_step_ref_ids=terminals,
            execution_warnings=execution_warnings,
            step_execution_warnings={step: [execution_warnings[i] for i in indices]
                                     for step, indices in step_warning_indices.items()},
            statistics=stats,
        )

    def _cache_identity(self, step, external_geometries, step_keys, external_keys):
        resolver = self._module_resolver
        # Custom importers/resolvers cannot promise stable module identity.
        if (self._step_cache is None or type(resolver) is not ProcessStepModuleResolver
                or not resolver.supports_execution_cache):
            return None, None
        try:
            module = resolver.resolve(step.step_template)
        except ValueError:
            # Preserve input/material validation precedence on resolution errors.
            # Normal execution resolves again at its original boundary.
            return None, None
        version = getattr(module, "EXECUTION_CACHE_VERSION", None)
        if type(version) is not int or version < 1:
            return None, module

        inputs = []
        for port, source in step.geometry_inputs.items():
            if source.kind == "external":
                artifact = external_geometries.get(source.flow_input_id)
                if artifact is None:
                    return None, module
                if source.flow_input_id not in external_keys:
                    external_keys[source.flow_input_id] = artifact_fingerprint(artifact)
                dependency = external_keys[source.flow_input_id]
            else:
                dependency = step_keys.get(source.step_ref_id)
            if dependency is None:
                return None, module
            inputs.append((port, source.kind, source.flow_input_id, source.step_ref_id,
                           source.output_port_id, dependency))
        key = content_fingerprint({
            "kernelVersion": KERNEL_CACHE_VERSION,
            "moduleVersion": version,
            "module": resolver.module_specifier(step.step_template),
            "stepId": step.step_ref_id,
            "label": step.step_label,
            "template": step.step_template,
            "raw": step.raw_parameter_values,
            "values": step.parameter_values,
            "output": step.output_port_id,
            "inputs": inputs,
        })
        return key, module

    def _execute_step(self, planned_step, external_geometries, step_outputs, process_module, stats):
        started = perf_counter()
        runtime_geometry_artifacts, geometry_input_sources = _resolve_geometry_inputs(
            planned_step,
            external_geometries,
            step_outputs,
        )
        material_preparation = prepare_step_material_instances(
            geometry_inputs={
                port_id: artifact.structure
                for port_id, artifact in runtime_geometry_artifacts.items()
            },
            geometry_input_sources=geometry_input_sources,
            step_template=planned_step.step_template,
            values=planned_step.parameter_values,
        )
        runtime_geometry_artifacts = {
            port_id: artifact if port_id not in material_preparation.geometry_node_remaps
            else artifact._with_material_structure(material_preparation.geometry_inputs[port_id],
                                        node_id_remap=material_preparation.geometry_node_remaps[port_id])
            for port_id, artifact in runtime_geometry_artifacts.items()
        }
        values = material_preparation.values
        input_artifact = _main_or_first_geometry(runtime_geometry_artifacts)
        state = (
            _geometry_input_to_process_geometry_state(input_artifact)
            if input_artifact is not None
            else ProcessGeometryState.create()
        )
        state.begin_provenance_step(planned_step.step_ref_id, planned_step.step_template.get("program", ""))
        serialized_geometry_inputs = _serialize_geometry_input_map(
            runtime_geometry_artifacts
        )
        process_module = process_module or self._module_resolver.resolve(planned_step.step_template)

        def resolve_geometry(port_id):
            artifact = runtime_geometry_artifacts.get(port_id)
            return (
                None
                if artifact is None
                else _geometry_input_to_process_geometry_state(artifact)
            )

        def resolve_geometry_artifact(port_id):
            return runtime_geometry_artifacts.get(port_id)

        step_ref = {
            "stepRefId": planned_step.step_ref_id,
            "stepLabel": planned_step.step_label,
            "processStepTemplateId": planned_step.step_template.get("id"),
        }
        step_configuration = {
            "parameterValues": dict(planned_step.raw_parameter_values),
        }
        local_warnings = []
        context = ProcessStepContext(
            state=state,
            values=values,
            raw_parameter_values=planned_step.raw_parameter_values,
            step_ref=step_ref,
            step_template=planned_step.step_template,
            step_configuration=step_configuration,
            geometry_inputs=serialized_geometry_inputs,
            input_geometry=_main_or_first_geometry(serialized_geometry_inputs),
            geometry_resolver=resolve_geometry,
            geometry_artifact_resolver=resolve_geometry_artifact,
            warning_collector=local_warnings.append,
        )

        stats["inputPreparationSeconds"] += perf_counter() - started
        started = perf_counter()
        output = process_module.execute(context)
        stats["processExecutionSeconds"] += perf_counter() - started
        started = perf_counter()
        output_state = _normalize_step_output_state(output, state)
        output_state.begin_provenance_step(planned_step.step_ref_id, planned_step.step_template.get("program", ""))
        # Raw-structure step implementations may return a new state. Retain
        # known origins by ID and attribute new nodes to this execution.
        if not isinstance(output, (ProcessGeometryState, GeometryArtifact)) and output is not None:
            output_state.set_provenance(state.provenance())
        record = StepExecutionRecord(GeometryArtifact.from_state(output_state, source=input_artifact),
                                     tuple(local_warnings))
        stats["snapshotSeconds"] += perf_counter() - started
        return record


def _resolve_geometry_inputs(
    planned_step: PlannedStep,
    external_geometries,
    step_outputs,
):
    geometry_inputs = {}
    geometry_input_sources = {}
    for port_id, source in planned_step.geometry_inputs.items():
        geometry_input_sources[port_id] = source.kind
        if source.kind == "external":
            geometry = external_geometries.get(source.flow_input_id)
            if geometry is None:
                raise ValueError(
                    f"Step {planned_step.step_ref_id}.{port_id} depends on missing external geometry {source.flow_input_id}"
                )
            geometry_inputs[port_id] = geometry.with_provenance(qualify_provenance_snapshot(
                geometry.structure, geometry.provenance, kind="flowInput",
                owner_id=source.flow_input_id, input_port_id=port_id,
            ))
            continue
        geometry = step_outputs.get(source.step_ref_id)
        if geometry is None:
            raise ValueError(
                f"Step {planned_step.step_ref_id}.{port_id} depends on missing output {source.step_ref_id}"
            )
        geometry_inputs[port_id] = geometry.with_provenance(qualify_provenance_snapshot(
            geometry.structure, geometry.provenance, kind="stepOutput",
            owner_id=source.step_ref_id, output_port_id=source.output_port_id,
            input_port_id=port_id,
        ))
    return geometry_inputs, geometry_input_sources


def _first_map_value(map_):
    for value in map_.values():
        return value
    return None


def _main_or_first_geometry(map_):
    return map_.get("main_geometry") or _first_map_value(map_)


def _normalize_step_output_state(output, fallback_state):
    # This state was already detached from input artifacts before execution.
    # Keep the defensive copy for independently returned states or artifacts.
    if output is None or output is fallback_state:
        return fallback_state
    return _geometry_input_to_process_geometry_state(output)


def _geometry_input_to_process_geometry_state(value):
    if isinstance(value, GeometryArtifact):
        return value.fork_state()
    if isinstance(value, ProcessGeometryState):
        return value.clone()
    if hasattr(value, "to_geometry_structure") and callable(value.to_geometry_structure):
        return geometry_structure_to_process_geometry_state(value.to_geometry_structure())
    return geometry_structure_to_process_geometry_state(value)


def _serialize_geometry_input_map(geometry_inputs):
    return {
        port_id: artifact.geometry()
        for port_id, artifact in geometry_inputs.items()
    }
