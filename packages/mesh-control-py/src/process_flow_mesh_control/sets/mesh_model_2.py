"""Mesh model 2: independently configurable composition of shared rules."""

from __future__ import annotations

from process_flow_kernel import ProcessGeometryState

from ..contracts import MeshControlSetResult
from ..controls import append_full_feature_control, build_mesh_control
from ..geometry import select_upper_right, subtree_nodes
from ..rules import (
    append_adhesive_controls,
    append_bottom_carrier_points,
    append_hbm_uf_controls,
    append_soc_uf_controls,
    append_tim_controls,
)

# Keep settings local so changing this model does not change the other sets.
GLOBAL_ELEMENT_SIZE = 1000
BUMP_ELEMENT_SIZE = 10
CARRIER_OFFSET = 10
TIM_SETTINGS = {"metal_element_size": 250, "non_metal_element_size": 50}
ADHESIVE_SETTINGS = {"metal_tim_element_size": 50, "non_metal_tim_element_size": 20}
HBM_UF_SETTINGS = {
    "base_element_size": 10,
    "base_to_core_element_size": 5,
    "core_element_size": 20,
    "core_to_core_element_size": 5,
    "top_element_size": 10,
}
SOC_UF_SETTINGS = {
    "surface_thickness": 50,
    "transition_thickness": 60,
    "surface_element_size": 5,
    "transition_element_size": 60,
    "middle_element_size": 120,
}


class MeshModel2Set:
    """Compose model 2's controls without modifying the input geometry."""

    def definition(self) -> dict:
        """Return the public registry metadata for meshModel2."""
        return {
            "id": "meshModel2",
            "version": "1",
            "label": "meshModel2",
            "description": "Geometry-aware Tim, adhesive, uBump, UF, and bottom carrier controls.",
        }

    def build(self, state: ProcessGeometryState) -> MeshControlSetResult:
        """Build controls/details in um using rightmost, then topmost targets.

        Args:
            state: Input state; geometry and process state are not modified.

        Returns:
            Canonical mesh controls and resolved human-readable details.

        Raises:
            MeshControlSetNotApplicable: Without HBM, selected soc.si is too thin.
        """
        nodes = state.find_geometry()
        containers = [node for node in nodes if node["kind"] == "container"]
        bodies = [node for node in nodes if node["kind"] == "body"]
        containers_by_id = {node["id"]: node for node in containers}
        controls: list[dict] = []
        details: list[dict] = []

        has_metal_tim = append_tim_controls(controls, details, bodies, **TIM_SETTINGS)
        append_adhesive_controls(
            controls, details, bodies, has_metal_tim=has_metal_tim, **ADHESIVE_SETTINGS,
        )

        hbm = select_upper_right(node for node in containers if node["key"] == "hbm")
        soc = select_upper_right(node for node in containers if node["key"] == "soc")
        soc_si = select_upper_right(body for body in bodies if body["key"] == "soc.si")

        bump = select_upper_right(subtree_nodes(nodes, containers_by_id, hbm, kind="bump"))
        if bump is None:
            bump = select_upper_right(subtree_nodes(nodes, containers_by_id, soc, kind="bump"))
        if bump is not None:
            append_full_feature_control(
                controls, details, bump, label="TD_uBump", element_size=BUMP_ELEMENT_SIZE,
            )

        if hbm is not None:
            append_hbm_uf_controls(
                controls, details, nodes, containers_by_id, hbm, **HBM_UF_SETTINGS,
            )
        elif soc_si is not None:
            append_soc_uf_controls(
                controls, details, soc_si, set_id="meshModel2", **SOC_UF_SETTINGS,
            )

        append_bottom_carrier_points(controls, details, nodes, offset=CARRIER_OFFSET)
        return MeshControlSetResult(
            mesh_control=build_mesh_control(controls, global_element_size=GLOBAL_ELEMENT_SIZE),
            details=details,
        )
