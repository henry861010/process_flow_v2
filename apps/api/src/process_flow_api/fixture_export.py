from __future__ import annotations

import io
import json
import zlib
import zipfile
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic import ValidationError
from process_flow_kernel import validate_geometry_semantic_keys

from .models import (
    GeometryEntity,
    ProcessFlowInstance,
    ProcessFlowTemplate,
    ProcessStepTemplate,
)
from .seed import FIXTURE_FILES

MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024


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


def load_fixture_archive(content: bytes) -> dict[str, list[dict[str, Any]]]:
    """Validate a fixture ZIP before it is used to replace database contents."""

    if len(content) > MAX_ARCHIVE_BYTES:
        raise ValueError("Fixture ZIP exceeds the 25 MB upload limit")

    models = {
        "processStepTemplates": ProcessStepTemplate,
        "processFlowTemplates": ProcessFlowTemplate,
        "processFlowInstances": ProcessFlowInstance,
        "geometries": GeometryEntity,
    }
    result: dict[str, list[dict[str, Any]]] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) != len(FIXTURE_FILES) or {
                entry.filename for entry in entries
            } != set(FIXTURE_FILES.values()):
                raise ValueError("Fixture ZIP must contain exactly the four exported JSON files")
            if sum(entry.file_size for entry in entries) > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("Fixture ZIP exceeds the 100 MB expanded size limit")
            for key, filename in FIXTURE_FILES.items():
                try:
                    items = json.loads(archive.read(filename).decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise ValueError(f"{filename} must contain valid UTF-8 JSON") from error
                if not isinstance(items, list):
                    raise ValueError(f"{filename} must contain a JSON array")
                ids: set[str] = set()
                for index, item in enumerate(items):
                    try:
                        models[key].model_validate(item)
                    except ValidationError as error:
                        raise ValueError(f"{filename}[{index}]: {error}") from error
                    item_id = item.get("id")
                    if not item_id:
                        raise ValueError(f"{filename}[{index}] must have an id")
                    if item_id in ids:
                        raise ValueError(f"{filename} contains duplicate id: {item_id}")
                    ids.add(item_id)
                    if key == "geometries":
                        validate_geometry_semantic_keys(item["structure"])
                result[key] = items
    except (zipfile.BadZipFile, EOFError, RuntimeError, zlib.error) as error:
        raise ValueError("Invalid fixture ZIP") from error
    return result
