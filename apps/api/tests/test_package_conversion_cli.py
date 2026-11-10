from __future__ import annotations

import io
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from unittest import mock

import pytest

from process_flow_api.package_conversion_cli import main


@pytest.fixture
def invocation(tmp_path):
    args = []
    for name, value in (("source", {"封膠": "EMC"}), ("profile", {"schemaVersion": 1}),
                        ("bindings", {"roles": {"cow.mold.deposit": "mold_cap"}})):
        path = tmp_path / f"{name}.json"
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        args.extend([f"--{name}", str(path)])
    output = tmp_path / "converted"
    args.extend(["--base-flow", "baseline", "--base-revision", "3", "--name", "Converted",
                 "--version", "V1", "--owner", "package.team", "--output-dir", str(output)])
    return args, output


def response(flow=None, status="validated"):
    return io.BytesIO(json.dumps({"flow": flow or {"name": "Converted"},
                                 "report": {"status": status}}).encode())


@pytest.mark.parametrize("import_flow,status,endpoint", [(False, "validated", "preview"),
                                                       (True, "imported", "import")])
def test_default_preview_and_explicit_import(invocation, import_flow, status, endpoint):
    args, output = invocation
    with mock.patch("process_flow_api.package_conversion_cli.urlopen", return_value=response(status=status)) as post:
        assert main(args + (["--import"] if import_flow else [])) == 0
    post.assert_called_once()
    request = post.call_args.args[0]
    assert request.full_url == f"http://127.0.0.1:8000/api/package-conversions/{endpoint}"
    assert request.method == "POST"
    assert request.headers["Content-type"] == "application/json"
    body = json.loads(request.data)
    assert body["source"] == {"封膠": "EMC"}
    assert body["baseFlowId"] == "baseline" and body["baseRevision"] == 3
    assert body["metadata"] == {"name": "Converted", "version": "V1", "owner": "package.team", "description": ""}
    assert json.loads((output / "flow.json").read_text()) == {"name": "Converted"}
    assert json.loads((output / "report.json").read_text())["status"] == status
    assert not list(output.glob("*.tmp"))


def test_http_failure_preserves_available_report_and_never_retries(invocation, capsys):
    args, output = invocation
    report = {"status": "failed", "errors": [{"path": "/mold/thickness", "message": "Unknown unit"}]}
    error = HTTPError("http://local", 400, "Bad Request", {},
                      io.BytesIO(json.dumps({"message": "Unknown unit", "report": report}).encode()))
    with mock.patch("process_flow_api.package_conversion_cli.urlopen", side_effect=error) as post:
        assert main(args + ["--import"]) == 1
    post.assert_called_once()
    assert json.loads((output / "report.json").read_text()) == report
    assert not (output / "flow.json").exists()
    assert "HTTP 400: Unknown unit" in capsys.readouterr().err


def test_transport_failure_does_not_retry_or_create_outputs(invocation, capsys):
    args, output = invocation
    with mock.patch("process_flow_api.package_conversion_cli.urlopen", side_effect=URLError("offline")) as post:
        assert main(args) == 1
    post.assert_called_once()
    assert not output.exists()
    assert "offline" in capsys.readouterr().err


def test_malformed_source_rejected_before_request(invocation):
    args, output = invocation
    source = args[args.index("--source") + 1]
    Path(source).write_text("42")
    with mock.patch("process_flow_api.package_conversion_cli.urlopen") as post:
        assert main(args) == 1
    post.assert_not_called()
    assert not output.exists()


def test_source_root_array_is_preserved(invocation):
    args, _ = invocation
    source = Path(args[args.index("--source") + 1])
    source.write_text('[{"material": "EMC"}]')
    with mock.patch("process_flow_api.package_conversion_cli.urlopen", return_value=response()) as post:
        assert main(args) == 0
    assert json.loads(post.call_args.args[0].data)["source"] == [{"material": "EMC"}]


def test_failed_report_from_success_http_is_nonzero(invocation):
    args, output = invocation
    with mock.patch("process_flow_api.package_conversion_cli.urlopen", return_value=response(status="failed")):
        assert main(args) == 1
    assert json.loads((output / "report.json").read_text())["status"] == "failed"
    assert not (output / "flow.json").exists()


def test_output_cannot_replace_an_input(invocation):
    args, _ = invocation
    source_index = args.index("--source") + 1
    source = Path(args[source_index])
    collision = source.with_name("flow.json")
    collision.write_text(source.read_text())
    args[source_index] = str(collision)
    args[args.index("--output-dir") + 1] = str(source.parent)
    with mock.patch("process_flow_api.package_conversion_cli.urlopen") as post, pytest.raises(SystemExit):
        main(args)
    post.assert_not_called()
    assert json.loads(collision.read_text()) == {"封膠": "EMC"}
