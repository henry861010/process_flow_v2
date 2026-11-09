from process_flow_kernel import ProcessGeometryState, ProcessStepContext

from .shared_joint import execute_joint


# Increment when execution semantics change; execute depends only on its context.
EXECUTION_CACHE_VERSION = 1


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    return execute_joint(context, name="MR joint")
