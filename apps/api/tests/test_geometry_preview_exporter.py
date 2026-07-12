from __future__ import annotations

import asyncio
import unittest
from unittest import mock

from process_flow_api.geometry_preview_exporter import export_geometry


class _BlockingProcess:
    def __init__(self) -> None:
        self.returncode: int | None = None
        self.communicate_calls = 0
        self.killed = False
        self.started = asyncio.Event()

    async def communicate(self):
        self.communicate_calls += 1
        if self.communicate_calls == 1:
            self.started.set()
            await asyncio.Future()
        return b"", b""

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9


class GeometryPreviewExporterTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_export_kills_and_reaps_cad_worker(self):
        process = _BlockingProcess()
        with mock.patch(
            "process_flow_api.geometry_preview_exporter.asyncio.create_subprocess_exec",
            return_value=process,
        ):
            task = asyncio.create_task(
                export_geometry(
                    {"schemaVersion": "1.0.0", "unitSystem": "um", "root": {}},
                    format="glb",
                )
            )
            await process.started.wait()
            task.cancel()

            with self.assertRaises(asyncio.CancelledError):
                await task

        self.assertTrue(process.killed)
        self.assertEqual(process.communicate_calls, 2)


if __name__ == "__main__":
    unittest.main()
