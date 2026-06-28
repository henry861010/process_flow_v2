from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    state.flip_around_z(z=0, normalize_z_min_to_zero=True, update_cursor=False)
    state.set_cursor_z(state.root_body_z_max())
    return state
