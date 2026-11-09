from process_flow_kernel import ProcessGeometryState, ProcessStepContext


# Increment when execution semantics change; execute depends only on its context.
EXECUTION_CACHE_VERSION = 1


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    material = context.require_string("material", "molding.material")
    thickness = context.require_positive_number("thickness", "molding.thickness")
    state.deposit_layer(material=material, thickness=thickness, key="molding")
    return state
