from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

from process_flow_api.cdb_exporter import start_cdb_worker
from process_flow_api.file_export_jobs import _package_versions


class CdbWorkerBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_starts_mesher_process_flow_worker_with_two_json_inputs(self):
        process = object()
        with mock.patch(
            "process_flow_api.cdb_exporter.asyncio.create_subprocess_exec",
            new_callable=mock.AsyncMock,
            return_value=process,
        ) as create_subprocess:
            result = await start_cdb_worker(
                geometry_input_path=Path("/tmp/geometry.json"),
                mesh_control_input_path=Path("/tmp/mesh_control.json"),
                output_path=Path("/tmp/output.cdb"),
            )

        self.assertIs(result, process)
        args = create_subprocess.await_args.args
        kwargs = create_subprocess.await_args.kwargs
        self.assertEqual(
            args,
            (
                sys.executable,
                "-m",
                "mesher.process_flow.worker",
                "/tmp/geometry.json",
                "/tmp/mesh_control.json",
                "/tmp/output.cdb",
            ),
        )
        self.assertEqual(kwargs["stdout"], asyncio.subprocess.PIPE)
        self.assertEqual(kwargs["stderr"], asyncio.subprocess.PIPE)
        self.assertIn("MPLCONFIGDIR", kwargs["env"])


class ExportPackageVersionTests(unittest.TestCase):
    def test_reports_mesher_distribution_version(self):
        with mock.patch(
            "process_flow_api.file_export_jobs.importlib_metadata.version",
            side_effect=lambda package: f"version:{package}",
        ):
            versions = _package_versions()

        self.assertEqual(
            versions,
            {
                "process-flow-api": "version:process-flow-api",
                "process-flow-kernel": "version:process-flow-kernel",
                "process-flow-cad": "version:process-flow-cad",
                "mesher": "version:mesher",
            },
        )


if __name__ == "__main__":
    unittest.main()
