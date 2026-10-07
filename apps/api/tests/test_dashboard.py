from __future__ import annotations

import json
import sqlite3
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient
from pydantic import ValidationError

from process_flow_api.file_export_jobs import FileExportJob, FileExportProgress
from process_flow_api.dashboard_progress import public_progress_message
from process_flow_api.main import create_app
from process_flow_api.models import DashboardJobsResponse


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.app = create_app(db_path=self.root / "business.sqlite3")
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.manager = self.app.state.file_export_jobs

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.app.state.store.close()
        self.tmp.cleanup()

    def add_job(self, job_id, *, kind="cdb", status="queued", client="private-client"):
        now = datetime.now(timezone.utc)
        job = FileExportJob(
            job_id=job_id,
            client_id=client,
            kind=kind,
            output_path=self.root / "private-output.cdb",
            temp_output_path=self.root / "private-temp.cdb",
            input_path=self.root / "private-input.json",
            input_directory=None,
            mesh_control_input_path=None,
            geometry_output_path=self.root / "private-geometry.json",
            mesh_control_output_path=None,
            source_label="private-source",
            created_at=now - timedelta(hours=3),
            log_path=self.root / "private-log.txt",
            logger=mock.Mock(),
            status=status,
            created_monotonic=time.monotonic() - 60,
            started_at=now - timedelta(hours=2) if status != "queued" else None,
            started_monotonic=time.monotonic() - 30 if status != "queued" else None,
            mesh_control={"private-input": True},
            message="private-error-path",
            warning="private-warning",
        )
        self.manager._jobs[job_id] = job
        return job

    def snapshot(self):
        response = self.client.get("/api/dashboard/jobs")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        return response.json()

    def test_empty_public_endpoint_and_polling_classification(self):
        payload = self.snapshot()
        self.assertEqual(payload["jobs"], [])
        self.assertEqual(payload["runningCount"], 0)
        self.assertEqual(payload["queuedCount"], 0)
        self.assertEqual(payload["maxConcurrentJobs"], self.manager.max_concurrent_jobs)
        self.assertIsNotNone(datetime.fromisoformat(payload["generatedAt"]).tzinfo)
        self.assertTrue(self.app.state.analytics.flush())
        with sqlite3.connect(self.root / "analytics.sqlite3") as connection:
            records = connection.execute(
                "SELECT route, traffic_kind FROM api_requests"
            ).fetchall()
        self.assertEqual(records, [("/api/dashboard/jobs", "polling")])

    def test_global_counts_fifo_and_all_formats(self):
        self.add_job("queued-first", kind="json", client="client-a")
        self.add_job("running", kind="cdb", status="running", client="client-b")
        self.add_job("queued-second", kind="step", client="client-b")
        self.add_job("canceling", kind="step", status="canceling", client="client-c")
        for status in ("success", "failed", "canceled"):
            self.add_job(status, status=status)
        payload = self.snapshot()
        self.assertEqual(payload["runningCount"], 2)
        self.assertEqual(payload["queuedCount"], 2)
        self.assertEqual([job["jobId"] for job in payload["jobs"]],
                         ["running", "canceling", "queued-first", "queued-second"])
        self.assertEqual([job["queuePosition"] for job in payload["jobs"]],
                         [None, None, 1, 2])
        self.assertEqual({job["kind"] for job in payload["jobs"]}, {"cdb", "json", "step"})
        # Wall-clock timestamps deliberately disagree with the monotonic duration.
        self.assertAlmostEqual(payload["jobs"][0]["runElapsedSeconds"], 30, delta=2)
        self.assertAlmostEqual(payload["jobs"][2]["queueElapsedSeconds"], 60, delta=2)
        self.assertIsNone(payload["jobs"][0]["queueElapsedSeconds"])
        self.assertIsNone(payload["jobs"][2]["runElapsedSeconds"])

    def test_active_jobs_are_not_limited_to_client_history_size(self):
        for index in range(25):
            self.add_job(f"queued-{index}")
        payload = self.snapshot()
        self.assertEqual(payload["queuedCount"], 25)
        self.assertEqual(len(payload["jobs"]), 25)
        self.assertEqual([job["queuePosition"] for job in payload["jobs"]], list(range(1, 26)))

    def test_status_changes_remove_terminal_jobs_and_update_positions(self):
        first = self.add_job("first")
        second = self.add_job("second")
        self.assertEqual(self.snapshot()["jobs"][1]["queuePosition"], 2)
        first.status = "canceled"
        payload = self.snapshot()
        self.assertEqual([job["jobId"] for job in payload["jobs"]], ["second"])
        self.assertEqual(payload["jobs"][0]["queuePosition"], 1)
        second.status = "running"
        second.started_at = datetime.now(timezone.utc)
        second.started_monotonic = time.monotonic()
        payload = self.snapshot()
        self.assertEqual((payload["runningCount"], payload["queuedCount"]), (1, 0))
        self.assertIsNone(payload["jobs"][0]["queuePosition"])
        for status in ("success", "failed", "canceled"):
            second.status = status
            self.assertEqual(self.snapshot()["jobs"], [])

    def test_public_payload_uses_an_explicit_allowlist(self):
        job = self.add_job("safe-id", status="running")
        job.progress = FileExportProgress(
            stage="building_2d_mesh", stage_started_at=job.created_at,
            updated_at=job.created_at, current=3, total=10, unit="features",
            message="private-worker-path",
        )
        payload = self.snapshot()
        self.assertNotIn("private", json.dumps(payload))
        self.assertEqual(set(payload["jobs"][0]), {
            "jobId", "kind", "status", "createdAt", "startedAt", "queuePosition",
            "runElapsedSeconds", "queueElapsedSeconds", "progress",
        })
        self.assertEqual(set(payload["jobs"][0]["progress"]), {
            "stage", "message", "current", "total", "unit", "stageStartedAt", "updatedAt",
        })
        self.assertIsNone(payload["jobs"][0]["progress"]["message"])
        self.assertEqual(payload["jobs"][0]["progress"]["current"], 3)
        payload["jobs"][0]["clientId"] = "private-client"
        with self.assertRaises(ValidationError):
            DashboardJobsResponse.model_validate(payload)

    def test_dashboard_shows_current_worker_details_for_each_format(self):
        job = self.add_job("live-details", status="running")
        cases = [
            ("cdb", "building_2d_mesh", "Generating base grid."),
            ("cdb", "building_2d_mesh", "Imprinting feature 3 of 10."),
            ("cdb", "building_2d_mesh", "Imprinted feature 3 of 10."),
            ("cdb", "building_2d_mesh", "Extending feature 4 of 10."),
            ("cdb", "building_3d_mesh", "Assigning feature 2 of 5 in layer 3 of 12."),
            ("cdb", "building_3d_mesh", "Built layer 3 of 12."),
            ("cdb", "writing_output", "Writing CDB nodes."),
            ("step", "building_cad_model", "Converting CAD bodies."),
            ("step", "building_cad_model", "Converted body 3 of 10."),
            ("json", "writing_output", "Writing JSON document."),
        ]
        for kind, stage, message in cases:
            with self.subTest(kind=kind, stage=stage, message=message):
                job.kind = kind
                job.progress = FileExportProgress(
                    stage=stage, stage_started_at=job.created_at,
                    updated_at=job.created_at, message=message,
                )
                progress = self.snapshot()["jobs"][0]["progress"]
                self.assertEqual(progress["stage"], stage)
                self.assertEqual(progress["message"], message)

    def test_public_worker_details_reject_unknown_text_and_paths(self):
        for message in [
            "Writing CDB nodes. /Users/private/model.cdb",
            "Imprinting feature 3 of 10.\nprivate-source",
            "Imprinting feature private-source of 10.",
            "private-worker-error", "<script>alert(1)</script>",
            "Imprinting feature " + "1" * 300 + " of 10.",
        ]:
            with self.subTest(message=message):
                self.assertIsNone(public_progress_message("building_2d_mesh", message))
        self.assertIsNone(public_progress_message("building_2d_mesh", "Built layer 3 of 12."))
        self.assertIsNone(public_progress_message("building_2d_mesh", None))

    def test_dashboard_does_not_change_existing_client_isolation(self):
        self.add_job("client-a-job", client="client-a")
        self.add_job("client-b-job", client="client-b")
        own = self.client.get("/api/export-jobs?clientId=client-a").json()
        self.assertEqual([job["jobId"] for job in own["jobs"]], ["client-a-job"])
        self.assertEqual(self.snapshot()["queuedCount"], 2)


if __name__ == "__main__":
    unittest.main()
