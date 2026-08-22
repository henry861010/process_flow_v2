import json
import argparse

from process_flow_mesher import build_mesh_from_structure
from process_flow_mesher.visualization import MeshViewer

parser = argparse.ArgumentParser(description="The geoemtry strcuture viewer")
parser.add_argument("-json", '--json', type=str, help="The path to the input json.")
parser.add_argument("-element_size", '--element_size', type=float, help="element size", default=500)
args = parser.parse_args()

with open(args.json, 'r') as file:
    data = json.load(file)
    structure = data["structure"] if "structure" in data else data

mesh = build_mesh_from_structure(structure, element_size=args.element_size)

viewer = MeshViewer(mesh)
viewer.show()
