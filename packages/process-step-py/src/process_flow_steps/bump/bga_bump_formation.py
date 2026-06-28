from process_flow_kernel import ProcessGeometryState, ProcessStepContext

from process_flow_steps.bump.shared_bump_formation import execute_bump_formation


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    return execute_bump_formation(context, name="BGA Bump")
