from process_flow_kernel import ProcessGeometryState, ProcessStepContext


# Increment when execution semantics change; execute depends only on its context.
EXECUTION_CACHE_VERSION = 1


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    context.state.coat_targets(
        target_key="cow",
        material=context.require_string("material", "TIM1.material"),
        thickness=context.require_positive_number("thickness", "TIM1.thickness"),
        key="tim",
    )
    return context.state
