from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import Field
from process_flow_geometry_generators.wafer_arrangement import (
    ArrangementModel,
    ArrangementError,
    DB_UNITS_PER_UM,
    DieSize,
    WaferArrangementParameters,
    arrange_wafer,
)
from process_flow_geometry_generators.cow_die_layout import place_cow_dies, preview_cow_dies

from .export_file_permissions import set_export_file_permissions

router = APIRouter(prefix="/api/wafer-arrangement", tags=["wafer-arrangement"])


class WaferGdsExportRequest(WaferArrangementParameters):
    outputPath: str = Field(min_length=1)
    dieJson: Any = None


class CowDiePreviewRequest(ArrangementModel):
    dieJson: Any = Field(...)
    cowSize: DieSize | None = None


def _arrange(parameters: WaferArrangementParameters) -> dict:
    try:
        return arrange_wafer(parameters)
    except ArrangementError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/preview")
def preview_wafer_arrangement(body: WaferArrangementParameters):
    return _arrange(body)


@router.post("/preview-dies")
def preview_die_layout(body: CowDiePreviewRequest):
    try:
        return preview_cow_dies(body.dieJson, body.cowSize)
    except ArrangementError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def export_arrangement_gds(result: dict, output_path: str) -> Path:
    """Write beside the target, then replace atomically; never remove an old file first."""
    import klayout.db as kdb

    path = Path(output_path.strip())
    if not path.is_absolute() or path.suffix.lower() != ".gds":
        raise ValueError("GDS output path must be an absolute path with a .gds extension.")
    path = path.with_suffix(".gds")
    if not path.parent.is_dir():
        raise ValueError("GDS output folder must already exist and be a directory.")
    if path.is_dir():
        raise ValueError("GDS output path is a directory.")
    layout = kdb.Layout()
    layout.dbu = 1 / DB_UNITS_PER_UM
    cell = layout.create_cell("WAFER_ARRANGEMENT")
    groups = [(100, 100, result["cowRectangles"])]
    groups.extend((413, layer["datatype"], layer["rectangles"]) for layer in result["dummyLayers"])
    groups.extend((888, layer["datatype"], layer["rectangles"]) for layer in result.get("dieLayers", []))
    for layer, datatype, rectangles in groups:
        shapes = cell.shapes(layout.layer(layer, datatype))
        for rectangle in rectangles:
            # Coordinates already lie on the arrangement engine's integer nm grid.
            shapes.insert(kdb.Box(*(round(value * DB_UNITS_PER_UM) for value in rectangle)))
    options = kdb.SaveLayoutOptions()
    options.format = "GDS2"
    options.libname = "WAFER_ARRANGEMENT"
    options.gds2_user_units = 1.0  # Micrometers; layout.dbu provides the 1 nm precision.
    fd, name = tempfile.mkstemp(prefix=f".{path.stem}-", suffix=".gds", dir=path.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        layout.write(str(temporary), options)
        set_export_file_permissions(temporary)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


@router.post("/export-gds")
def export_wafer_arrangement(body: WaferGdsExportRequest):
    parameters = WaferArrangementParameters.model_validate(body.model_dump(exclude={"outputPath", "dieJson"}))
    result = _arrange(parameters)
    if not result["cowCount"]:
        raise HTTPException(status_code=422, detail="GDS export requires at least one complete COW.")
    try:
        result = place_cow_dies(result, body.dieJson)
        path = export_arrangement_gds(result, body.outputPath)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (OSError, RuntimeError) as error:
        raise HTTPException(status_code=500, detail=f"Unable to write GDS: {error}") from error
    return {"outputPath": str(path), "cowCount": result["cowCount"],
            "dummyCounts": [layer["count"] for layer in result["dummyLayers"]],
            "dieCounts": result["dieCounts"],
            "totalRectangles": result["totalRectangles"], "warnings": result["warnings"]}
