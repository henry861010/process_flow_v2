from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    material = context.require_string("material", "molding.material")
    thickness = context.require_positive_number("thickness", "molding.thickness")
    state.deposit_layer(material=material, thickness=thickness)
    return state
