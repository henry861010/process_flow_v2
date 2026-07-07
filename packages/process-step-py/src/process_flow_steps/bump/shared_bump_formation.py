from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute_bump_formation(context: ProcessStepContext, *, name: str) -> ProcessGeometryState:
    state = context.state
    material = context.require_string("material", f"{name}.material")
    thk = context.require_positive_number("thk", f"{name}.thk")
    density = context.require_density("density", f"{name}.density")
    koz = context.require_non_negative_number("koz", f"{name}.koz")
    state.add_bump_above_cursor(
        material=material,
        density=density,
        thickness=thk,
        direction="+z",
        koz=koz,
    )
    return state
