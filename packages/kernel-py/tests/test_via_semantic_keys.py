from __future__ import annotations

import copy
import unittest

from process_flow_kernel import (
    BODY_KEYS, VIA_KEYS, BoxGeometry, ProcessGeometryState, Via,
    normalize_geometry_structure, validate_geometry_semantic_keys, validate_via_key,
)


def structure(key_fields):
    return {"schemaVersion": "1.0.0", "unitSystem": "um", "root": {"children": [{"id": "nested", "vias": [{
        "id": "via:lsi", "geometry": BoxGeometry([0, 0, 0], [20, 20, 0], 10).json(),
        "material": "Cu", "density": 50, "direction": "+z", "koz": 0,
        **key_fields,
    }]}]}}


class ViaSemanticKeyTests(unittest.TestCase):
    def test_vocabulary_and_optional_legacy_constructor(self):
        self.assertEqual(VIA_KEYS, {"lsi.fsvia0", "lsi.bsvia0"})
        self.assertTrue({"lsi.si", "lsi.usg", "lsi.fspm0", "lsi.daf", "lsi.bspm0",
                         "lsi.prepm0", "lsi.fow", "lsi.si_carrier"} <= BODY_KEYS)
        via = Via(BoxGeometry([0, 0, 0], [20, 20, 0], 10), 50, "Cu", "+z", 0, "legacy-id")
        self.assertIsNone(via.key())
        self.assertNotIn("key", via.json())
        self.assertEqual(via.json()["id"], "legacy-id")
        self.assertIsNone(validate_via_key(None))

    def test_key_survives_copy_thickness_changes_transforms_and_roundtrip(self):
        for key in VIA_KEYS:
            with self.subTest(key=key):
                payload = structure({"key": key})
                before = copy.deepcopy(payload)
                validate_geometry_semantic_keys(payload)
                normalized = normalize_geometry_structure(payload)
                state = ProcessGeometryState.from_structure(normalized)
                self.assertEqual(state.to_geometry_structure(), normalized)
                self.assertEqual(payload, before)
                self.assertEqual([node["id"] for node in state.find_geometry(kind="via", key=key)], ["via:lsi"])

                via = Via(BoxGeometry([0, 0, 0], [20, 20, 0], 10), 50, "Cu", "+z", 0, "via:lsi", key=key)
                for transformed in (via.copy(), via.copy_with_thk(5)):
                    transformed.move(x=5, z=20)
                    transformed.flip(0)
                    transformed.resize_xy_by(2, 2)
                    transformed.clip_top_to(transformed.z_max() - 1)
                    self.assertEqual(transformed.key(), key)
                    self.assertEqual(transformed.json()["key"], key)
                    self.assertEqual(transformed.json()["id"], "via:lsi")
                self.assertEqual(via.thk(), 10)

    def test_payload_rejects_invalid_or_null_keys_and_preserves_missing_key(self):
        payload = structure({})
        validate_geometry_semantic_keys(payload)
        self.assertNotIn("key", ProcessGeometryState.from_structure(payload).to_geometry_structure()["root"]["children"][0]["vias"][0])
        for invalid in (None, "", " ", "carrier", "lsi.si", "LSI.fsvia0", False, [], {}):
            with self.subTest(key=invalid):
                payload = structure({"key": invalid})
                for validate in (validate_geometry_semantic_keys, normalize_geometry_structure, ProcessGeometryState.from_structure):
                    with self.assertRaises(ValueError):
                        validate(payload)

    def test_circuits_and_bumps_still_reject_keys(self):
        for collection in ("circuits", "bumps"):
            payload = {collection: [{"key": "lsi.fsvia0", "stage": "reflowed"}]}
            for validate in (validate_geometry_semantic_keys, normalize_geometry_structure):
                with self.subTest(collection=collection, validator=validate.__name__):
                    with self.assertRaisesRegex(ValueError, "key is not supported"):
                        validate(payload)

    def test_default_debond_does_not_treat_lsi_keys_as_generic_roles(self):
        state = ProcessGeometryState.from_structure({"bodies": [
            {"id": "base", "geometry": BoxGeometry([0, 0, 0], [20, 20, 0], 10).json(), "material": "Si"},
            {"id": "daf", "key": "lsi.daf", "geometry": BoxGeometry([0, 0, 10], [20, 20, 10], 5).json(), "material": "DAF"},
            {"id": "carrier", "key": "lsi.si_carrier", "geometry": BoxGeometry([0, 0, 15], [20, 20, 15], 10).json(), "material": "Si"},
        ]})
        before = state.to_geometry_structure()
        with self.assertRaisesRegex(ValueError, "expected one carrier body"):
            state.remove_bonded_carrier_stack()
        self.assertEqual(state.to_geometry_structure(), before)
        state.remove_bonded_carrier_stack(carrier_key="lsi.si_carrier", daf_key="lsi.daf")
        self.assertEqual([body["id"] for body in state.to_geometry_structure()["root"]["bodies"]], ["base"])

        before["root"]["bodies"][-1]["key"] = "carrier"
        state = ProcessGeometryState.from_structure(before)
        state.remove_bonded_carrier_stack()
        self.assertEqual([body["id"] for body in state.to_geometry_structure()["root"]["bodies"]], ["base", "daf"])
