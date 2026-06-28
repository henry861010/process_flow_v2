from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    state.saw_to_box(
        bottom_left_x=context.require_finite_number("bottomLeftX", "saw.bottomLeftX"),
        bottom_left_y=context.require_finite_number("bottomLeftY", "saw.bottomLeftY"),
        top_right_x=context.require_finite_number("topRightX", "saw.topRightX"),
        top_right_y=context.require_finite_number("topRightY", "saw.topRightY"),
    )
    return state
