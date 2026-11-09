from process_flow_kernel import ProcessGeometryState, ProcessStepContext


# Increment when execution semantics change; execute depends only on its context.
EXECUTION_CACHE_VERSION = 1


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    thk = context.require_positive_number("thk", "tmv.thk")
    material = context.require_string("material", "tmv.material")
    density = context.require_density("density", "tmv.density")
    state.add_via_above_cursor(
        material=material,
        density=density,
        thickness=thk,
        direction="+z",
    )
    return state
