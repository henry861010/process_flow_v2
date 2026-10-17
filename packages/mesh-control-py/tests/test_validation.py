import copy
import unittest

from process_flow_mesh_control import validate_mesh_control
from process_flow_mesh_control.controls import build_mesh_control


def control(method="Z_SECTION_AVG", mode="reference"):
    location = {"anchor": "z_min", "offset": 0} if mode == "reference" else 100
    result = {"method": method, "coordinateMode": mode, "label": "Focus"}
    if mode == "reference":
        result["reference"] = {"kind": "root"}
    if method == "Z_POINT":
        result["z"] = location
    else:
        result.update(elementSize=5, startZ=location, endZ={"anchor": "z_max", "offset": 0} if mode == "reference" else 200)
    return result


class UniformContractTests(unittest.TestCase):
    def test_all_z_methods_both_modes_and_no_input_mutation(self):
        controls = [control(method, mode) for method in ("Z_SECTION_AVG", "Z_SECTION_TOP", "Z_SECTION_BOT", "Z_SECTION_CENTER", "Z_POINT") for mode in ("reference", "absolute")]
        document = build_mesh_control(controls)
        before = copy.deepcopy(document)
        validate_mesh_control(document)
        self.assertEqual(document, before)

    def test_rejects_legacy_mixed_and_incompatible_coordinate_fields(self):
        mutations = (
            lambda c: c.pop("coordinateMode"),
            lambda c: c.update(coordinateMode="relative"),
            lambda c: c.update(startZ=100),
            lambda c: c["startZ"].update(mode="relative"),
            lambda c: c.update(endZ={"mode": "absolute", "value": 200}),
            lambda c: c.pop("reference"),
            lambda c: c.update(elementSize=0),
            lambda c: c.update(method="UNKNOWN"),
            lambda c: c.update(method="REGION_SIZE"),
            lambda c: c.update(label=" "),
            lambda c: c["startZ"].update(anchor="x_min"),
            lambda c: c["reference"].update(key="not-allowed"),
        )
        for mutate in mutations:
            entry = control()
            mutate(entry)
            with self.subTest(entry=entry), self.assertRaisesRegex(ValueError, "Control 1"):
                validate_mesh_control(build_mesh_control([entry]))
        for value in (True, "100", float("inf"), {"value": 100}, {"anchor": "z_min", "offset": 0}):
            entry = control(mode="absolute")
            entry["startZ"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_mesh_control(build_mesh_control([entry]))
        entry = control(mode="absolute")
        entry["reference"] = {"kind": "root"}
        with self.assertRaisesRegex(ValueError, "not allowed"):
            validate_mesh_control(build_mesh_control([entry]))

    def test_point_rejects_size_and_envelope_is_strict(self):
        entry = control("Z_POINT")
        entry["elementSize"] = 5
        with self.assertRaisesRegex(ValueError, "elementSize"):
            validate_mesh_control(build_mesh_control([entry]))
        for field, value in (("schemaVersion", "2"), ("unitSystem", "mm"), ("mesher", "unknown"), ("globalElementSize", False), ("symmetry", "quarter"), ("controls", {}), ("extra", True)):
            doc = build_mesh_control([])
            doc[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_mesh_control(doc)
