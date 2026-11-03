from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute_joint(context: ProcessStepContext, *, name: str) -> ProcessGeometryState:
    height = context.require_positive_number("bump_joined_height", f"{name}.bump_joined_height")

    def height_preserved(report):
        unit = "µm" if report["unit"] == "um" else report["unit"]
        materials = ", ".join(report["supportMaterials"])
        context.warn(
            "joint_soh_preserved",
            f"{name}: requested SOH is {report['requestedSoh']:g} {unit}; "
            f"actual SOH remains {report['actualSoh']:g} {unit} for component {report['childId']} "
            f"because existing fill/support material ({materials}) occupies the bonding gap. "
            "The die position is unchanged.",
            details=report,
        )

    context.state.join_bumps(joined_height=height, on_height_preserved=height_preserved)
    return context.state
