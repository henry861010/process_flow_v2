from __future__ import annotations

import copy
import unittest

from process_flow_geometry_generators import (
    GeometryGeneratorRegistry,
    register_builtin_generators,
)


def _thickness_paths(parameters, prefix=()):
    for key, value in parameters.items():
        path = (*prefix, key)
        if key.lower().endswith("thickness"):
            yield path
        elif isinstance(value, list):
            for index, item in enumerate(value):
                if isinstance(item, dict):
                    yield from _thickness_paths(item, (*path, index))


def _set_value(parameters, path, value):
    target = parameters
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value


def _parameter_definitions(definitions):
    for definition in definitions:
        yield definition
        if "repeatDefinition" in definition:
            yield from _parameter_definitions(
                definition["repeatDefinition"]["itemParameterDefinitions"]
            )


class ThicknessTests(unittest.TestCase):
    def setUp(self):
        self.registry = GeometryGeneratorRegistry()
        register_builtin_generators(self.registry)

    def _recipes(self):
        for definition in self.registry.definitions():
            for generation in (("gen1", "gen2") if definition["id"] == "lsi" else (None,)):
                parameters = copy.deepcopy(definition["defaultParameters"])
                if generation is not None:
                    parameters["generation"] = generation
                yield definition, parameters

    def test_all_thickness_manifest_limits_include_zero(self):
        for definition in self.registry.definitions():
            for parameter in _parameter_definitions(definition["parameterDefinitions"]):
                if parameter["id"].lower().endswith("thickness"):
                    with self.subTest(generator=definition["id"], field=parameter["id"]):
                        self.assertEqual(parameter["validation"]["min"], 0)
                        self.assertFalse(parameter["validation"].get("exclusiveMin", False))

    def test_each_thickness_accepts_zero_in_preview_and_generation(self):
        for definition, defaults in self._recipes():
            for path in _thickness_paths(defaults):
                with self.subTest(generator=definition["id"], generation=defaults.get("generation"), field=path):
                    parameters = copy.deepcopy(defaults)
                    if path == ("dramThickness",):
                        # The package must still contain its internal stack.
                        for internal_path in _thickness_paths(parameters):
                            _set_value(parameters, internal_path, 0)
                    _set_value(parameters, path, 0)
                    if definition["id"] == "lsi":
                        # A zero host layer also requires its via to fit the new span.
                        if path == ("bsPm0Thickness",):
                            parameters["bsVia0Thickness"] = 0
                        if path == ("fsPm0Thickness",):
                            parameters["fsVia0Thickness"] = 0
                    preview = self.registry.preview(definition["id"], parameters)
                    self.assertTrue(preview["valid"], preview["errors"])
                    self.assertEqual(
                        self.registry.generate(definition["id"], definition["version"], parameters),
                        preview["geometryEntityJson"],
                    )
                    self.assertEqual(self.registry.materialize(preview["previewToken"]), preview)

    def test_every_generator_accepts_zero_total_thickness(self):
        for definition, parameters in self._recipes():
            with self.subTest(generator=definition["id"], generation=parameters.get("generation")):
                for path in _thickness_paths(parameters):
                    _set_value(parameters, path, 0)
                for gap in ("coreBaseGap", "coreCoreGap"):
                    if gap in parameters:
                        parameters[gap] = 0
                preview = self.registry.preview(definition["id"], parameters)
                self.assertTrue(preview["valid"], preview["errors"])
                self.assertEqual(preview["computedParameters"]["totalThickness"], 0)
                section = preview["engineeringPreview"]["views"][1]
                self.assertEqual(section["bounds"]["vMin"], section["bounds"]["vMax"])
                self.assertEqual(section["dimensions"][0]["value"], 0)

    def test_active_thickness_rejects_negative_and_non_finite_values(self):
        for definition, defaults in self._recipes():
            visible_ids = {
                parameter["id"]
                for parameter in definition["parameterDefinitions"]
                if "visibleWhen" not in parameter
                or parameter["visibleWhen"]["equals"] == defaults.get("generation")
            }
            for path in _thickness_paths(defaults):
                if path[0] not in visible_ids:
                    continue
                for value in (-1, True, "0", None, float("nan"), float("inf")):
                    with self.subTest(generator=definition["id"], field=path, value=value):
                        parameters = copy.deepcopy(defaults)
                        _set_value(parameters, path, value)
                        preview = self.registry.preview(definition["id"], parameters)
                        self.assertFalse(preview["valid"])
                        self.assertIn(".".join(map(str, path)), preview["errors"])
                        self.assertIsNone(preview["previewToken"])


if __name__ == "__main__":
    unittest.main()
