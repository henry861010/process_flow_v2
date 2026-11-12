import copy
import unittest

from process_flow_kernel import (
    FlowCompiler,
    normalize_parameter_values_for_storage,
    validate_parameter_default_values,
)


def parameter(parameter_id, value_type, *, required=False, **fields):
    return {"id": parameter_id, "valueType": value_type, "required": required, **fields}


def group(parameter_id, children, *, required=False):
    return parameter(
        parameter_id, "fieldGroupArray", required=required,
        repeatDefinition={"itemParameterDefinitions": children},
    )


class ParameterValueStorageTests(unittest.TestCase):
    def test_only_declared_missing_values_are_omitted_and_input_is_unchanged(self):
        definitions = [parameter("optional", "float"), parameter("required", "integer", required=True)]
        for empty in (None, ""):
            with self.subTest(empty=empty):
                values = {"optional": empty, "required": empty, "unknown": empty}
                original = copy.deepcopy(values)
                self.assertEqual(
                    normalize_parameter_values_for_storage(definitions, values), {"unknown": empty},
                )
                self.assertEqual(values, original)
                with self.assertRaisesRegex(ValueError, "Unknown parameter value: unknown"):
                    FlowCompiler.normalize_step_parameters({"parameterDefinitions": definitions}, values)

    def test_zero_false_and_empty_collections_are_provided_values(self):
        definitions = [
            parameter("count", "integer", required=True),
            parameter("enabled", "boolean", required=True),
            parameter("strings", "string[]", required=True),
            parameter("numbers", "float[]", required=True),
            parameter("placements", "placements", required=True),
            group("groups", [], required=True),
        ]
        values = {
            "count": 0, "enabled": False, "strings": [], "numbers": [],
            "placements": [], "groups": {"items": []},
        }
        self.assertEqual(normalize_parameter_values_for_storage(definitions, values), values)
        self.assertEqual(
            FlowCompiler.normalize_step_parameters({"parameterDefinitions": definitions}, values),
            {**values, "groups": []},
        )

    def test_nested_groups_only_normalize_item_values_and_preserve_structure(self):
        definitions = [group("groups", [
            parameter("amount", "float"),
            group("children", [parameter("amount", "float"), parameter("enabled", "boolean")]),
        ])]
        values = {"groups": {"items": [{
            "itemId": "parent", "index": 0, "label": "", "metadata": None,
            "values": {
                "amount": "", "unknown": None,
                "children": {"items": [{
                    "itemId": "child", "index": 0,
                    "values": {"amount": None, "enabled": False},
                }]},
            },
        }]}}
        original = copy.deepcopy(values)
        normalized = normalize_parameter_values_for_storage(definitions, values)
        parent = normalized["groups"]["items"][0]
        self.assertNotIn("amount", parent["values"])
        self.assertEqual(parent["values"]["children"]["items"][0]["values"], {"enabled": False})
        self.assertIsNone(parent["values"]["unknown"])
        self.assertEqual({key: parent[key] for key in ("itemId", "index", "label", "metadata")}, {
            "itemId": "parent", "index": 0, "label": "", "metadata": None,
        })
        self.assertEqual(values, original)
        self.assertEqual(normalize_parameter_values_for_storage(definitions, normalized), normalized)

    def test_invalid_collection_elements_and_structure_are_not_removed(self):
        definitions = [
            parameter("numbers", "float[]"),
            parameter("placements", "placements"),
            group("groups", [parameter("amount", "float")]),
        ]
        cases = [
            ({"numbers": [0, None, ""]}, "array items cannot be null or empty"),
            ({"placements": [None, ""]}, "must be an object"),
            ({"groups": {"items": [None, ""]}}, "item values must be an object"),
            ({"groups": {"items": [{"itemId": "", "index": None, "values": {}}]}}, "itemId must be unique"),
            ({"groups": {"items": [{"itemId": "a", "values": None}]}}, "item values must be an object"),
            ({"groups": {"items": ""}}, "must contain items"),
        ]
        for values, error in cases:
            with self.subTest(values=values):
                self.assertEqual(normalize_parameter_values_for_storage(definitions, values), values)
                with self.assertRaisesRegex(ValueError, error):
                    FlowCompiler.normalize_step_parameters({"parameterDefinitions": definitions}, values)

    def test_optional_legacy_missing_values_become_python_none(self):
        template = {"parameterDefinitions": [parameter("amount", "float")]}
        for values in ({}, {"amount": None}, {"amount": ""}):
            with self.subTest(values=values):
                self.assertEqual(FlowCompiler.normalize_step_parameters(template, values), {"amount": None})

    def test_required_missing_values_are_only_rejected_when_complete(self):
        template = {"parameterDefinitions": [parameter("amount", "float", required=True)]}
        for values in ({}, {"amount": None}, {"amount": ""}):
            with self.subTest(values=values):
                self.assertEqual(
                    FlowCompiler.normalize_step_parameters(template, values, require_complete=False),
                    {"amount": None},
                )
                with self.assertRaisesRegex(ValueError, "Missing required parameter: amount"):
                    FlowCompiler.normalize_step_parameters(template, values)

    def test_nested_required_and_optional_missing_values_follow_same_contract(self):
        template = {"parameterDefinitions": [group("parents", [group("children", [
            parameter("required", "integer", required=True), parameter("optional", "float"),
        ])])]}
        values = {"parents": {"items": [{"itemId": "parent", "values": {
            "children": {"items": [{"itemId": "child", "index": 0, "values": {
                "required": "", "optional": None,
            }}]},
        }}]}}
        normalized = FlowCompiler.normalize_step_parameters(template, values, require_complete=False)
        self.assertEqual(normalized["parents"][0]["children"][0], {
            "_itemId": "child", "_index": 0, "required": None, "optional": None,
        })
        with self.assertRaisesRegex(ValueError, "Missing required parameter: required"):
            FlowCompiler.normalize_step_parameters(template, values)
        values["parents"]["items"][0]["values"]["children"]["items"][0]["values"]["required"] = 0
        complete = FlowCompiler.normalize_step_parameters(template, values)
        self.assertEqual(complete["parents"][0]["children"][0]["required"], 0)
        self.assertIsNone(complete["parents"][0]["children"][0]["optional"])

    def test_nonempty_invalid_values_still_report_type_range_and_option_errors(self):
        cases = [
            (parameter("value", "float"), "12", "must be a number"),
            (parameter("value", "float", validation={"min": 1}), 0, "must be at least 1"),
            (parameter("value", "float"), False, "must be a number"),
            (parameter("value", "string", validation={"regex": "allowed"}), " ", "required pattern"),
            (parameter("value", "string", optionSource={"options": [{"value": "allowed"}]}),
             "other", "outside optionSource"),
        ]
        for definition, value, error in cases:
            with self.subTest(value=value, definition=definition):
                with self.assertRaisesRegex(ValueError, error):
                    FlowCompiler.normalize_step_parameters(
                        {"parameterDefinitions": [definition]}, {"value": value}, require_complete=False,
                    )

    def test_default_values_are_not_treated_as_legacy_recipe_missing_values(self):
        for empty in (None, ""):
            with self.subTest(empty=empty):
                with self.assertRaisesRegex(ValueError, "defaultValue cannot be null or an empty string"):
                    validate_parameter_default_values({"parameterDefinitions": [
                        parameter("amount", "float", defaultValue=empty),
                    ]})
                with self.assertRaisesRegex(ValueError, "must be a number"):
                    validate_parameter_default_values({"parameterDefinitions": [
                        {**group("groups", [parameter("amount", "float")]), "defaultValue": {
                            "items": [{"itemId": "a", "values": {"amount": empty}}],
                        }},
                    ]})


if __name__ == "__main__":
    unittest.main()
