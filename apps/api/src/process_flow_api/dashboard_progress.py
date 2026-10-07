"""Public progress descriptions from the bundled export workers.

Only fixed text and numeric progress templates are published. Unknown worker
messages remain available through the existing client-specific job endpoint.
"""

from __future__ import annotations

import re


_MESSAGES_BY_STAGE: dict[str, frozenset[str]] = {
    "preparing": frozenset({"Preparing export files."}),
    "validating": frozenset({"Checking geometry input."}),
    "analyzing_geometry": frozenset({
        "Analyzing CAD geometry.", "Analyzing geometry patterns.",
    }),
    "building_2d_mesh": frozenset({"Generating base grid."}),
    "building_3d_mesh": frozenset({"Building 3D mesh layers."}),
    "building_cad_model": frozenset({"Building CAD model.", "Converting CAD bodies."}),
    "writing_output": frozenset({
        "Writing JSON document.", "JSON document written.",
        "Writing STEP output.", "STEP output written.",
        "Writing CDB output.", "CDB output written.",
        "Writing CDB nodes.", "Writing CDB elements.",
        "Writing CDB element node counts.", "Writing CDB element types.",
        "Writing CDB type table.", "Writing CDB element real ids.",
        "Writing CDB real table.", "Writing CDB element section ids.",
        "Writing CDB section table.", "Writing CDB element components.",
        "Writing CDB component table.",
    }),
    "finalizing": frozenset({"Finalizing output file."}),
}
_NUMERIC_MESSAGES_BY_STAGE: dict[str, re.Pattern[str]] = {
    "building_2d_mesh": re.compile(
        r"(?:Imprinting|Imprinted|Extending|Extended) feature [0-9]+ of [0-9]+\."
    ),
    "building_3d_mesh": re.compile(
        r"(?:Assigning feature [0-9]+ of [0-9]+ in layer [0-9]+ of [0-9]+|"
        r"Built layer [0-9]+ of [0-9]+)\."
    ),
    "building_cad_model": re.compile(r"Converted body [0-9]+ of [0-9]+\."),
}


def public_progress_message(stage: str, message: str | None) -> str | None:
    if message is None or len(message) > 256:
        return None
    if message in _MESSAGES_BY_STAGE.get(stage, ()):
        return message
    pattern = _NUMERIC_MESSAGES_BY_STAGE.get(stage)
    if pattern is not None and pattern.fullmatch(message):
        return message
    return None
