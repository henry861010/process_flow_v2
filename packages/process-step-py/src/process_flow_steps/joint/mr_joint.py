from process_flow_kernel import ProcessGeometryState, ProcessStepContext

from .shared_joint import execute_joint


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    return execute_joint(context, name="MR joint")
