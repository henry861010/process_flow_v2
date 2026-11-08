from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    context.state.coat_targets(
        target_key="lid",
        material=context.require_string("material", "TIM2.material"),
        thickness=context.require_positive_number("thickness", "TIM2.thickness"),
        key="tim",
    )
    return context.state
