"""Geometry-independent examples for the 3D_REGION authoring workflow."""
from ..contracts import MeshControlSetNotApplicable, MeshControlSetResult
from ..controls import build_mesh_control
from ..regions import append_region_control


class MeshControl3dTestSet:
    def definition(self):
        return {"id": "meshControl3dTest", "version": "1.0.0", "label": "3D region test",
                "description": "Reference Box and Absolute Polygon region controls at 5 um (requires 3D_REGION mesher support)."}

    def build(self, state):
        root = state.bounds()
        if any(root.get(f"{a}Min") is None or root.get(f"{a}Max") is None or root[f"{a}Max"] <= root[f"{a}Min"] for a in "xyz"):
            raise MeshControlSetNotApplicable("3D region test requires geometry with non-empty XYZ bounds and valid volume.")
        controls, details = [], []
        append_region_control(controls, details, state, label="Reference root Box", element_size=5, coordinate_mode="reference",
                              reference={"kind": "root"}, region={"type": "box", **{
                                  bound: {a: {"anchor": f"{a}_{bound}", "offset": 0} for a in "xyz"}
                                  for bound in ("min", "max")}})
        append_region_control(controls, details, state, label="Absolute root triangle", element_size=5, coordinate_mode="absolute",
                              region={"type": "polygon", "loops": [[
                                  {"x": root["xMin"], "y": root["yMin"]},
                                  {"x": root["xMax"], "y": root["yMin"]},
                                  {"x": root["xMin"], "y": root["yMax"]},
                              ]], "startZ": root["zMin"], "endZ": root["zMax"]})
        return MeshControlSetResult(build_mesh_control(controls, global_element_size=500), details)
