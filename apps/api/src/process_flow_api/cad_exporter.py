from __future__ import annotations

import asyncio
import sys
from pathlib import Path


async def start_cad_worker(
    *,
    input_path: Path,
    output_path: Path,
    format: str = "step",
) -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "process_flow_cad.worker",
        format,
        str(input_path),
        str(output_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


def cad_worker_error_message(
    *,
    format: str,
    returncode: int | None,
    stdout: bytes,
    stderr: bytes,
) -> str:
    label = format.upper()
    details = (stderr or stdout).decode("utf-8", errors="replace").strip()
    if details:
        return f"{label} export failed: {details[-4000:]}"
    return f"{label} export failed with exit code {returncode}"
