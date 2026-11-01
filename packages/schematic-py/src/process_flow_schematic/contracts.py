"""Presentation contracts. No process programs or materialization dependencies."""
from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, NotRequired, TypedDict

SCHEMATIC_VERSION = 1


class SchematicRectangle(TypedDict):
    x: float
    y: float
    width: float
    height: float


class SchematicClip(SchematicRectangle):
    exclusions: list[SchematicRectangle]


class SchematicShape(TypedDict):
    id: str
    itemId: str
    kind: Literal["rect", "circle", "path"]
    fill: str
    stroke: str
    strokeWidth: float
    x: NotRequired[float]
    y: NotRequired[float]
    width: NotRequired[float]
    height: NotRequired[float]
    cx: NotRequired[float]
    cy: NotRequired[float]
    r: NotRequired[float]
    points: NotRequired[list[list[float]]]
    closed: NotRequired[bool]
    clip: NotRequired[SchematicClip]


class SchematicItem(TypedDict):
    id: str
    label: str
    material: str
    groupLabel: str
    sourceIds: list[str]
    zMin: float
    zMax: float
    thickness: float


class SchematicComponent(SchematicRectangle):
    id: str
    label: str
    sourceIds: list[str]


class SchematicDocument(TypedDict):
    schemaVersion: Literal[1]
    unit: str
    viewBox: list[float]
    shapes: list[SchematicShape]
    items: list[SchematicItem]
    components: list[SchematicComponent]
    totalThickness: float
    notes: list[str]
    warnings: list[str]


@dataclass(frozen=True)
class Bounds:
    x_min: float
    y_min: float
    z_min: float
    x_max: float
    y_max: float
    z_max: float

    @property
    def thickness(self) -> float:
        return self.z_max - self.z_min


@dataclass(frozen=True)
class Primitive:
    """Local fractions; circle radius uses local height.

    repeat_x fills the display width with equally spaced circles or path motifs.
    For repeated paths, r sets the target half-width relative to display height;
    points describe one motif in local fractions.
    """
    kind: str = "rect"
    x: float = 0
    y: float = 0
    width: float = 1
    height: float = 1
    cx: float = 0.5
    cy: float = 0.5
    r: float = 0.4
    points: tuple[tuple[float, float], ...] = ()
    fill: str | None = None
    stroke: str | None = None
    stroke_width: float = 0.8
    closed: bool = False
    repeat_x: bool = False


@dataclass(frozen=True)
class ComponentHint:
    label: str
    representative_count: int = 1
    placement: str = "center"


@dataclass(frozen=True)
class SchematicContext:
    structure: Mapping[str, Any]
    node: Mapping[str, Any]
    container: Mapping[str, Any]
    ancestors: tuple[Mapping[str, Any], ...]
    kind: str
    bounds: Bounds
    unit: str
    # Memoized read-only queries live only for this composition, never globally.
    query: Callable[[Any, Callable[[], Any]], Any] = field(default=lambda key, build: build(), repr=False, compare=False)


@dataclass(frozen=True)
class SchematicPart:
    label: str
    fill: str = "#cbd5d8"
    primitives: tuple[Primitive, ...] = ()
    component: ComponentHint | None = None
    layout: str = "node"
    eligible_container_ids: tuple[str, ...] = ()
    occluded_by: tuple[str, ...] = ()
    # Measurements come from source_id; display bounds remain relative to the
    # emitting node's component. Neither changes the physical source geometry.
    source_id: str | None = None
    display_bounds: Bounds | None = None
    # Local to one emitting node: members share horizontal repetition metrics.
    repeat_group: str | None = None


Presenter = Callable[[SchematicContext], list[SchematicPart]]


class SchematicRegistry:
    def __init__(self) -> None:
        self._presenters: dict[tuple[str, str | None], Presenter] = {}

    def register(self, kind: str, presenter: Presenter, key: str | None = None) -> None:
        selector = (kind, key)
        if selector in self._presenters:
            raise ValueError(f"Duplicate schematic presenter selector: {selector}")
        self._presenters[selector] = presenter

    def resolve(self, kind: str, key: str | None) -> Presenter | None:
        return self._presenters.get((kind, key)) or self._presenters.get((kind, None))


def slab(label: str, fill: str = "#cbd5d8") -> SchematicPart:
    return SchematicPart(label=label, fill=fill, primitives=(Primitive(),))
