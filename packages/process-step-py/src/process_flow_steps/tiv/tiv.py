from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    thk = context.require_positive_number("thk", "tiv.thk")
    material = context.require_string("material", "tiv.material")
    density = context.require_density("density", "tiv.density")
    state.add_via_above_cursor(
        material=material,
        density=density,
        thickness=thk,
        direction="+z",
    )
    return state
