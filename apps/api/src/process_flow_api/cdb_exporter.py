from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

JsonObject = dict[str, Any]


class CdbWorkerError(RuntimeError):
    pass


async def start_cdb_worker(
    *,
    input_path: Path,
    element_size: float,
    output_path: Path,
) -> asyncio.subprocess.Process:
    env = os.environ.copy()
    if not env.get("MPLCONFIGDIR"):
        mpl_config_dir = Path(tempfile.gettempdir()) / "process-flow-matplotlib"
        mpl_config_dir.mkdir(parents=True, exist_ok=True)
        env["MPLCONFIGDIR"] = str(mpl_config_dir)
    return await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "process_flow_mesher.worker",
        str(input_path),
        str(element_size),
        str(output_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )


def parse_cdb_worker_stdout(stdout: bytes) -> JsonObject:
    text = stdout.decode("utf-8", errors="replace").strip()
    if not text:
        raise CdbWorkerError("CDB export worker produced no metadata.")

    # The worker is expected to print only JSON, but parsing the last non-empty
    # line keeps this bridge resilient to harmless diagnostic output.
    line = [candidate for candidate in text.splitlines() if candidate.strip()][-1]
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as exc:
        raise CdbWorkerError(f"CDB export worker returned invalid metadata: {line[-1000:]}") from exc
    if not isinstance(payload, dict):
        raise CdbWorkerError("CDB export worker metadata must be a JSON object.")
    return payload


def cdb_worker_error_message(returncode: int | None, stdout: bytes, stderr: bytes) -> str:
    details = (stderr or stdout).decode("utf-8", errors="replace").strip()
    if details:
        return f"CDB export failed: {details[-4000:]}"
    return f"CDB export failed with exit code {returncode}"
