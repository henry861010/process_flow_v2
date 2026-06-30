import sys
import json
import argparse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MESHER_SRC = REPO_ROOT / "packages" / "mesher-py" / "src"
if str(MESHER_SRC) not in sys.path:
    sys.path.append(str(MESHER_SRC))

from mesher.vision import Vision
from process_flow_mesher import build_mesh_from_structure

parser = argparse.ArgumentParser(description="The geoemtry strcuture viewer")
parser.add_argument("-json", '--json', type=str, help="The path to the input json.")
parser.add_argument("-element_size", '--element_size', type=float, help="element size", default=500)
args = parser.parse_args()

with open(args.json, 'r') as file:
    data = json.load(file)
    structure = data["structure"] if "structure" in data else data

mesh = build_mesh_from_structure(structure, element_size=args.element_size)

vision = Vision()
vision.set(mesh.comps, mesh.elements, mesh.element_comps, mesh.nodes)
vision.show()
