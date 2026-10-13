from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute_joint(context: ProcessStepContext, *, name: str) -> ProcessGeometryState:
    height = context.require_positive_number("bump_joined_height", f"{name}.bump_joined_height")
    context.state.join_bumps(joined_height=height)
    return context.state
