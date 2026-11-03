"""Opt-in component inventory effects; never imported by process execution.

Preservation describes a conservative inventory for horizontal reservation, not
future geometry. Removal operations can leave empty reserved slots. New programs
must explicitly describe their component effect before lookahead crosses them.
"""

_PRESERVE_COMPONENTS = frozenset({
    "grinding/grinding", "saw/saw", "carrier/debond",
    "flip/flip", "uf/under_fill", "bump/uBump_formation",
    "bump/bga_bump_formation", "bump/c4_bump_formation", "tmv/tmv",
    "frame/demount", "joint/mr_joint", "joint/tcb_joint",
})
_ADD_ROOT_BODY = frozenset({
    "layer/molding", "layer/ecl", "layer/daf", "layer/fow", "layer/rdl",
    "carrier/bond", "frame/mount",
})


def component_effect(program: str) -> str | None:
    if program == "pnp/pnp":
        return "place"
    if program in _ADD_ROOT_BODY:
        return "add_root_body"
    if program in _PRESERVE_COMPONENTS:
        return "preserve"
    return None
