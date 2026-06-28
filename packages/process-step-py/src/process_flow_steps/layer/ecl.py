from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    material = context.require_string("material", "ECL.material")
    thk = context.require_positive_number("thk", "ECL.thk")
    koz = context.require_non_negative_number("koz", "ECL.koz")
    state.deposit_layer(material=material, thickness=thk, xy_inset=koz)
    return state
