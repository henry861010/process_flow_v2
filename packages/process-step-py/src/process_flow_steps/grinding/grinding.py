from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    thk = context.require_positive_number("thk", "Grinding.thk")
    state.grind_to(z=state.geometry_z_max() - thk)
    return state
