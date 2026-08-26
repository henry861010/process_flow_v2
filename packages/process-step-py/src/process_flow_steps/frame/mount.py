from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    frame = context.require_geometry("frame_geometry")
    state.mount_frame_geometry(frame)
    return state
