"""Package conversion client: python -m process_flow_api.package_conversion_cli --help."""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def _read_document(path: Path, *, allow_array: bool = False) -> dict | list:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as exc:
        raise ValueError(f"Cannot read JSON {path}: {exc}") from exc
    if not isinstance(value, dict) and not (allow_array and isinstance(value, list)):
        expected = "object or array" if allow_array else "object"
        raise ValueError(f"Expected a JSON {expected} in {path}")
    return value


def _write_json(path: Path, value: dict) -> None:
    """Replace one output atomically; never leave a partly written JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            name = stream.name
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        os.replace(name, path)
        name = None
    finally:
        if name is not None:
            Path(name).unlink(missing_ok=True)


def _error_response(exc: HTTPError, output: Path) -> str:
    try:
        payload = json.loads(exc.read().decode("utf-8"))
    except (UnicodeError, ValueError):
        return f"HTTP {exc.code}: {exc.reason}"
    if isinstance(payload, dict):
        report = payload.get("report")
        if isinstance(report, dict):
            _write_json(output / "report.json", report)
        message = payload.get("message") or payload.get("detail") or exc.reason
        return f"HTTP {exc.code}: {message}"
    return f"HTTP {exc.code}: {exc.reason}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Convert package JSON using a selected baseline flow")
    for flag in ("source", "profile", "bindings"):
        parser.add_argument(f"--{flag}", required=True, type=Path)
    parser.add_argument("--base-flow", required=True, help="Existing baseline ProcessFlow ID")
    parser.add_argument("--base-revision", required=True, type=int)
    parser.add_argument("--name", required=True)
    parser.add_argument("--version", required=True, help="New ProcessFlow version label")
    parser.add_argument("--owner", required=True)
    parser.add_argument("--description", default="")
    parser.add_argument("--api-url", default="http://127.0.0.1:8000", help="API origin, without /api")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--import", dest="import_flow", action="store_true",
                        help="Validate and create a new flow in DB; default only previews")
    args = parser.parse_args(argv)
    if args.base_revision < 1:
        parser.error("--base-revision must be positive")
    origin = urlsplit(args.api_url)
    if (origin.scheme not in {"http", "https"} or not origin.netloc or origin.path not in {"", "/"}
            or origin.query or origin.fragment):
        parser.error("--api-url must be an HTTP(S) origin without a path, query, or fragment")
    inputs = {path.resolve() for path in (args.source, args.profile, args.bindings)}
    if any((args.output_dir / name).resolve() in inputs for name in ("flow.json", "report.json")):
        parser.error("Output files must differ from the source, profile, and bindings files")
    try:
        payload = {"source": _read_document(args.source, allow_array=True), "profile": _read_document(args.profile),
                   "bindings": _read_document(args.bindings), "baseFlowId": args.base_flow,
                   "baseRevision": args.base_revision,
                   "metadata": {"name": args.name, "version": args.version,
                                "owner": args.owner, "description": args.description}}
        action = "import" if args.import_flow else "preview"
        request = Request(f"{args.api_url.rstrip('/')}/api/package-conversions/{action}",
                          data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                          headers={"Content-Type": "application/json", "Accept": "application/json"},
                          method="POST")
        # A conversion/import is never automatically retried: it may already have committed.
        with urlopen(request, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
        if not isinstance(result, dict) or not isinstance(result.get("report"), dict):
            raise ValueError("API response must contain a conversion report")
        report = result["report"]
        expected_status = "imported" if args.import_flow else "validated"
        if report.get("status") != expected_status or not isinstance(result.get("flow"), dict):
            _write_json(args.output_dir / "report.json", report)
            raise ValueError(f"Conversion did not return a {expected_status} flow")
        _write_json(args.output_dir / "flow.json", result["flow"])
        _write_json(args.output_dir / "report.json", report)
    except HTTPError as exc:
        try:
            message = _error_response(exc, args.output_dir)
        except (OSError, ValueError) as report_error:
            message = f"HTTP {exc.code}; cannot save error report: {report_error}"
        print(message, file=sys.stderr)
        return 1
    except (OSError, ValueError, URLError) as exc:
        print(f"Package conversion failed: {exc}", file=sys.stderr)
        return 1
    print(f"{expected_status}: {args.output_dir / 'flow.json'}; report: {args.output_dir / 'report.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
