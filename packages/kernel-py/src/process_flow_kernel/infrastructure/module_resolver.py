from __future__ import annotations

import importlib
import re

PROCESS_PROGRAM_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class ProcessStepModuleResolver:
    def __init__(self, *, package_prefix="process_flow_steps", import_module=None):
        self._package_prefix = package_prefix
        self._import_module = import_module or importlib.import_module

    def module_specifier(self, step_template):
        if not step_template.get("id"):
            raise ValueError("Process step template is missing id")
        program = _validate_program_path(step_template)
        module_path = ".".join(segment.replace("-", "_") for segment in program.split("/"))
        return f"{self._package_prefix}.{module_path}"

    def resolve(self, step_template):
        specifier = self.module_specifier(step_template)
        try:
            module = self._import_module(specifier)
        except Exception as error:
            raise ValueError(
                f"Unable to load process step module for {step_template.get('id')} from {specifier}: {error}"
            ) from error
        if not hasattr(module, "execute") or not callable(module.execute):
            raise ValueError(f"Process step module for {step_template.get('id')} must expose execute(context)")
        return module


def _validate_program_path(step_template):
    program = step_template.get("program")
    if not isinstance(program, str) or program.strip() == "":
        raise ValueError(f"Process step template {step_template.get('id')} is missing program")
    if program != program.strip():
        raise ValueError(
            f"Process step template {step_template.get('id')} program must be an extensionless path"
        )
    if program.startswith("/") or program.startswith("\\") or re.match(r"^[A-Za-z]:[\\/]", program):
        raise ValueError(
            f"Process step template {step_template.get('id')} program must be relative to process package"
        )
    if program.endswith(".py") or program.endswith(".js"):
        raise ValueError(f"Process step template {step_template.get('id')} program must not include a file extension")
    segments = program.split("/")
    if any(segment == "" or segment == ".." or not PROCESS_PROGRAM_SEGMENT_RE.match(segment) for segment in segments):
        raise ValueError(
            f"Process step template {step_template.get('id')} program must be an extensionless path"
        )
    return program
