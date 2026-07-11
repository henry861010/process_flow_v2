from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from .context import ProcessStepContext


class ProcessStepModule(Protocol):
    def execute(self, context: ProcessStepContext) -> Any:
        ...


class ModuleResolver(Protocol):
    def resolve(self, step_template: Mapping[str, Any]) -> ProcessStepModule:
        ...
