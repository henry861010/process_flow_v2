from __future__ import annotations

from process_flow_kernel import ProcessGeometryState

from ..contracts import MeshControlSetResult

METAL_TIM_MATERIAL = ["Mat_metaltime1", "Mat_metaltime2", "Mat_metaltime3"]

class MeshModel2Set:
    def definition(self) -> dict:
        return {
            "id": "meshModel2",
            "version": "1",
            "label": "meshModel2",
            "description": "Empty mesh control set for meshModel2.",
        }

    def build(self, state: ProcessGeometryState) -> MeshControlSetResult:
        return MeshControlSetResult(
            mesh_control={
                "schemaVersion": "1.0.0",
                "unitSystem": "um",
                "mesher": "process_flow_2_5d",
                "globalElementSize": 1000,
                "symmetry": "full",
                "controls": [],
            },
            details=[],
        )
