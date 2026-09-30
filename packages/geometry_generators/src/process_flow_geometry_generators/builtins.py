"""Explicit registration of the generators shipped with Process Flow."""

from __future__ import annotations

from .dram import DramGenerator
from .hbm import HbmGenerator
from .lsi import LsiGenerator
from .registry import GeometryGeneratorRegistry
from .soc import SocGenerator


def register_builtin_generators(registry: GeometryGeneratorRegistry) -> None:
    for generator in (HbmGenerator(), DramGenerator(), SocGenerator(), LsiGenerator()):
        registry.register(generator)
