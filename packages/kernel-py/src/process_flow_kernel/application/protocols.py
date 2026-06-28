from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from .context import ProcessStepContext


class Repository(Protocol):
    def get_by_id(self, id_: str) -> Mapping[str, Any] | None:
        ...


class ProcessStepModule(Protocol):
    def execute(self, context: ProcessStepContext) -> Any:
        ...


class ModuleResolver(Protocol):
    def resolve(self, step_template: Mapping[str, Any]) -> ProcessStepModule:
        ...
