from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    carrier = context.require_geometry("carrier_geometry")
    state.bond_carrier_geometry(carrier)
    return state
