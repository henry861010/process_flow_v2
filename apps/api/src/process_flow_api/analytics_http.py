"""ASGI request accounting and allowlisted, structured operation summaries."""
from __future__ import annotations

import asyncio
import functools
import inspect
import time
import uuid
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from .analytics import current_origin, request_context, request_owner, utc_timestamp
from .repository import DuplicateItemError, NotFoundError, ResourceConflictError

OPERATIONS = {
    ("POST", "/api/process-flow-instances/{instance_id}/steps/{step_ref_id}/recipes"): "flow_instance.recipe_create",
    ("PUT", "/api/process-flow-instances/{instance_id}/steps/{step_ref_id}/active-recipe"): "flow_instance.recipe_activate",
    ("PUT", "/api/process-flow-instances/{instance_id}/input-bindings"): "flow_instance.bindings_update",
    ("POST", "/api/process-flow-templates"): "flow_template.create",
    ("PUT", "/api/process-flow-templates/{template_id}"): "flow_template.update",
    ("DELETE", "/api/process-flow-templates/{template_id}"): "flow_template.delete",
    ("POST", "/api/process-flow-template-instances"): "flow_template.create",
    ("POST", "/api/process-flow-instances"): "flow_instance.create",
    ("DELETE", "/api/process-flow-instances/{instance_id}"): "flow_instance.delete",
    ("POST", "/api/process-flow-instances/{instance_id}/execute"): "flow_instance.execute",
    ("POST", "/api/geometry-preview"): "flow.preview",
    ("POST", "/api/preview-sessions"): "flow.preview",
    ("POST", "/api/geometry-preview/step"): "geometry.preview",
    ("POST", "/api/geometry-generators/{generator_id}/preview"): "generator.preview",
    ("POST", "/api/geometry-materializations"): "geometry.materialize",
    ("POST", "/api/geometries"): "geometry.create",
    ("DELETE", "/api/geometries/{geometry_id}"): "geometry.delete",
    ("POST", "/api/mesh-control-sets/{set_id}/apply"): "mesh_control.apply",
    ("POST", "/api/geometry-preview/export-jobs"): "export",
    ("POST", "/api/geometry-preview/cdb-jobs"): "export",
    ("POST", "/api/export-jobs/{job_id}/cancel"): "export.cancel_request",
    ("POST", "/api/reset"): "data.reset",
    ("POST", "/api/reset-from-zip"): "data.import",
    ("GET", "/api/fixture-export"): "data.export",
    ("POST", "/api/process-step-templates"): "step_template.create",
    ("PUT", "/api/process-step-templates/{template_id}"): "step_template.update",
}
for _kind in ("template",):
    _base = f"/api/process-flow-{_kind}-drafts"
    for _method, _suffix, _action in (("POST", "", "create"), ("PUT", "/{draft_id}", "update"),
                                      ("DELETE", "/{draft_id}", "delete"), ("POST", "/{draft_id}/commit", "commit")):
        OPERATIONS[(_method, _base + _suffix)] = f"{_kind}_draft.{_action}"



def value(obj: Any, key: str, default: Any = None) -> Any:
    return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)


def text_value(obj: Any) -> str | None:
    return obj if isinstance(obj, str) and 0 < len(obj) <= 256 else None


def flow_summary(template: Any) -> dict[str, Any]:
    if template is None:
        return {}
    steps = value(template, "stepRefs", [])
    return {"flow_name": (value(template, "name", "") or "")[:256],
            "flow_version": (value(template, "version", "") or "")[:256],
            "step_count": len(steps), "edge_count": len(value(template, "flowEdges", [])),
            "input_count": len(value(template, "flowInputs", [])),
            "step_template_ids": sorted({identifier for step in steps
                if (identifier := text_value(value(step, "processStepTemplateId")))})[:256]}


def configuration_summary(configuration: Any) -> dict[str, Any]:
    if configuration is None:
        return {}
    configuration = value(configuration, "initialConfiguration", configuration) or {}
    bindings = value(configuration, "inputBindings", {})
    counts = {kind: 0 for kind in ("catalog", "embedded", "generator")}
    generators: set[tuple[str, int]] = set()
    for binding in bindings.values():
        kind = value(binding, "kind")
        if kind in counts:
            counts[kind] += 1
        if kind == "generator":
            identifier = text_value(value(binding, "generatorId"))
            version = value(binding, "generatorVersion")
            if identifier and isinstance(version, int):
                generators.add((identifier, version))
    configurations = value(configuration, "stepConfigurations", {})
    return {"configured_step_count": sum(bool(value(step, "parameterValues", {})) or bool(value(step, "activeRecipeId"))
                                          for step in configurations.values()),
            "binding_counts": counts,
            "generators": [{"id": identifier, "version": version}
                           for identifier, version in sorted(generators)[:256]]}


