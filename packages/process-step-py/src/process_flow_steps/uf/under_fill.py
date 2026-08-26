from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    material = context.require_string("material", "Under Fill.material")
    thk = context.require_positive_number("thk", "Under Fill.thk")
    gap = context.require_non_negative_number("gap", "Under Fill.gap")
    state.apply_under_fill(material=material, thk=thk, gap=gap)
    return state
