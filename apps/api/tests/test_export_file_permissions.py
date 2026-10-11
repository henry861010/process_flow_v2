from __future__ import annotations

import asyncio
import stat
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from process_flow_api.export_job_logging import ExportJobLogError, ExportJobLogger
from process_flow_api.file_export_jobs import FileExportJobManager


async def start_private_output_worker(*, output_path, **_):
    return await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "import pathlib,sys; p=pathlib.Path(sys.argv[1]); "
        "p.write_text('worker output'); p.chmod(0o600); print('{}')",
        str(output_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


class FileExportPermissionsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.manager = FileExportJobManager()

    async def asyncTearDown(self):
        await self.manager.shutdown()
        self.tmp.cleanup()

    async def create_job(self, kind):
        return await self.manager.create_file_export_job(
            client_id="permissions-test",
            kind=kind,
            output_path=str(self.directory / f"output.{kind}"),
            source_label=None,
            geometry_entity_json={},
            geometry_structure={},
            mesh_control={},
        )

    async def wait_for_job(self, job_id):
        async with asyncio.timeout(10):
            while True:
                job = await self.manager.get_job(
                    job_id=job_id, client_id="permissions-test"
                )
                if job["status"] in {"success", "failed", "canceled"}:
                    return job
                await asyncio.sleep(0.01)

    def assert_inputs_cleaned(self, job_id):
        job = self.manager._jobs[job_id]
        self.assertFalse(job.input_path.exists())
        self.assertFalse(job.temp_output_path.exists())
        if job.input_directory is not None:
            self.assertFalse(job.input_directory.exists())

    async def test_primary_permissions_are_set_before_publishing_each_kind(self):
        original_replace = Path.replace
        published = []

        def publish(path, target):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o777)
            published.append(Path(target))
            return original_replace(path, target)

        with (
            mock.patch(
                "process_flow_api.file_export_jobs.start_cdb_worker",
                new=start_private_output_worker,
            ),
            mock.patch(
                "process_flow_api.file_export_jobs.start_cad_worker",
                new=start_private_output_worker,
            ),
            mock.patch.object(Path, "replace", autospec=True, side_effect=publish),
        ):
            for kind in ("json", "cdb", "step"):
                with self.subTest(kind=kind):
                    created = await self.create_job(kind)
                    job = await self.wait_for_job(created["jobId"])
                    self.assertEqual(job["status"], "success", job)
                    self.assertIn(Path(job["outputPath"]), published)
                    self.assert_inputs_cleaned(job["jobId"])

    async def test_primary_chmod_failure_fails_each_kind_and_cleans_inputs(self):
        original_chmod = Path.chmod

        def deny_primary(path, mode):
            if path.name.endswith(".tmp"):
                raise PermissionError("simulated chmod denial")
            return original_chmod(path, mode)

        with (
            mock.patch(
                "process_flow_api.file_export_jobs.start_cdb_worker",
                new=start_private_output_worker,
            ),
            mock.patch(
                "process_flow_api.file_export_jobs.start_cad_worker",
                new=start_private_output_worker,
            ),
            mock.patch.object(Path, "chmod", autospec=True, side_effect=deny_primary),
        ):
            for kind in ("json", "cdb", "step"):
                with self.subTest(kind=kind):
                    created = await self.create_job(kind)
                    job = await self.wait_for_job(created["jobId"])
                    self.assertEqual(job["status"], "failed", job)
                    self.assertIn("simulated chmod denial", job["message"])
                    internal_job = self.manager._jobs[job["jobId"]]
                    self.assertIn(str(internal_job.temp_output_path), job["message"])
                    self.assertFalse(Path(job["outputPath"]).exists())
                    self.assertEqual(stat.S_IMODE(Path(job["logPath"]).stat().st_mode), 0o777)
                    self.assert_inputs_cleaned(job["jobId"])

    async def test_sidecar_chmod_failure_fails_before_starting_worker(self):
        original_chmod = Path.chmod
        for suffix in (".geometry.json", ".mesh-control.json"):
            with self.subTest(suffix=suffix):
                failed_path = self.directory / f"output{suffix}"

                def deny_sidecar(path, mode):
                    if path == failed_path:
                        raise PermissionError("simulated sidecar chmod denial")
                    return original_chmod(path, mode)

                with (
                    mock.patch.object(Path, "chmod", autospec=True, side_effect=deny_sidecar),
                    mock.patch(
                        "process_flow_api.file_export_jobs.start_cdb_worker",
                        new_callable=mock.AsyncMock,
                    ) as worker,
                ):
                    created = await self.create_job("cdb")
                    job = await self.wait_for_job(created["jobId"])

                worker.assert_not_awaited()
                self.assertEqual(job["status"], "failed", job)
                self.assertIn(str(failed_path), job["message"])
                self.assertIn("simulated sidecar chmod denial", job["message"])
                self.assertFalse(Path(job["outputPath"]).exists())
                self.assertEqual(stat.S_IMODE(Path(job["logPath"]).stat().st_mode), 0o777)
                self.assert_inputs_cleaned(job["jobId"])

    async def test_log_chmod_failure_rejects_job_and_cleans_created_files(self):
        input_paths = []
        original_mkstemp = tempfile.mkstemp

        def create_input(*args, **kwargs):
            fd, path = original_mkstemp(*args, **kwargs)
            input_paths.append(Path(path))
            return fd, path

        with (
            mock.patch.object(Path, "chmod", side_effect=PermissionError("log chmod denied")),
            mock.patch(
                "process_flow_api.file_export_jobs.tempfile.mkstemp", side_effect=create_input
            ),
        ):
            with self.assertRaisesRegex(ValueError, r"Could not create export log .*log chmod denied"):
                await self.create_job("json")

        self.assertTrue(input_paths)
        self.assertTrue(all(not path.exists() for path in input_paths))
        self.assertEqual(list(self.directory.iterdir()), [])
        self.assertEqual(await self.manager.list_jobs(client_id="permissions-test"), [])

    async def test_directory_and_internal_input_permissions_are_unchanged(self):
        self.manager.max_concurrent_jobs = 0
        directory_mode = stat.S_IMODE(self.directory.stat().st_mode)
        reference = self.directory / "reference.txt"
        reference.write_text("before")
        default_file_mode = stat.S_IMODE(reference.stat().st_mode)
        created = await self.create_job("cdb")
        internal_job = self.manager._jobs[created["jobId"]]
        self.assertEqual(stat.S_IMODE(internal_job.input_directory.stat().st_mode), 0o700)
        for path in (internal_job.input_path, internal_job.mesh_control_input_path):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), default_file_mode)
        self.assertEqual(stat.S_IMODE(self.directory.stat().st_mode), directory_mode)
        reference.write_text("after")
        after_reference = self.directory / "after.txt"
        after_reference.write_text("after")
        self.assertEqual(stat.S_IMODE(after_reference.stat().st_mode), default_file_mode)


