"""Schematic entry point, kept separate from engineering generator execution."""

from process_flow_schematic import SchematicRegistry

from .die_schematic import present_internal_matrix, present_schematic as present_die
from .lsi_schematic import present_adhesive, present_schematic as present_lsi
from .support_schematic import present_schematic as present_support
from .wafer_dmy_schematic import present_schematic as present_dummy


def register_presenters(registry: SchematicRegistry) -> None:
    for key in ("lsi.daf", "lsi.fow"):
        registry.register("body", present_adhesive, key=key)
    for key in (
        "soc.pass2", "soc.usg", "soc.elk",
        "hbm.pass2", "hbm.usg", "hbm.elk", "envelope",
        "lsi.usg", "lsi.fspm0", "lsi.bspm0", "lsi.prepm0",
    ):
        registry.register("body", present_internal_matrix, key=key)
    registry.register("container", present_dummy, key="wafer-dmy")
    registry.register("container", present_lsi, key="lsi")
    for key in ("dram", "soc", "soic", "hbm", "vrm", "cpo"):
        registry.register("container", present_die, key=key)
    for key in ("carrier", "carrier.panel", "carrier.wafer", "frame"):
        registry.register("container", present_support, key=key)
