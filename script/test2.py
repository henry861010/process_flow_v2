import sys
import json
sys.path.append("/Users/henry/Desktop/code/process_flow_v2/packages/mesher-py/src/translater/")
from translater_standard_v1 import Translater
sys.path.append("/Users/henry/Desktop/code/process_flow_v2/packages/mesher-py/src/mesher/")
from dragger import Dragger
from checkerboard import checkerboard_box
from vision import Vision


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
nodes, elements = checkerboard_box(5, x_list, y_list)

layer_infos = translater.get_3D_pattern(container)
#print(json.dumps(layer_infos, indent=4))

dragger = Dragger()
dragger.set_2D(nodes, elements)
dragger.build(layer_infos, 5)

vision = Vision()
vision.set(dragger.comps, dragger.elements, dragger.element_comps, dragger.nodes)
vision.show()