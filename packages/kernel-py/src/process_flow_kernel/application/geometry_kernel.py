from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .context import ProcessStepContext
from .execution_plan import ExecutionPlan, PlannedStep
from .execution_result import GeometryKernelExecutionResult
from .material_instances import prepare_step_material_instances
from .options import ExecuteOptions
from ..domain.process_geometry_state import ProcessGeometryState
from ..infrastructure.module_resolver import ProcessStepModuleResolver
from ..serialization.geometry_hydration import (
    geometry_structure_to_process_geometry_state,
    process_geometry_state_to_geometry_structure,
)


class GeometryKernel:
    def __init__(self, *, module_resolver=None):
        self._module_resolver = module_resolver or ProcessStepModuleResolver()

    def execute(
        self,
        execution_plan: ExecutionPlan,
        options: ExecuteOptions | Mapping[str, Any] | None = None,
    ) -> GeometryKernelExecutionResult:
        if not isinstance(execution_plan, ExecutionPlan):
            raise TypeError("GeometryKernel.execute requires an ExecutionPlan")
        execute_options = ExecuteOptions.from_value(options)
        step_outputs: dict[str, ProcessGeometryState] = {}

        for planned_step in execution_plan.steps:
            runtime_geometry_inputs, geometry_input_sources = _resolve_geometry_inputs(
                planned_step,
                execution_plan.external_geometries,
                step_outputs,
            )
            material_preparation = prepare_step_material_instances(
                geometry_inputs=runtime_geometry_inputs,
                geometry_input_sources=geometry_input_sources,
                step_template=planned_step.step_template,
                values=planned_step.parameter_values,
            )
            runtime_geometry_inputs = material_preparation.geometry_inputs
            values = material_preparation.values
            input_geometry = _main_or_first_geometry(runtime_geometry_inputs)
            state = (
                _geometry_input_to_process_geometry_state(input_geometry)
                if input_geometry is not None
                else ProcessGeometryState.create()
            )
            serialized_geometry_inputs = _serialize_geometry_input_map(runtime_geometry_inputs)
            process_module = self._module_resolver.resolve(planned_step.step_template)

            def resolve_geometry(port_id):
                geometry = runtime_geometry_inputs.get(port_id)
                return None if geometry is None else _geometry_input_to_process_geometry_state(geometry)

            step_ref = {
                "stepRefId": planned_step.step_ref_id,
                "stepLabel": planned_step.step_label,
                "processStepTemplateId": planned_step.step_template.get("id"),
            }
            step_configuration = {
                "parameterValues": dict(planned_step.raw_parameter_values),
            }
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
            )

            output = process_module.execute(context)
            step_outputs[planned_step.step_ref_id] = _normalize_step_output_state(output, state)

        terminal_step_ref_ids = list(execution_plan.terminal_step_ref_ids)
        selected_step_ref_id = execute_options.output_step_ref_id or (
            terminal_step_ref_ids[-1] if terminal_step_ref_ids else None
        )
        if not selected_step_ref_id:
            raise ValueError("Execution plan does not contain an executable terminal step")
        selected_output = step_outputs.get(selected_step_ref_id)
        if selected_output is None:
            raise ValueError(f"No geometry output for step {selected_step_ref_id}")
        return GeometryKernelExecutionResult(
            geometry_structure=process_geometry_state_to_geometry_structure(selected_output),
            step_outputs=_serialize_step_outputs(step_outputs),
            terminal_step_ref_ids=terminal_step_ref_ids,
        )


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
            geometry_inputs[port_id] = geometry
            continue
        geometry = step_outputs.get(source.step_ref_id)
        if geometry is None:
            raise ValueError(
                f"Step {planned_step.step_ref_id}.{port_id} depends on missing output {source.step_ref_id}"
            )
        geometry_inputs[port_id] = geometry
    return geometry_inputs, geometry_input_sources


def _first_map_value(map_):
    for value in map_.values():
        return value
    return None


def _main_or_first_geometry(map_):
    return map_.get("main_geometry") or _first_map_value(map_)


def _normalize_step_output_state(output, fallback_state):
    resolved_output = fallback_state if output is None else output
    return _geometry_input_to_process_geometry_state(resolved_output)


def _geometry_input_to_process_geometry_state(value):
    if isinstance(value, ProcessGeometryState):
        return value.clone()
    if hasattr(value, "to_geometry_structure") and callable(value.to_geometry_structure):
        return geometry_structure_to_process_geometry_state(value.to_geometry_structure())
    return geometry_structure_to_process_geometry_state(value)


def _serialize_step_outputs(step_outputs):
    return {
        step_ref_id: process_geometry_state_to_geometry_structure(output)
        for step_ref_id, output in step_outputs.items()
    }


def _serialize_geometry_input_map(geometry_inputs):
    return {
        port_id: process_geometry_state_to_geometry_structure(input_)
        for port_id, input_ in geometry_inputs.items()
    }
