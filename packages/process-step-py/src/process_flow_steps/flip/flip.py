from process_flow_kernel import ProcessGeometryState, ProcessStepContext


# Increment when execution semantics change; execute depends only on its context.
EXECUTION_CACHE_VERSION = 1


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    state.flip_around_z(z=0, normalize_z_min_to_zero=True, update_cursor=False)
    state.set_cursor_z(state.root_body_z_max())
    return state
