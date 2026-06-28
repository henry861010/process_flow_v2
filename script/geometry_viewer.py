import sys
import json
import argparse
sys.path.append("/Users/henry/Desktop/code/process_flow_v2/packages/mesher-py/src/translater/")
from translater_standard_v1 import Translater
sys.path.append("/Users/henry/Desktop/code/process_flow_v2/packages/mesher-py/src/mesher/")
from dragger import Dragger
from checkerboard import checkerboard_box
from vision import Vision

parser = argparse.ArgumentParser(description="The geoemtry strcuture viewer")
parser.add_argument("-json", '--json', type=str, help="The path to the input json.")
parser.add_argument("-element_size", '--element_size', type=float, help="element size", default=500)
args = parser.parse_args()

with open(args.json, 'r') as file:
    data = json.load(file)
    container = data["structure"]["root"]

translater = Translater()

base_face, faces = translater.get_2D_pattern(container)
x_list = [base_face["dim"][0], base_face["dim"][2]]
y_list = [base_face["dim"][1], base_face["dim"][3]]
for face in faces:
  # box
  if face["type"] == "BOX":
    x_list.append(face["dim"][0])
    x_list.append(face["dim"][2])
    y_list.append(face["dim"][1])
    y_list.append(face["dim"][3])
  
  # polygon
  elif face["type"] == "POLYGON":
    for poly in face["dim"]:
      for node in poly:
        x_list.append(node[0])
        y_list.append(node[1])
  
nodes, elements = checkerboard_box(args.element_size, x_list, y_list)

layer_infos = translater.get_3D_pattern(container)

dragger = Dragger()
dragger.set_2D(nodes, elements)
dragger.build(layer_infos, args.element_size)

vision = Vision()
vision.set(dragger.comps, dragger.elements, dragger.element_comps, dragger.nodes)
vision.show()