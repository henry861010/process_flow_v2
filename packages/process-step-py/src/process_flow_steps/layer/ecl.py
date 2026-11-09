from process_flow_kernel import ProcessGeometryState, ProcessStepContext


# Increment when execution semantics change; execute depends only on its context.
EXECUTION_CACHE_VERSION = 1


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    material = context.require_string("material", "ECL.material")
    thk = context.require_positive_number("thk", "ECL.thk")
    koz = context.require_non_negative_number("koz", "ECL.koz")
    state.deposit_layer(material=material, thickness=thk, xy_inset=koz)
    return state
