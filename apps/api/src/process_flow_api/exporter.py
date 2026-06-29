from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Literal

JsonObject = dict[str, Any]

DEFAULT_EXPORT_TIMEOUT_SECONDS = 30


async def export_geometry(
    geometry_structure: JsonObject,
    *,
    format: Literal["glb", "step"],
    timeout_seconds: int | None = None,
) -> bytes:
    repo_root = _repo_root()
    worker_path = repo_root / "apps" / "viewer" / "scripts" / "geometry-export-worker.mjs"
    exporter_path = repo_root / "src" / "exporters" / "cad.js"
    node_path = os.environ.get("PROCESS_FLOW_NODE", "node")
    timeout = timeout_seconds or int(
        os.environ.get("GEOMETRY_PREVIEW_EXPORT_TIMEOUT_SECONDS", DEFAULT_EXPORT_TIMEOUT_SECONDS)
    )

    with tempfile.TemporaryDirectory(prefix="process-flow-api-export-") as tmp:
        work_dir = Path(tmp)
        input_path = work_dir / "geometry-structure.json"
        output_path = work_dir / f"preview.{format}"
        input_path.write_text(json.dumps(geometry_structure), encoding="utf-8")

        process = await asyncio.create_subprocess_exec(
            node_path,
            str(worker_path),
            format,
            str(input_path),
            str(output_path),
            str(exporter_path),
            cwd=str(repo_root / "apps" / "viewer"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            process.kill()
            await process.communicate()
            raise RuntimeError(f"Geometry {format} export timed out after {timeout}s") from None

        if process.returncode != 0:
            details = (stderr or stdout).decode("utf-8", errors="replace").strip()
            if details:
                raise RuntimeError(f"Geometry {format} export failed: {details[-4000:]}")
            raise RuntimeError(f"Geometry {format} export failed with exit code {process.returncode}")

        return output_path.read_bytes()


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]