def error_code(error: BaseException | None = None, status: int | None = None) -> str | None:
    if isinstance(error, RequestValidationError) or status == 422:
        return "VALIDATION_ERROR"
    if isinstance(error, NotFoundError) or status == 404:
        return "NOT_FOUND"
    if isinstance(error, (DuplicateItemError, ResourceConflictError)) or status == 409:
        return "RESOURCE_CONFLICT"
    if isinstance(error, ValueError) or status == 400:
        return "INVALID_INPUT"
    if status == 503 or (error is not None and type(error).__name__ == "PreviewCapacityError"):
        return "CAPACITY_EXCEEDED"
    if error is not None:
        code = getattr(error, "status_code", None)
        if isinstance(code, int):
            return error_code(status=code)
        return "INTERNAL_ERROR"
    return "HTTP_ERROR" if status is not None and status >= 400 else None


def usage_summary(store: Any, route: str, arguments: dict[str, Any]) -> dict[str, Any]:
    body = arguments.get("body")
    properties: dict[str, Any] = {}
    result: dict[str, Any] = {"source_kind": "system", "properties": properties}
    template = instance = None
    if "-drafts" in route:
        kind = "template" if "template-drafts" in route else "instance"
        identifier = arguments.get("draft_id")
        draft = store.get_editor_draft(kind, identifier) if identifier else body
        result["source_kind"] = f"{kind}_draft"
        result["flow_template_id"] = text_value(value(draft, "processFlowTemplateId"))
        properties.update(draft_id=identifier, draft_kind=kind, revision=value(draft, "revision"),
                          draft_name=(value(draft, "name", "") or "")[:256])
        if route.endswith("/commit"):
            payload = value(body, "processFlowTemplate" if kind == "template" else "processFlowInstance")
            template = payload if kind == "template" else store.get_process_flow_template(value(payload, "processFlowTemplateId"))
            properties.update(flow_summary(template))
            instance = value(body, "processFlowInstance")
            if instance is not None:
                properties.update(configuration_summary(instance))
                properties.update(instance_name=(value(instance, "name", "") or "")[:256],
                                  instance_version=text_value(value(instance, "version")))
        return result
    if "/process-flow-template" in route:
        template = value(body, "processFlowTemplate", body)
        result["source_kind"] = "template"
        if route.endswith("/{template_id}"):
            template = body or store.get_process_flow_template(arguments.get("template_id"))
        result["flow_template_id"] = text_value(value(template, "id"))
        if route == "/api/process-flow-template-instances":
            instance = value(body, "processFlowInstance")
    elif "/process-flow-instances" in route:
        instance = store.get_process_flow_instance(arguments.get("instance_id")) if arguments.get("instance_id") else body
        result["source_kind"] = "instance"
    if instance is not None:
        result["flow_instance_id"] = text_value(value(instance, "id"))
        properties.update(instance_name=(value(instance, "name", "") or "")[:256],
                          instance_version=text_value(value(instance, "version")))
    resource = instance
    if resource is not None:
        identifier = text_value(value(resource, "processFlowTemplateId"))
        if template is None and identifier:
            template = store.get_process_flow_template(identifier)
        if template is not None:
            result["flow_template_id"] = text_value(value(template, "id"))
        properties.update(configuration_summary(resource))
    if route in ("/api/geometry-preview", "/api/preview-sessions"):
        inline = value(body, "flowTemplate")
        identifier = text_value(value(body, "processFlowTemplateId"))
        template = inline if inline is not None else store.get_process_flow_template(identifier) if identifier else None
        result["source_kind"] = "inline_draft" if inline is not None else "template"
        # Inline topology is never attributed to a saved template merely by its id.
        result["flow_template_id"] = text_value(value(template, "id")) if inline is None else None
        properties.update(configuration_summary(value(body, "configuration")))
        target = value(body, "target")
        properties.update(target_kind=text_value(value(target, "type")),
                          target_step_ref_id=text_value(value(target, "stepRefId")),
                          target_flow_input_id=text_value(value(target, "flowInputId")),
                          target_port_id=text_value(value(target, "outputPortId")))
    properties.update(flow_summary(template))
    if route.startswith("/api/geometry") or route.startswith("/api/mesh-control"):
        if result["source_kind"] == "system":
            result["source_kind"] = "geometry"
    if arguments.get("generator_id"):
        properties.update(generator_id=text_value(arguments["generator_id"]),
                          generator_version=value(body, "generatorVersion"))
    if arguments.get("set_id"):
        properties["mesh_control_set_id"] = text_value(arguments["set_id"])
    if route.startswith("/api/process-step-templates"):
        result["source_kind"] = "step_template"
        if body is None:
            body = store.get_process_step_template(arguments.get("template_id"))
        properties.update(step_template_id=text_value(value(body, "id", arguments.get("template_id"))),
                          step_name=(value(body, "name", "") or "")[:256],
                          step_version=text_value(value(body, "version")))
    if route == "/api/geometries":
        properties.update(geometry_name=(value(body, "name", "") or "")[:256],
                          geometry_type=text_value(value(body, "entityType")))
    if route == "/api/geometries/{geometry_id}":
        geometry = store.get_geometry(arguments["geometry_id"])
        result["source_kind"] = "geometry"
        properties.update(geometry_id=text_value(arguments["geometry_id"]),
                          geometry_name=(value(geometry, "name", "") or "")[:256],
                          geometry_type=text_value(value(geometry, "entityType")))
    if route in ("/api/geometry-preview/export-jobs", "/api/geometry-preview/cdb-jobs"):
        properties["export_format"] = value(body, "kind", "cdb")
    context = value(body, "analyticsContext")
    if context is not None:
        apply_context(store, context, result, expected_template_id=text_value(value(body, "processFlowTemplateId")))
    return result


