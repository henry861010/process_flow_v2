from __future__ import annotations

from typing import Literal, cast, get_args


BumpStage = Literal["deposited", "reflowed", "joined"]
BUMP_STAGES = get_args(BumpStage)


def validate_bump_stage(value: object, path: str = "bump.stage") -> BumpStage:
    if not isinstance(value, str) or value not in BUMP_STAGES:
        raise ValueError(f"{path}: expected deposited, reflowed or joined")
    return cast(BumpStage, value)
