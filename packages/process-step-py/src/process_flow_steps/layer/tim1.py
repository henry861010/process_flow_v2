from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    context.state.coat_targets(
        target_key="cow",
        material=context.require_string("material", "TIM1.material"),
        thickness=context.require_positive_number("thickness", "TIM1.thickness"),
        key="tim",
    )
    return context.state
