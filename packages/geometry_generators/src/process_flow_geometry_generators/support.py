"""Single-layer carrier and frame-tape generators with existing semantic keys."""

from __future__ import annotations

import math

from .contracts import GeneratorEvaluation, JsonObject


class _SupportGenerator:
    generator_id: str
    label: str
    description: str
    category: str
    entity_type: str
    body_key: str
    layer: str
    defaults: JsonObject
    circular: bool = True

    @property
    def _size_fields(self) -> list[tuple[str, str]]:
        return [("diameter", "Diameter")] if self.circular else [("packageX", "X"), ("packageY", "Y")]

    def definition(self) -> JsonObject:
        thickness_id = f"{self.layer}Thickness"
        material_id = f"{self.layer}Material"
        layer_label = self.layer.capitalize()
        size_definitions = [
            self._number_definition(field, name, positive=True)
            for field, name in self._size_fields
        ]
        return {
            "schemaVersion": 2,
            "id": self.generator_id,
            "version": 1,
            "label": self.label,
            "description": self.description,
            "uiPlacements": ["templateGeometryLibrary", "flowInputPicker"],
            "entityType": self.entity_type,
            "category": self.category,
            "icon": self.category,
            "adaptationContract": {
                "adapterId": "rigid" if self.circular else "box-rescale",
                "adapterVersion": 1,
                "parameters": {},
            },
            "defaultParameters": dict(self.defaults),
            "parameterDefinitions": [
                *size_definitions,
                self._number_definition(thickness_id, f"{layer_label} thk"),
                {
                    "id": material_id,
                    "name": f"{layer_label} material",
                    "description": "",
                    "valueType": "materialRef",
                    "controlType": "text",
                    "required": True,
                    "validation": {"minLength": 1},
                },
            ],
            "parameterGroups": [
                {"id": "size", "label": "Size", "parameterIds": [field for field, _ in self._size_fields]},
                {"id": self.layer, "label": layer_label, "parameterIds": [thickness_id, material_id]},
            ],
            "previewViews": ["top", "cross-section-x"],
        }

    @staticmethod
    def _number_definition(field: str, name: str, *, positive: bool = False) -> JsonObject:
        validation: JsonObject = {"min": 0}
        if positive:
            validation["exclusiveMin"] = True
        return {
            "id": field,
            "name": name,
            "description": "",
            "valueType": "float",
            "controlType": "number",
            "required": True,
            "unit": "um",
            "validation": validation,
        }

    def validate(self, parameters: JsonObject) -> JsonObject:
        errors: JsonObject = {}
        thickness_id = f"{self.layer}Thickness"
        for field, name in [*self._size_fields, (thickness_id, f"{self.layer.capitalize()} thickness")]:
            value = parameters.get(field)
            positive = field != thickness_id
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or (value <= 0 if positive else value < 0)
            ):
                limit = "greater than 0" if positive else "greater than or equal to 0"
                errors[field] = f"{name} must be a finite number {limit}."
        material_id = f"{self.layer}Material"
        material = parameters.get(material_id)
        if not isinstance(material, str) or not material.strip():
            errors[material_id] = f"{self.layer.capitalize()} material is required."
        return errors

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        if self.validate(parameters):
            raise ValueError(f"Cannot build {self.generator_id} geometry from invalid parameters")
        thickness_id = f"{self.layer}Thickness"
        material_id = f"{self.layer}Material"
        normalized = {
            field: float(parameters[field])
            for field in [*(field for field, _ in self._size_fields), thickness_id]
        }
        normalized[material_id] = parameters[material_id].strip()
        thickness = normalized[thickness_id]
        if self.circular:
            x = y = normalized["diameter"]
            geometry = {
                "type": "CylinderGeometry",
                "center": [0, 0, -thickness / 2],
                "bottom_radius": x / 2,
                "thk": thickness,
            }
        else:
            x, y = normalized["packageX"], normalized["packageY"]
            geometry = {
                "type": "BoxGeometry",
                "bottom_left": [-x / 2, -y / 2, -thickness / 2],
                "top_right": [x / 2, y / 2, -thickness / 2],
                "thk": thickness,
            }
        return GeneratorEvaluation(
            normalized_parameters=normalized,
            computed_parameters={"packageX": x, "packageY": y, "totalThickness": thickness},
            geometry_structure={
                "schemaVersion": "1.0.0",
                "unitSystem": "um",
                "root": {
                    "id": f"container:{self.generator_id}-root",
                    "key": self.category,
                    "bodies": [{
                        "id": f"body:{self.generator_id}-{self.layer}",
                        "key": self.body_key,
                        "geometry": geometry,
                        "material": normalized[material_id],
                    }],
                    "vias": [],
                    "circuits": [],
                    "bumps": [],
                    "children": [],
                },
            },
        )


class WaferCarrierGenerator(_SupportGenerator):
    generator_id = "wafer-carrier"
    label = "Wafer carrier generator"
    description = "Build a circular wafer carrier with editable diameter, thickness, and material."
    category = "carrier.wafer"
    entity_type = "wafer"
    body_key = "carrier"
    layer = "carrier"
    defaults = {"diameter": 300000, "carrierThickness": 775, "carrierMaterial": "Si"}


class PanelCarrierGenerator(_SupportGenerator):
    generator_id = "panel-carrier"
    label = "Panel carrier generator"
    description = "Build a rectangular panel carrier with editable size, thickness, and material."
    category = "carrier.panel"
    entity_type = "panel"
    body_key = "carrier"
    layer = "carrier"
    circular = False
    defaults = {"packageX": 510000, "packageY": 515000, "carrierThickness": 700, "carrierMaterial": "glass"}


class FrameGenerator(_SupportGenerator):
    generator_id = "frame"
    label = "Frame generator"
    description = "Build circular frame-mount tape with editable diameter, thickness, and material; outer frame omitted."
    category = "frame"
    entity_type = "frame"
    body_key = "frame"
    layer = "tape"
    defaults = {"diameter": 350000, "tapeThickness": 80, "tapeMaterial": "tape"}
