from __future__ import annotations

from pathlib import Path


def set_export_file_permissions(path: Path) -> None:
    """Apply the permissions required for retained file export artifacts."""
    try:
        path.chmod(0o777)
    except OSError as error:
        raise OSError(
            f"Could not set export file permissions to 777 for {path}: {error}"
        ) from error
