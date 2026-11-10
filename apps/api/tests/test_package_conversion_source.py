"""Source mapping validation is independent from kernel execution and storage."""
import copy
import unittest

from pydantic import ValidationError

from process_flow_api.package_conversion_schema import (
    ConversionProfile, ConversionRequest, normalize_source, read_pointer, write_pointer,
)


def field(field_id="mold.thickness", kind="length", **changes):
    data = {"id": field_id, "object": "cow.mold", "property": "thickness",
            "stage": "finished", "path": "/layers/0/thickness", "kind": kind}
    if kind != "material":
        data["unit"] = "um" if kind == "length" else "percent"
    return {**data, **changes}


def profile_data(fields=None, rules=None, **changes):
    fields = fields if fields is not None else [field()]
    rules = rules if rules is not None else [
        {"id": f"rule-{item['id']}", "type": "parameter", "fact": item["id"],
         "role": "cow.finish", "parameter": item["property"],
         "verify": {"kind": "body", "property": {"length": "thickness", "density": "density", "material": "material"}[item["kind"]]}}
        for item in fields]
    return {"id": "package", "version": "1", "fields": fields, "rules": rules, **changes}


class PackageConversionSourceTests(unittest.TestCase):
    def test_normalizes_units_and_preserves_semantics_and_source(self):
        source = {"layers": [{"thickness": 700000, "unit": "nm", "material": " Resin A "}],
                  "c4": {"coverage": .35}, "unrelated": {"original": True}}
        fields = [field(unit=None, unitPath="/layers/0/unit"),
                  field("mold.material", "material", property="material", path="/layers/0/material"),
                  field("c4.density", "density", object="cow.c4", property="density", path="/c4/coverage", unit="fraction")]
        profile = ConversionProfile.model_validate(profile_data(fields=fields, materialMap={"Resin A": "EMC"}))
        original = copy.deepcopy(source)
        facts = normalize_source(source, profile)
        self.assertEqual(source, original)
        self.assertEqual(facts[0], {"id": "mold.thickness", "object": "cow.mold", "property": "thickness",
                                   "stage": "finished", "sourcePath": "/layers/0/thickness", "sourceValue": 700000,
                                   "value": 700., "unit": "um", "unitSourcePath": "/layers/0/unit"})
        self.assertEqual(facts[1]["value"], "EMC")
        self.assertEqual(facts[1]["sourceValue"], " Resin A ")
        self.assertIsNone(facts[1]["unit"])
        self.assertEqual(facts[2]["value"], 35.)
        self.assertEqual(facts[2]["unit"], "percent")

    def test_all_length_units(self):
        for unit, value in [("nm", .002), ("um", 2), ("µm", 2), ("mm", 2000)]:
            with self.subTest(unit=unit):
                profile = ConversionProfile.model_validate(profile_data(fields=[field(path="/value", unit=unit)]))
                self.assertEqual(normalize_source({"value": 2}, profile)[0]["value"], value)

    def test_zero_lengths_and_density_boundaries(self):
        for kind, unit, values in [("length", "um", [0]), ("density", "percent", [0, 100]), ("density", "fraction", [0, 1])]:
            profile = ConversionProfile.model_validate(profile_data(fields=[field(kind=kind, path="/value", unit=unit)]))
            for value in values:
                with self.subTest(kind=kind, unit=unit, value=value):
                    normalize_source({"value": value}, profile)

    def test_numeric_types_ranges_and_finiteness(self):
        for kind, unit, values in [
            ("length", "um", [True, False, "10", None, [], {}, -1, float("nan"), float("inf"), 10**400]),
            ("length", "mm", [1e308]),
            ("density", "percent", [-.1, 100.1]),
            ("density", "fraction", [-.1, 1.01]),
        ]:
            profile = ConversionProfile.model_validate(profile_data(fields=[field(kind=kind, path="/value", unit=unit)]))
            for value in values:
                with self.subTest(kind=kind, value=value):
                    with self.assertRaisesRegex(ValueError, "/value"):
                        normalize_source({"value": value}, profile)

    def test_material_allowlist_and_trimmed_fallback(self):
        profile = ConversionProfile.model_validate(profile_data(fields=[field(kind="material", path="/material")]))
        self.assertEqual(normalize_source({"material": "  Silicon  "}, profile)[0]["value"], "Silicon")
        for invalid in [" ", 15, None, True]:
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "mold.thickness.*?/material"):
                normalize_source({"material": invalid}, profile)
        profile.materialMap = {"known": "EMC"}
        with self.assertRaisesRegex(ValueError, "unknown material"):
            normalize_source({"material": "Silicon"}, profile)

    def test_unit_configuration_and_runtime_unit_errors(self):
        for item in [field(unit=None), field(unitPath="/unit"), field(unit="mil"),
                     field(kind="material", unit="um"), field(kind="material", unitPath="/unit")]:
            with self.subTest(item=item), self.assertRaises(ValidationError):
                ConversionProfile.model_validate(profile_data(fields=[item]))
        profile = ConversionProfile.model_validate(profile_data(fields=[field(unit=None, unitPath="/unit")]))
        for source in [{"layers": [{"thickness": 1}]}, {"layers": [{"thickness": 1}], "unit": "mil"},
                       {"layers": [{"thickness": 1}], "unit": 1}]:
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, "mold.thickness.*?/unit"):
                normalize_source(source, profile)

    def test_pointer_escapes_arrays_and_empty_members(self):
        source = {"a/b": {"~key": [{"": "value"}]}}
        self.assertIs(read_pointer(source, ""), source)
        self.assertEqual(read_pointer(source, "/a~1b/~0key/0/"), "value")
        self.assertEqual(read_pointer({"~1": 1}, "/~01"), 1)
        self.assertEqual(read_pointer({"*": 2}, "/*"), 2)
        for path in ["a", "/~", "/~2", "/a~1b/~0key/00", "/a~1b/~0key/-", "/a~1b/~0key/1", "/missing",
                     "/a~1b/~0key/0//nested", "/a~1b/~0key/" + "9" * 5000]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                read_pointer(source, path)

    def test_pointer_writes_only_existing_targets_with_no_aliasing(self):
        source = {"items": [{"value": {"a": [1]}}]}
        new = {"b": [2]}
        old = write_pointer(source, "/items/0/value", new)
        self.assertEqual(old, {"a": [1]})
        old["a"].append(3)
        new["b"].append(4)
        self.assertEqual(source["items"][0]["value"], {"b": [2]})
        self.assertEqual(write_pointer(source, "/items/0/value/b/0", 5), 2)
        for path in ["", "/missing", "/items/-", "/items/1", "/items/0/new/key"]:
            original = copy.deepcopy(source)
            with self.subTest(path=path), self.assertRaises(ValueError):
                write_pointer(source, path, 0)
            self.assertEqual(source, original)

    def test_profile_rejects_ambiguous_rules_and_unused_facts(self):
        base = profile_data()
        cases = []
        duplicate_fields = copy.deepcopy(base); duplicate_fields["fields"] *= 2; cases.append(duplicate_fields)
        duplicate_rules = copy.deepcopy(base); duplicate_rules["rules"] *= 2; cases.append(duplicate_rules)
        missing_fact = copy.deepcopy(base); missing_fact["rules"][0]["fact"] = "unknown"; cases.append(missing_fact)
        mismatch = copy.deepcopy(base); mismatch["rules"][0]["verify"]["property"] = "density"; cases.append(mismatch)
        unused = copy.deepcopy(base); unused["rules"] = []; cases.append(unused)
        no_verify = copy.deepcopy(base); del no_verify["rules"][0]["verify"]; cases.append(no_verify)
        unknown = copy.deepcopy(base); unknown["rules"][0]["type"] = "expression"; cases.append(unknown)
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValidationError):
                ConversionProfile.model_validate(case)

    def test_rule_variants_and_length_only_molding(self):
        molding = {"id": "finish", "type": "molding_final_thickness", "fact": "mold.thickness",
                   "moldingRole": "cow.deposit", "grindingRole": "cow.finish"}
        profile = ConversionProfile.model_validate(profile_data(rules=[molding]))
        self.assertTrue(profile.rules[0].terminal)
        with self.assertRaisesRegex(ValidationError, "must be a length"):
            ConversionProfile.model_validate(profile_data(fields=[field(kind="material")], rules=[molding]))
        generator = {"id": "input", "type": "generator_parameter", "fact": "mold.thickness",
                     "inputRole": "die", "parameterPath": "/thickness", "verify": {"kind": "body", "property": "thickness"}}
        ConversionProfile.model_validate(profile_data(rules=[generator]))
        for path in ["", "thickness", "/bad~2"]:
            with self.subTest(path=path), self.assertRaises(ValidationError):
                ConversionProfile.model_validate(profile_data(rules=[{**generator, "parameterPath": path}]))

    def test_request_source_revision_and_metadata_validation(self):
        data = {"source": {"layers": [{"thickness": 3}]}, "profile": profile_data(), "bindings": {},
                "baseFlowId": "baseline", "baseRevision": 1,
                "metadata": {"name": "Converted package", "version": "1", "owner": "RD"}}
        request = ConversionRequest.model_validate(data)
        self.assertEqual(request.metadata.description, "")
        self.assertEqual(request.bindings.roles, {})
        for source in [None, "{}", 1, {"unmapped": float("nan")}, {"other": [float("inf")]}, {1: "value"}]:
            with self.subTest(source=source), self.assertRaises(ValidationError):
                ConversionRequest.model_validate({**data, "source": source})
        ConversionRequest.model_validate({**data, "source": []})
        for revision in [0, -1, True, 1.0, "1"]:
            with self.subTest(revision=revision), self.assertRaises(ValidationError):
                ConversionRequest.model_validate({**data, "baseRevision": revision})
        with self.assertRaises(ValidationError):
            ConversionRequest.model_validate({**data, "metadata": {**data["metadata"], "owner": " "}})

    def test_unknown_source_fields_allowed_but_nonfinite_rejected_even_if_unmapped(self):
        profile = ConversionProfile.model_validate(profile_data())
        normalize_source({"layers": [{"thickness": 1}], "ignored": "kept"}, profile)
        with self.assertRaisesRegex(ValueError, "/ignored/a~1b/0"):
            normalize_source({"layers": [{"thickness": 1}], "ignored": {"a/b": [float("nan")]}}, profile)
        with self.assertRaisesRegex(ValueError, "mold.thickness.*?/layers/0/thickness"):
            normalize_source({}, profile)


if __name__ == "__main__":
    unittest.main()
