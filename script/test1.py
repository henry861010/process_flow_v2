from process_flow_mesher import build_mesh_from_structure
from process_flow_mesher.visualization import MeshViewer

# ---------------------------------------

body3 = {
  "geometry": {
    "type": "BoxGeometry",
    "bottom_left": [17, 17, -10],
    "top_right": [20, 20, -10],
    "thk": 60
    },
  "material": "body3"
}

child2 = {
    "bodies": [body3],
    "vias": [],
    "circuits": [],
    "bumps": [],
    "children": []
}

# ---------------------------------------

body1 = {
  "geometry": {
        "type": "BoxGeometry",
        "bottom_left": [10, 10, 10],
        "top_right": [30, 30, 10],
        "thk": 10
    },
  "material": "body1"
}

body2 = {
  "geometry": {
    "type": "BoxGeometry",
    "bottom_left": [15, 15, 20],
    "top_right": [25, 25, 20],
    "thk": 10
    },
  "material": "body2"
}

child = {
    "bodies": [body1, body2],
    "vias": [],
    "circuits": [],
    "bumps": [],
    "children": [child2]
}

# ---------------------------------------

body0 = {
  "geometry": {
    "type": "BoxGeometry",
    "bottom_left": [0, 0, 0],
    "top_right": [20, 40, 0],
    "thk": 40
    },
  "material": "body0"
}

root = {
    "bodies": [body0],
    "vias": [],
    "circuits": [],
    "bumps": [],
    "children": [child]
}

mesh = build_mesh_from_structure({"root": root}, element_size=5)

viewer = MeshViewer(mesh)
viewer.show()
