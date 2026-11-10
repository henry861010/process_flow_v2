"""Conversion commits reject dependencies edited after successful execution."""
from __future__ import annotations

import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_package_conversion as acceptance
from process_flow_api import package_conversion
from process_flow_api.package_conversion_schema import ConversionRequest
from process_flow_api.repository import ResourceConflictError, SQLiteStore


class _BeforeConditionalInsert:
    """Intercept one commit boundary while preserving sqlite transaction behavior."""

    def __init__(self, connection, callback):
        self.connection = connection
        self.callback = callback
        self.insert_sql = None

    def execute(self, sql, parameters=()):
        if sql.startswith("INSERT INTO process_flows ") and " SELECT " in sql:
            if self.insert_sql is not None:
                raise AssertionError("Expected only one conditional process-flow insertion")
            self.insert_sql = sql
            self.callback()
        return self.connection.execute(sql, parameters)

    def __getattr__(self, name):
        return getattr(self.connection, name)

    def __enter__(self):
        self.connection.__enter__()
        return self

    def __exit__(self, *args):
        return self.connection.__exit__(*args)


class PackageConversionCommitTests(unittest.TestCase):
    def setUp(self):
        # Keep the acceptance module qualified: unittest must not discover its
        # TestCase a second time through an imported class in this module.
        self.fixture = acceptance.PackageConversionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)

    def test_template_edit_between_execution_and_native_create_returns_conflict(self):
        fixture = self.fixture
        store = fixture.app.state.store
        before = store.list_process_flows()
        original_create = package_conversion.create_flow

        def concurrent_template_edit(store, body, generators, **kwargs):
            # Program is an editable template field, including for referenced
            # steps. Its new execution behavior must not inherit old checks.
            template = store.get_process_step_template("step_tpl_grinding")
            template["program"] = "flip/flip"
            store.update_process_step_template(template)
            return original_create(store, body, generators, **kwargs)

        with patch.object(package_conversion, "create_flow", side_effect=concurrent_template_edit):
            response = fixture.client.post("/api/package-conversions/import", json=fixture.request())

        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(store.list_process_flows(), before)
        self.assertEqual(store.get_process_flow(fixture.base["id"]), fixture.base)
        self.assertEqual(store.get_process_step_template("step_tpl_grinding")["program"], "flip/flip")

    def test_dependency_edits_after_snapshot_reads_are_checked_by_insert_itself(self):
        fixture = self.fixture
        request = ConversionRequest.model_validate(fixture.request())
        for dependency in ("template", "baseline"):
            with self.subTest(dependency=dependency), tempfile.TemporaryDirectory() as directory:
                reader = SQLiteStore(Path(directory) / "conversion.sqlite3")
                fixture.app.state.store._connection.backup(reader._connection)
                writer = SQLiteStore(reader.db_path)
                try:
                    before = reader.list_process_flows()

                    def concurrent_edit():
                        if dependency == "template":
                            template = writer.get_process_step_template("step_tpl_grinding")
                            template["program"] = "flip/flip"
                            writer.update_process_step_template(template)
                        else:
                            baseline = writer.get_process_flow(fixture.base["id"])
                            baseline["description"] = "Concurrent baseline update"
                            writer.update_process_flow(baseline, baseline["revision"])

                    connection = reader._connection
                    proxy = _BeforeConditionalInsert(connection, concurrent_edit)
                    reader._connection = proxy
                    try:
                        with self.assertRaisesRegex(ResourceConflictError, "dependency changed"):
                            package_conversion.convert_package(
                                reader, fixture.app.state.geometry_generators, request, persist=True,
                            )
                    finally:
                        reader._connection = connection

                    self.assertIsNotNone(proxy.insert_sql, "The race must happen after resource token reads")
                    for table in ("process_flows", "process_step_templates", "geometries"):
                        self.assertIn(f"EXISTS (SELECT 1 FROM {table} ", proxy.insert_sql)
                    after = reader.list_process_flows()
                    self.assertEqual({flow["id"] for flow in after}, {flow["id"] for flow in before})
                    if dependency == "template":
                        self.assertEqual(after, before)
                        self.assertEqual(reader.get_process_step_template("step_tpl_grinding")["program"], "flip/flip")
                    else:
                        expected = copy.deepcopy(before)
                        updated = next(flow for flow in expected if flow["id"] == fixture.base["id"])
                        updated["description"] = "Concurrent baseline update"
                        updated["revision"] += 1
                        self.assertEqual(after, expected)
                finally:
                    writer.close()
                    reader.close()


if __name__ == "__main__":
    unittest.main()
