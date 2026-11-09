from process_flow_kernel import ProcessGeometryState, ProcessStepContext


# Increment when execution semantics change; execute depends only on its context.
EXECUTION_CACHE_VERSION = 1


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    material = context.require_string("material", "DAF.material")
    thk = context.require_positive_number("thk", "DAF.thk")

    state.deposit_layer(
        material=material,
        thickness=thk,
        z=state.geometry_z_max(),
        key="daf",
    )
    return state
