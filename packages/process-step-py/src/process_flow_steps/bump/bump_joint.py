from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    height = context.require_positive_number("bump_joined_height", "Bump Joint.bump_joined_height")
    context.state.join_bumps(joined_height=height)
    return context.state
