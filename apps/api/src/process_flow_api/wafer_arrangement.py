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
    import gdstk

    path = Path(output_path.strip())
    if not path.is_absolute() or path.suffix.lower() != ".gds":
        raise ValueError("GDS output path must be an absolute path with a .gds extension.")
    path = path.with_suffix(".gds")
    if not path.parent.is_dir():
        raise ValueError("GDS output folder must already exist and be a directory.")
    if path.is_dir():
        raise ValueError("GDS output path is a directory.")
    library = gdstk.Library(name="WAFER_ARRANGEMENT", unit=1e-6, precision=1e-9)
    cell = library.new_cell("WAFER_ARRANGEMENT")
    for x0, y0, x1, y1 in result["cowRectangles"]:
        cell.add(gdstk.rectangle((x0, y0), (x1, y1), layer=100, datatype=100))
    for layer in result["dummyLayers"]:
        for x0, y0, x1, y1 in layer["rectangles"]:
            cell.add(gdstk.rectangle((x0, y0), (x1, y1), layer=413, datatype=layer["datatype"]))
    for layer in result.get("dieLayers", []):
        for x0, y0, x1, y1 in layer["rectangles"]:
            cell.add(gdstk.rectangle((x0, y0), (x1, y1), layer=888, datatype=layer["datatype"]))
    fd, name = tempfile.mkstemp(prefix=f".{path.stem}-", suffix=".gds", dir=path.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        library.write_gds(temporary)
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
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"Unable to write GDS: {error}") from error
    return {"outputPath": str(path), "cowCount": result["cowCount"],
            "dummyCounts": [layer["count"] for layer in result["dummyLayers"]],
            "dieCounts": result["dieCounts"],
            "totalRectangles": result["totalRectangles"], "warnings": result["warnings"]}
