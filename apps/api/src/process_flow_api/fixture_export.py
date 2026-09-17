from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Mapping, Sequence
from typing import Any

from .seed import FIXTURE_FILES


def build_fixture_archive(payload: Mapping[str, Sequence[dict[str, Any]]]) -> bytes:
    """Build a fixture-compatible ZIP snapshot from the current database payload."""

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for payload_key, filename in FIXTURE_FILES.items():
            fixture_json = json.dumps(
                payload[payload_key],
                ensure_ascii=False,
                indent=2,
            )
            archive.writestr(filename, f"{fixture_json}\n")
    return buffer.getvalue()
