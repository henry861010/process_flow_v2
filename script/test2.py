from mesher.process_flow import build_mesh_from_structure
from mesher.mesh3d.visualization import MeshViewer


body0 = {
  "geometry": {
    "type": "BoxGeometry",
    "bottom_left": [0, 0, 0],
    "top_right": [40, 40, 0],
    "thk": 20
    },
  "material": "body0"
}
body1 = {
  "geometry": {
    "type": "BoxGeometry",
    "bottom_left": [0, 0, 20],
    "top_right": [40, 40, 20],
    "thk": 20
    },
  "material": "body1"
}

bump0 = {
  "geometry": {
    "type": "BoxGeometry",
    "bottom_left": [5, 5, 10],
    "top_right": [35, 35,10],
    "thk": 20
    },
  "density": 50,
  "material": "bump0"
}

root = {
    "bodies": [body0, body1],
    "vias": [],
    "circuits": [],
    "bumps": [bump0],
    "children": []
}

mesh = build_mesh_from_structure({"root": root}, element_size=5)

viewer = MeshViewer(mesh)
viewer.show()
