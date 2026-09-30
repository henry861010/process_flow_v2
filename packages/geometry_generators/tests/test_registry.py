from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path

from process_flow_geometry_generators import (
    GeometryGeneratorRegistry,
    register_builtin_generators,
)
from process_flow_geometry_generators.hbm import HbmGenerator


class RegistryTests(unittest.TestCase):
    def test_package_import_does_not_import_api(self):
        package_src = Path(__file__).resolve().parents[1] / "src"
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import sys; "
                "from process_flow_geometry_generators import "
                "GeometryGeneratorRegistry, register_builtin_generators; "
                "registry = GeometryGeneratorRegistry(); "
                "register_builtin_generators(registry); "
                "assert registry.generate('hbm', 2, {})['generation']['schemaVersion'] == 2; "
                "assert 'process_flow_api' not in sys.modules",
            ],
            env={**os.environ, "PYTHONPATH": str(package_src)},
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_registry_is_empty_until_explicit_registration(self):
        registry = GeometryGeneratorRegistry()
        self.assertEqual(registry.definitions(), [])
        with self.assertRaises(KeyError):
            registry.generate("hbm", 2, {})

        registry.register(HbmGenerator())
        self.assertEqual([(item["id"], item["version"]) for item in registry.definitions()], [("hbm", 2)])
        self.assertEqual(registry.generate("hbm", 2, {})["generation"]["schemaVersion"], 2)

    def test_builtin_registration_preserves_order_and_preview(self):
        registry = GeometryGeneratorRegistry()
        register_builtin_generators(registry)
        self.assertEqual(
            [(item["id"], item["version"]) for item in registry.definitions()],
            [("hbm", 2), ("dram", 2), ("soc", 1), ("lsi", 1)],
        )
        preview = registry.preview("hbm", {}, generator_version=2)
        self.assertTrue(preview["valid"])
        self.assertEqual(registry.materialize(preview["previewToken"]), preview)

    def test_duplicate_and_invalid_manifest_fail_at_registration(self):
        registry = GeometryGeneratorRegistry()
        registry.register(HbmGenerator())
        with self.assertRaisesRegex(ValueError, "Duplicate geometry generator"):
            registry.register(HbmGenerator())

        class InvalidManifest(HbmGenerator):
            def definition(self):
                manifest = super().definition()
                manifest["parameterDefinitions"][0]["valueType"] = "unsupported"
                return manifest

        with self.assertRaises(ValueError):
            GeometryGeneratorRegistry((InvalidManifest(),))
        self.assertEqual(len(registry.definitions()), 1)

    def test_latest_version_does_not_replace_exact_version(self):
        class HbmV3(HbmGenerator):
            def definition(self):
                manifest = super().definition()
                manifest["version"] = 3
                return manifest

        registry = GeometryGeneratorRegistry()
        registry.register(HbmV3())
        registry.register(HbmGenerator())
        self.assertEqual(registry.definition("hbm")["version"], 3)
        self.assertEqual(registry.definition("hbm", 2)["version"], 2)
        self.assertEqual(registry.generate("hbm", 2, {})["generation"]["schemaVersion"], 2)
        self.assertEqual(registry.generate("hbm", 3, {})["generation"]["schemaVersion"], 3)


if __name__ == "__main__":
    unittest.main()
