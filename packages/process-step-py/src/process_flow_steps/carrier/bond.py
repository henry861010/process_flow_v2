from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    carrier = context.require_geometry("carrier_geometry")
    daf_material = context.require_string("material", "Carrier Bond.DAF material")
    daf_thk = context.require_positive_number("thk", "Carrier Bond.DAF thk")

    state.deposit_layer(
        material=daf_material,
        thickness=daf_thk,
        z=state.geometry_z_max(),
    )
    state.bond_carrier_geometry(carrier)
    return state