class ExportLogPermissionFailureTests(unittest.TestCase):
    def test_failed_chmod_closes_handle_and_removes_only_new_log(self):
        with tempfile.TemporaryDirectory() as directory:
            log_path = Path(directory) / "export.log"
            with log_path.open("x", encoding="utf-8") as handle:
                with (
                    mock.patch.object(Path, "open", return_value=handle),
                    mock.patch.object(Path, "chmod", side_effect=PermissionError("denied")),
                    self.assertRaisesRegex(ExportJobLogError, r"export.log.*denied"),
                ):
                    ExportJobLogger.create(
                        path=log_path,
                        job_id="test",
                        kind="json",
                        created_at=datetime.now(timezone.utc),
                    )
                self.assertTrue(handle.closed)
                self.assertFalse(log_path.exists())

    def test_existing_log_is_preserved_when_creation_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            log_path = Path(directory) / "export.log"
            log_path.write_text("existing log")
            log_path.chmod(0o600)
            with self.assertRaises(ExportJobLogError):
                ExportJobLogger.create(
                    path=log_path,
                    job_id="test",
                    kind="json",
                    created_at=datetime.now(timezone.utc),
                )
            self.assertEqual(log_path.read_text(), "existing log")
            self.assertEqual(stat.S_IMODE(log_path.stat().st_mode), 0o600)