def apply_context(store: Any, context: Any, result: dict[str, Any], *, expected_template_id: str | None = None) -> None:
    """Only retain existing, mutually consistent references. Context is attribution,
    not proof that a draft or exported geometry equals the saved resource.
    """
    if value(context, "sourceKind") == "inline_draft":
        result["source_kind"] = "inline_draft"
        identifier = result.pop("flow_template_id", None)
        if identifier:
            result["properties"]["base_flow_template_id"] = identifier
    instance_id = text_value(value(context, "flowInstanceId"))
    template_id = text_value(value(context, "flowTemplateId"))
    instance = store.get_process_flow_instance(instance_id) if instance_id else None
    candidates = {identifier for identifier in (template_id,
        value(instance, "processFlowTemplateId")) if identifier}
    confirmed = (not instance_id or instance is not None) and len(candidates) == 1
    template = store.get_process_flow_template(next(iter(candidates))) if confirmed else None
    if (template is None or (expected_template_id and expected_template_id != template["id"])
            or (result.get("flow_template_id") and result["flow_template_id"] != template["id"])):
        result["properties"]["context_confirmed"] = False
        return
    result["properties"]["context_confirmed"] = True
    if result["source_kind"] == "inline_draft":
        result["properties"]["base_flow_template_id"] = template["id"]
    else:
        result.update(flow_template_id=template["id"],
                      flow_instance_id=instance_id)
        result["source_kind"] = "instance" if instance else "template"
        result["properties"].update(flow_summary(template))


