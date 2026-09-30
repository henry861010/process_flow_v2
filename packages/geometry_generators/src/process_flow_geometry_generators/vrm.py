from __future__ import annotations

from .contracts import GeneratorEvaluation, JsonObject
from .soc import SocGenerator


class VrmGenerator(SocGenerator):
    def definition(self) -> JsonObject:
        definition = super().definition()
        definition.update(
            {
                "id": "vrm",
                "label": "VRM generator",
                "description": "Build a single VRM die box with configurable thickness and material.",
                "category": "die.vrm",
            }
        )
        definition["defaultParameters"]["material"] = "Si-VRM"
        return definition

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        if self.validate(parameters):
            raise ValueError("Cannot build VRM geometry from invalid parameters")
        evaluation = super().evaluate(parameters)
        root = evaluation.geometry_structure["root"]
        root["id"] = "container:vrm-root"
        root["key"] = "vrm"
        root["bodies"][0]["id"] = "body:vrm-envelope"
        return evaluation
