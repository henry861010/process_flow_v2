#!/usr/bin/env python3
"""Validate repository documentation without third-party dependencies."""

from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path
from urllib.parse import unquote


REPO_ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = {
    ".git",
    ".next",
    ".pytest_cache",
    "node_modules",
    "out",
    "venv",
}
ALLOWED_STATUSES = {"normative", "descriptive", "proposed", "historical", "deprecated"}
REQUIRED_DOC_METADATA = {
    "title",
    "status",
    "owner",
    "audience",
    "last_verified",
    "last_verified_commit",
}
LINK_PATTERN = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
INLINE_REPO_PATH_PATTERN = re.compile(
    r"`((?:apps|docs|packages|scripts|script)/[^`\n]+)`"
)
REFERENCE_IMAGE_PATTERN = re.compile(r"-(\d+)x(\d+)\.png$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def markdown_files() -> list[Path]:
    result: list[Path] = []
    for path in REPO_ROOT.rglob("*.md"):
        if any(part in EXCLUDED_PARTS for part in path.parts):
            continue
        result.append(path)
    return sorted(result)


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def parse_front_matter(text: str) -> dict[str, str | list[str]]:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}
    metadata: dict[str, str | list[str]] = {}
    list_key: str | None = None
    for line in text[4:end].splitlines():
        if not line:
            continue
        if line[0].isspace():
            item = line.strip()
            if list_key is not None and item.startswith("- "):
                value = item[2:].strip().strip('"\'')
                current = metadata[list_key]
                if isinstance(current, list):
                    current.append(value)
            continue
        if ":" not in line:
            list_key = None
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value:
            metadata[key] = value.strip('"\'')
            list_key = None
        else:
            metadata[key] = []
            list_key = key
    return metadata


def validate_metadata(path: Path, text: str, errors: list[str]) -> None:
    if "docs" not in path.relative_to(REPO_ROOT).parts:
        return
    metadata = parse_front_matter(text)
    missing = sorted(REQUIRED_DOC_METADATA - set(metadata))
    if missing:
        errors.append(f"{relative(path)}: missing front matter fields: {', '.join(missing)}")
        return
    status = metadata.get("status")
    if status not in ALLOWED_STATUSES:
        errors.append(f"{relative(path)}: unsupported status {status!r}")
    audience = metadata.get("audience")
    if not isinstance(audience, list) or not audience:
        errors.append(f"{relative(path)}: audience must be a non-empty YAML list")
    last_verified = metadata.get("last_verified")
    if not isinstance(last_verified, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", last_verified):
        errors.append(f"{relative(path)}: last_verified must use YYYY-MM-DD")
    commit = metadata.get("last_verified_commit")
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{7,40}", commit):
        errors.append(f"{relative(path)}: last_verified_commit must be a Git commit hash")

    decision_status = metadata.get("decision_status")
    if decision_status is not None and decision_status not in {
        "proposed",
        "accepted",
        "superseded",
    }:
        errors.append(f"{relative(path)}: unsupported decision_status {decision_status!r}")

    source_of_truth = metadata.get("source_of_truth")
    accepted_adr = status == "normative" and decision_status == "accepted"
    if status not in {"historical", "deprecated"} and not accepted_adr:
        if not isinstance(source_of_truth, list) or not source_of_truth:
            errors.append(f"{relative(path)}: source_of_truth must be a non-empty YAML list")
    if accepted_adr:
        verified = metadata.get("verified_against")
        if not isinstance(verified, list) or not verified:
            errors.append(f"{relative(path)}: accepted ADR requires verified_against evidence")
    for field in ("source_of_truth", "verified_against"):
        sources = metadata.get(field)
        if not isinstance(sources, list):
            continue
        for source in sources:
            if source.startswith(("http://", "https://")):
                continue
            if not (REPO_ROOT / source).exists():
                errors.append(
                    f"{relative(path)}: {field} path does not exist: {source}"
                )


def normalize_link_target(raw_target: str) -> str:
    target = raw_target.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1]
    return unquote(target.split("#", 1)[0])


def validate_links(path: Path, text: str, errors: list[str]) -> None:
    for match in LINK_PATTERN.finditer(text):
        raw_target = match.group(1)
        if raw_target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        target = normalize_link_target(raw_target)
        if not target:
            continue
        resolved = Path(target) if Path(target).is_absolute() else path.parent / target
        if not resolved.exists():
            line = text.count("\n", 0, match.start()) + 1
            errors.append(f"{relative(path)}:{line}: broken link: {raw_target}")


def validate_inline_repo_paths(path: Path, text: str, errors: list[str]) -> None:
    for match in INLINE_REPO_PATH_PATTERN.finditer(text):
        candidate = match.group(1).strip().rstrip(".,;:，。；：")
        if any(token in candidate for token in ("*", "?", "{", "}", "<", ">", " ")):
            continue
        candidate = candidate.split("#", 1)[0]
        if not (REPO_ROOT / candidate).exists():
            line = text.count("\n", 0, match.start()) + 1
            errors.append(f"{relative(path)}:{line}: missing repository path: {candidate}")


def validate_json_fences(path: Path, text: str, errors: list[str]) -> None:
    lines = text.splitlines()
    block_start: int | None = None
    block_lines: list[str] = []
    for line_number, line in enumerate(lines, start=1):
        if block_start is None:
            if line.strip() == "```json":
                block_start = line_number
                block_lines = []
            continue
        if line.strip() == "```":
            try:
                json.loads("\n".join(block_lines))
            except json.JSONDecodeError as error:
                errors.append(
                    f"{relative(path)}:{block_start}: invalid fenced JSON: {error.msg} "
                    f"(line {error.lineno}, column {error.colno})"
                )
            block_start = None
            block_lines = []
        else:
            block_lines.append(line)
    if block_start is not None:
        errors.append(f"{relative(path)}:{block_start}: unclosed JSON fence")


def validate_reference_images(errors: list[str]) -> None:
    reference_dir = REPO_ROOT / "docs/ui/assets/reference"
    if not reference_dir.exists():
        return
    for path in sorted(reference_dir.glob("*.png")):
        match = REFERENCE_IMAGE_PATTERN.search(path.name)
        if match is None:
            errors.append(f"{relative(path)}: reference filename must end in -<width>x<height>.png")
            continue
        data = path.read_bytes()
        if len(data) < 24 or data[:8] != PNG_SIGNATURE:
            errors.append(f"{relative(path)}: .png reference asset is not PNG data")
            continue
        width, height = struct.unpack(">II", data[16:24])
        expected = (int(match.group(1)), int(match.group(2)))
        if (width, height) != expected:
            errors.append(
                f"{relative(path)}: image is {width}x{height}, filename declares "
                f"{expected[0]}x{expected[1]}"
            )


def main() -> int:
    errors: list[str] = []
    files = markdown_files()
    for path in files:
        text = path.read_text(encoding="utf-8")
        validate_metadata(path, text, errors)
        validate_links(path, text, errors)
        validate_inline_repo_paths(path, text, errors)
        validate_json_fences(path, text, errors)
    validate_reference_images(errors)

    if errors:
        print(f"Documentation validation failed with {len(errors)} error(s):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Documentation validation passed for {len(files)} Markdown files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