class AnalyticsRoute(APIRoute):
    def __init__(self, path: str, endpoint: Any, **kwargs: Any) -> None:
        methods = kwargs.get("methods") or ["GET"]
        event_name = next((OPERATIONS[(method, path)] for method in methods if (method, path) in OPERATIONS), None)
        if event_name:
            original = endpoint

            @functools.wraps(original)
            async def instrumented(*args: Any, **arguments: Any) -> Any:
                context = request_context.get()
                if context is None:
                    return await original(*args, **arguments)
                recorder = context["recorder"]
                try:
                    summary = usage_summary(context["store"], path, arguments)
                except Exception:
                    summary = {"source_kind": "system", "properties": {}}
                context["usage"] = summary
                context["usage_recorded"] = True
                started = time.monotonic()
                try:
                    result = await original(*args, **arguments)
                except BaseException as error:
                    if isinstance(error, (Exception, asyncio.CancelledError)):
                        recorder.event(current_origin() or {}, event_name=event_name, outcome="failure",
                                       duration_ms=int((time.monotonic() - started) * 1000),
                                       error_code="REQUEST_INTERRUPTED" if isinstance(error, asyncio.CancelledError) else error_code(error))
                        if path == "/api/process-flow-template-instances":
                            recorder.event(current_origin() or {}, event_name="flow_instance.create", outcome="failure",
                                           error_code=error_code(error))
                    raise
                try:
                    self._finish(recorder, context, path, event_name, summary, result, started)
                except Exception:
                    recorder._loss(1, context["common"])
                return result

            instrumented.__signature__ = inspect.signature(original, eval_str=True)
            endpoint = instrumented
        super().__init__(path, endpoint, **kwargs)

    @staticmethod
    def _finish(recorder: Any, context: dict[str, Any], path: str, event_name: str,
                summary: dict[str, Any], result: Any, started: float) -> None:
        if event_name == "export":
            return  # The manager records accepted/started/finished against the job id.
        properties = summary["properties"]
        if event_name == "flow_template.create":
            template = value(result, "processFlowTemplate", result)
            summary["flow_template_id"] = text_value(value(template, "id"))
        if event_name == "flow_instance.create" or path == "/api/process-flow-template-instances":
            instance = value(result, "processFlowInstance", result)
            summary["flow_instance_id"] = text_value(value(instance, "id"))
        if event_name == "generator.preview":
            properties["generator_version"] = value(result, "generatorVersion")
            if value(result, "valid") is False:
                recorder.event(current_origin() or {}, event_name=event_name, outcome="failure",
                               error_code="VALIDATION_ERROR", duration_ms=int((time.monotonic()-started)*1000))
                return
        if event_name == "geometry.materialize":
            generation = value(value(result, "geometryEntityJson"), "generation")
            if generation:
                properties.update(generator_id=text_value(value(generation, "generatorId")),
                                  generator_version=value(generation, "schemaVersion"))
        if event_name == "geometry.create":
            properties["geometry_id"] = text_value(value(result, "id"))
        if event_name == "mesh_control.apply":
            properties["mesh_control_set_version"] = value(result, "setVersion")
        if "_draft." in event_name:
            kind, action = event_name.split("_draft.")
            if action in ("create", "update"):
                properties.update(draft_id=value(result, "id"), revision=value(result, "revision"))
            if action == "commit":
                resource = value(result, "processFlowTemplate", result) if kind == "template" else result
                summary[f"flow_{kind}_id"] = text_value(value(resource, "id"))
                combined_instance = value(result, "processFlowInstance")
                if combined_instance is not None:
                    summary["flow_instance_id"] = text_value(value(combined_instance, "id"))
                recorder.event(current_origin() or {}, event_name=f"flow_{kind}.create", outcome="success")
                if combined_instance is not None:
                    recorder.event(current_origin() or {}, event_name="flow_instance.create", outcome="success")
        if event_name in ("data.reset", "data.import"):
            properties["new_dataset_id"] = context["store"].dataset_id
        recorder.event(current_origin() or {}, event_name=event_name, outcome="success",
                       duration_ms=int((time.monotonic() - started) * 1000))
        if path == "/api/process-flow-template-instances":
            summary["source_kind"] = "instance"
            recorder.event(current_origin() or {}, event_name="flow_instance.create", outcome="success")

    def get_route_handler(self) -> Any:
        original = super().get_route_handler()

        async def handler(request: Request) -> Any:
            try:
                return await original(request)
            except RequestValidationError:
                context = request_context.get()
                name = OPERATIONS.get((request.method, self.path))
                if context is not None and name and not context.get("usage_recorded"):
                    context["usage"] = {"source_kind": "system", "properties": {}}
                    context["recorder"].event(current_origin() or {}, event_name=name,
                                               outcome="failure", error_code="VALIDATION_ERROR")
                    if self.path == "/api/process-flow-template-instances":
                        context["recorder"].event(current_origin() or {}, event_name="flow_instance.create",
                                                   outcome="failure", error_code="VALIDATION_ERROR")
                raise
        return handler


def traffic_kind(method: str, route: str) -> str:
    if route == "/api/dashboard/jobs" and method == "GET":
        return "polling"
    if route.startswith("/api/export-jobs") and method == "GET":
        return "polling"
    if route.startswith("/api/preview-sessions/") and method == "GET":
        return "asset"
    if route in ("/api/health", "/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json") or method == "OPTIONS":
        return "system"
    return "operation"


