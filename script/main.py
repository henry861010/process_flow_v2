import sys
import json
sys.path.append("/Users/henry/Desktop/code/process_flow_v2/packages/mesher-py/src/translater/")
from translater_standard_v1 import Translater
sys.path.append("/Users/henry/Desktop/code/process_flow_v2/packages/mesher-py/src/mesher/")
from dragger_v2 import Dragger
from checkerboard import checkerboard_box
from vision import Vision

# ---------------------------------------

body3 = {
  "geometry": {
    "type": "BoxGeometry",
    "bottom_left": [17, 17, -10],
    "top_right": [20, 20, -10],
    "thk": 100
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
    "top_right": [40, 40, 0],
    "thk": 40
    },
  "material": "EMPTY"
}

root = {
    "bodies": [body0],
    "vias": [],
    "circuits": [],
    "bumps": [],
    "children": [child]
}

# ---------------------------------------

translater = Translater()
container = root

base_face, faces = translater.get_2D_pattern(container)
x_list = [base_face["dim"][0], base_face["dim"][2]]
y_list = [base_face["dim"][1], base_face["dim"][3]]
for face in faces:
    x_list.append(face["dim"][0])
    x_list.append(face["dim"][2])
    y_list.append(face["dim"][1])
    y_list.append(face["dim"][3])
nodes, elements = checkerboard_box(3, x_list, y_list)

layer_infos = translater.get_3D_pattern(container)

dragger = Dragger()
dragger.set_2D(nodes, elements)
dragger.build(layer_infos, 5)

vision = Vision()
vision.set(dragger.comps, dragger.elements, dragger.element_comps, dragger.nodes)
vision.show()