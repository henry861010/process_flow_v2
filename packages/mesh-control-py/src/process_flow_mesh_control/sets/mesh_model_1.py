from __future__ import annotations

from process_flow_kernel import ProcessGeometryState

from ..contracts import MeshControlSetResult


class MeshModel1Set:
    def definition(self) -> dict:
        return {
            "id": "meshModel1",
            "version": "1",
            "label": "meshModel1",
            "description": "Empty mesh control set for meshModel1.",
        }

    def build(self, state: ProcessGeometryState) -> MeshControlSetResult:
        return MeshControlSetResult(
            mesh_control={
                "schemaVersion": "1.0.0",
                "unitSystem": "um",
                "mesher": "process_flow_2_5d",
                "globalElementSize": 500,
                "symmetry": "full",
                "controls": [],
            },
            details=[],
        )