class AnalyticsMiddleware:
    def __init__(self, app: Any, *, recorder: Any, store: Any,
                 allowed_origins: list[str] | None = None) -> None:
        self.app, self.recorder, self.store = app, recorder, store
        self.allowed_origins = frozenset(allowed_origins or [])

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.monotonic()
        request_id = str(uuid.uuid4())
        common = self.recorder.common(self.store.dataset_id)
        started_at = utc_timestamp()
        scope.setdefault("state", {})["request_id"] = request_id
        context = {"scope": scope, "common": common, "request_id": request_id,
                   "recorder": self.recorder, "store": self.store}
        token = request_context.set(context)
        status = None
        response_bytes = 0
        request_bytes = 0
        consumed = False
        response_started = False
        finished = None
        completion = "completed"
        exception = None

        async def counted_receive() -> Any:
            nonlocal request_bytes, consumed, completion
            message = await receive()
            if message["type"] == "http.request":
                consumed = True
                request_bytes += len(message.get("body", b""))
            elif message["type"] == "http.disconnect" and finished is None:
                completion = "disconnected"
            return message

        async def counted_send(message: dict[str, Any]) -> None:
            nonlocal status, response_bytes, response_started, finished, completion
            if message["type"] == "http.response.start":
                status = message["status"]
                message = {**message, "headers": [
                    (key, val) for key, val in message.get("headers", []) if key.lower() != b"x-request-id"
                ] + [(b"x-request-id", request_id.encode("ascii"))]}
                response_started = True
            elif message["type"] == "http.response.body":
                response_bytes += len(message.get("body", b""))
            try:
                await send(message)
            except OSError:
                completion = "disconnected"
                raise
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                finished = time.monotonic()

        try:
            await self.app(scope, counted_receive, counted_send)
        except asyncio.CancelledError:
            completion = "disconnected"
            raise
        except Exception as error:
            exception = error
            if completion != "disconnected":
                completion = "exception"
            if not response_started and completion != "disconnected":
                # Send the same opaque default 500 response, with correlation header.
                await counted_send({"type": "http.response.start", "status": 500,
                                    "headers": self._error_headers(scope)})
                await counted_send({"type": "http.response.body", "body": b"Internal Server Error"})
            raise
        finally:
            try:
                route_object = scope.get("route")
                route = getattr(route_object, "path", None) or "__unmatched__"
                code = error_code(exception, status)
                if completion == "disconnected":
                    code = "REQUEST_INTERRUPTED"
                record = {**common, "occurred_at": utc_timestamp(), "request_owner": request_owner(scope),
                          "request_id": request_id, "started_at": started_at,
                          "method": scope["method"], "route": route, "status_code": status,
                          "duration_ms": max(0, int(((finished or time.monotonic())-started)*1000)),
                          "request_bytes": request_bytes if consumed else self._content_length(scope),
                          "response_bytes": response_bytes if response_started else None,
                          "traffic_kind": traffic_kind(scope["method"], route),
                          "completion_state": completion, "error_code": code}
                self.recorder.record_request(record)
            except Exception:
                self.recorder._loss(1, common)
            finally:
                request_context.reset(token)

    def _error_headers(self, scope: dict[str, Any]) -> list[tuple[bytes, bytes]]:
        # The error is caught outside CORS so its fallback response needs the same
        # configured origin policy. No caller header is persisted in analytics.
        headers = [(b"content-type", b"text/plain; charset=utf-8")]
        origin = next((val for key, val in scope.get("headers", []) if key.lower() == b"origin"), None)
        if origin is not None and ("*" in self.allowed_origins or origin.decode("latin-1") in self.allowed_origins):
            headers.extend([(b"access-control-allow-origin", origin),
                            (b"access-control-allow-credentials", b"true"),
                            (b"access-control-expose-headers", b"X-Request-Id"),
                            (b"vary", b"Origin")])
        return headers

    @staticmethod
    def _content_length(scope: dict[str, Any]) -> int | None:
        for key, val in scope.get("headers", []):
            if key.lower() == b"content-length":
                try:
                    size = int(val)
                    return size if size >= 0 else None
                except ValueError:
                    return None
        return None
