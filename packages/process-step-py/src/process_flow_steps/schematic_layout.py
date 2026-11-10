"""Abstract process companions; execution never imports this module.

Describe logical structure without executing future geometry or allocating X.
Physical survival, provenance and measurements come from the selected snapshot.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Any

from process_flow_schematic.scene import (
    AnchorRef, AnchorSpec, LayerFillIntent, SceneDerivation, SceneObject, SceneRegion,
    SceneRelation, SceneState, SchematicDelta, clone_scene, namespace_id,
)

SCHEMATIC_DESCRIPTOR_VERSION = 3


def _freeze_parameters(value):
    if isinstance(value, Mapping):
        return MappingProxyType({key: _freeze_parameters(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_parameters(item) for item in value)
    return value


@dataclass(frozen=True)
class SchematicDescriptorContext:
    step_ref_id: str
    program: str
    parameter_values: Mapping[str, Any]
    inputs: Mapping[str, SceneState]

    def __post_init__(self):
        object.__setattr__(self, "parameter_values", _freeze_parameters(self.parameter_values))
        object.__setattr__(self, "inputs", MappingProxyType(dict(self.inputs)))

    @property
    def main(self) -> SceneState:
        return self.source("main_geometry")

    def source(self, port: str) -> SceneState:
        try:
            return self.inputs[port]
        except KeyError as error:
            raise ValueError(f"{self.program} needs a schematic source for {port}") from error

    def local_id(self, key: str) -> str:
        return namespace_id(self.step_ref_id, key)

    def physical_ref(self, key: str) -> str:
        return f"step:{self.step_ref_id}:{key}"


Descriptor = Callable[[SchematicDescriptorContext], SchematicDelta]
ActivePorts = Callable[[Mapping[str, Any], tuple[str, ...]], tuple[str, ...]]


class SchematicDescriptorRegistry:
    def __init__(self):
        self._descriptors: dict[str, Descriptor] = {}
        self._active_ports: dict[str, ActivePorts] = {}

    @property
    def programs(self) -> tuple[str, ...]:
        return tuple(sorted(self._descriptors))

    def register(self, program: str, descriptor: Descriptor, *, active_ports: ActivePorts | None = None) -> None:
        if program in self._descriptors:
            raise ValueError(f"Duplicate schematic descriptor: {program}")
        self._descriptors[program] = descriptor
        if active_ports is not None:
            self._active_ports[program] = active_ports

    def resolve(self, program: str) -> Descriptor | None:
        return self._descriptors.get(program)

    def input_ports(self, program: str, parameters: Mapping[str, Any], connected_ports) -> tuple[str, ...]:
        """Resolve semantic dependencies before a planner loads their sources."""
        if program not in self._descriptors:
            raise ValueError(f"No schematic descriptor for {program}")
        ports = tuple(sorted(set(connected_ports)))
        selector = self._active_ports.get(program)
        return ports if selector is None else selector(_freeze_parameters(parameters), ports)

    def describe(self, context: SchematicDescriptorContext) -> SchematicDelta:
        descriptor = self.resolve(context.program)
        if descriptor is None:
            raise ValueError(f"No schematic descriptor for {context.program}")
        return descriptor(context)


def _root(scene: SceneState) -> SceneObject:
    roots = [obj for obj in scene.objects if obj.parent_id is None]
    if len(roots) != 1:
        raise ValueError("A process schematic source must have one assembly root")
    return roots[0]


def _region(scene: SceneState) -> str:
    if scene.cursor_region_id is None:
        raise ValueError("A process schematic source needs a symbolic mounting region")
    return scene.cursor_region_id


def _members(scene: SceneState, region_id: str) -> tuple[SceneObject, ...]:
    return tuple(obj for obj in scene.objects if obj.layout == "member" and obj.region_id == region_id)


def _anchor(obj: SceneObject, preferred: str = "upper") -> AnchorRef:
    names = {anchor.name for anchor in obj.anchors}
    name = preferred if preferred in names else (obj.anchors[0].name if obj.anchors else "surface")
    return AnchorRef(obj.id, name)


def _surface_region(context, owner, key, parent_region):
    return SceneRegion(context.local_id(key), owner.id, "upper", parent_region)


def _created(context, key, *, kind, role, label, layout, region_id, symbol=None, color_role="generic"):
    reference = context.physical_ref(key)
    return SceneObject(
        id=context.local_id(key), kind=kind, role=role, label=label,
        parent_id=_root(context.main).id, source_ref=reference,
        class_key=context.local_id(f"class:{key}"), layout=layout,
        region_id=region_id, symbol=symbol, color_role=color_role,
        anchors=(AnchorSpec("lower", source_ref=reference, side="lower"),
                 AnchorSpec("upper", source_ref=reference, side="upper")),
    )


def _place(context):
    placements = context.parameter_values.get("placements")
    if not isinstance(placements, (tuple, list)):
        raise ValueError("PnP.placements must be a list")
    if not placements:
        return SchematicDelta()
    main, source = context.main, context.source("die_geometry")
    region_id = _region(main)
    cloned = clone_scene(source, namespace=context.step_ref_id,
                         input_port_id="die_geometry", attach_to=_root(main).id,
                         region_id=region_id)
    # Exactly one abstract copy, regardless of placement count. The source
    # extractor freezes structural classes and atomic compound boundaries.
    # Generic wrappers can become members only after attachment. Namespace
    # their frozen class now as well, so later canonical selection cannot merge
    # wrappers placed by different PnP operations into one representative.
    source_classes = {namespace_id(context.step_ref_id, obj.id): obj for obj in source.objects}
    creates = tuple(
        replace(obj, group_key=namespace_id(
            context.step_ref_id,
            source_classes[obj.id].group_key or namespace_id(
                obj.region_id or region_id,
                source_classes[obj.id].class_key or source_classes[obj.id].id)))
        if obj.kind == "component" else obj for obj in cloned.creates)
    placed_members = tuple(obj for obj in creates if obj.layout == "member" and obj.region_id == region_id)
    relations = list(cloned.add_relations)
    for obj in placed_members:
        relations.append(SceneRelation(context.local_id(f"inside:{obj.id}"), "inside", obj.id, region_id=region_id))
    for feature in main.objects:
        if feature.layout == "distributed" and feature.region_id == region_id and placed_members:
            relations.append(SceneRelation(context.local_id(f"exclude:{feature.id}"), "excludes", feature.id,
                                           targets=tuple(_anchor(obj) for obj in placed_members), region_id=region_id))
    updated_fills = tuple(replace(relation, targets=tuple(dict.fromkeys((
        *relation.targets, *(_anchor(obj) for obj in placed_members if obj.role != "wafer-dmy")))))
        for relation in main.relations if relation.kind == "fills" and relation.region_id == region_id)
    return replace(cloned, creates=creates, add_relations=tuple(relations),
                   update_relations=(*cloned.update_relations, *updated_fills),
                   cursor_region_id=None, phase_id=None, orientation=None)


def _deposit(context):
    region_id = _region(context.main)
    role = context.program.split("/", 1)[1]
    body = _created(context, "layer", kind="body", role=role,
                    label=str(context.parameter_values.get("material") or role),
                    layout="span", region_id=region_id,
                    color_role=("matrix" if role == "molding" else
                                "adhesive" if role in ("daf", "fow") else "generic"))
    surface = _surface_region(context, body, "surface", region_id)
    return SchematicDelta(creates=(body,), add_regions=(surface,), cursor_region_id=surface.id)


def _coat(context):
    role = context.program.split("/", 1)[1]
    target_role = "cow" if role == "tim1" else "lid"
    targets = [obj for obj in context.main.objects
               if obj.kind in ("component", "assembly") and obj.role == target_role]
    if not targets:
        raise ValueError(f"{role.upper()} needs a {target_role} container")
    bodies, relations = [], []
    for target in targets:
        body = replace(_created(context, f"coating:{target.id}", kind="body", role=role,
                                label=role.upper(), layout="span", region_id=target.region_id,
                                color_role="adhesive"), parent_id=target.id)
        bodies.append(body)
        # Apply coverage before attachment: attachment narrows the span to
        # this target even when several targets share a mounting region.
        relations.extend((
            SceneRelation(context.local_id(f"covers:{target.id}"), "covers", body.id,
                          targets=(_anchor(target),), region_id=target.region_id),
            SceneRelation(context.local_id(f"attached:{target.id}"), "attached_to", body.id,
                          targets=(_anchor(target),)),
        ))
    surface = _surface_region(context, _root(context.main), "coated-surface", _region(context.main))
    return SchematicDelta(creates=tuple(bodies), add_relations=tuple(relations),
                          add_regions=(surface,), cursor_region_id=surface.id)


def _rdl(context):
    layers = context.parameter_values.get("layers")
    if not isinstance(layers, (list, tuple)) or not layers:
        raise ValueError("RDL.layers must include at least one layer")
    objects, regions, relations = [], [], []
    region_id = _region(context.main)
    prior_feature = None
    for index, layer in enumerate(layers):
        if not isinstance(layer, Mapping):
            raise ValueError("RDL layer descriptions must be mappings")
        body = _created(context, f"rdl-body-{index}", kind="body", role="rdl",
                        label=str(layer.get("Dielectric") or "RDL"), layout="span",
                        region_id=region_id, symbol="rdl", color_role="rdl_dielectric")
        symbol = "via" if index % 2 == 0 else "circuit"
        feature = _created(context, f"rdl-{symbol}-{index}", kind="feature", role=symbol,
                           label=str(layer.get("Conductivity") or symbol), layout="span",
                           region_id=region_id, symbol=f"rdl.{symbol}", color_role="conductor")
        surface = _surface_region(context, body, f"rdl-surface-{index}", region_id)
        objects.extend((body, feature))
        regions.append(surface)
        relations.append(SceneRelation(context.local_id(f"rdl-inside-{index}"), "inside", feature.id, region_id=region_id))
        if prior_feature is not None:
            relations.append(SceneRelation(context.local_id(f"rdl-connect-{index}"), "connects", feature.id,
                                           targets=(_anchor(prior_feature), _anchor(feature, "lower"))))
        prior_feature, region_id = feature, surface.id
    return SchematicDelta(creates=tuple(objects), add_regions=tuple(regions),
                          add_relations=tuple(relations), cursor_region_id=region_id)


def _tmv(context):
    region_id = _region(context.main)
    feature = _created(context, "via", kind="feature", role="via", label="TIV",
                       layout="distributed", region_id=region_id, symbol="via.pillar", color_role="conductor")
    relation = SceneRelation(context.local_id("via-excludes"), "excludes", feature.id,
                             targets=tuple(_anchor(obj) for obj in _members(context.main, region_id)), region_id=region_id)
    return SchematicDelta(creates=(feature,), add_relations=(relation,))


def _underfill(context):
    from process_flow_schematic import UNDERFILL_FILL, base_material

    region_id = _region(context.main)
    body = _created(context, "underfill", kind="body", role="uf", label="Under Fill",
                    layout="span", region_id=region_id, symbol="uf", color_role="underfill")
    relation = SceneRelation(context.local_id("underfill-fills"), "fills", body.id,
                             targets=tuple(_anchor(obj) for obj in _members(context.main, region_id)
                                           if obj.role != "wafer-dmy"), region_id=region_id)
    material = str(context.parameter_values.get("material", "UF"))
    intent = LayerFillIntent(body.id, context.step_ref_id, "UF · " + base_material(material),
                             material, UNDERFILL_FILL, float(context.parameter_values["thk"]))
    return SchematicDelta(creates=(body,), add_relations=(relation,), layer_fills=(intent,))


def _bump(context):
    bump = _created(context, "bump", kind="feature", role="bump", label="Bump",
                    layout="span", region_id=_region(context.main), symbol="bump.reflowed", color_role="conductor")
    return SchematicDelta(creates=(bump,))


def _joint(context):
    # Contacts and joined measurements are resolved by actual provenance.
    bumps = tuple(obj for obj in context.main.objects if obj.role == "bump")
    return SchematicDelta(updates=tuple(replace(obj, symbol="bump.joined") for obj in bumps),
                          derivations=tuple(SceneDerivation(obj.id, obj.id, "main_geometry", "transform") for obj in bumps))


def _support(context, port):
    main, source = context.main, context.source(port)
    source_root = _root(source)
    region_id = _region(main)
    bodies = sorted((obj for obj in source.objects if obj.kind == "body" and obj.parent_id == source_root.id), key=lambda obj: obj.id)
    if not bodies:
        raise ValueError(f"{port} needs direct root body descriptions")
    creates, derivations = [], []
    for original in bodies:
        obj = replace(original, id=context.local_id(original.id), parent_id=_root(main).id,
                      layout="span", region_id=region_id)
        creates.append(obj)
        derivations.append(SceneDerivation(original.id, obj.id, port))
    surface = _surface_region(context, _root(main), "support-surface", region_id)
    return SchematicDelta(creates=tuple(creates), add_regions=(surface,), cursor_region_id=surface.id,
                          derivations=tuple(derivations))


def _carrier(context):
    return _support(context, "carrier_geometry")


def _frame(context):
    return _support(context, "frame_geometry")


def _remove_support(context, role):
    candidates = [obj for obj in context.main.objects if obj.kind == "body" and obj.role == role]
    # Several carriers can exist. Without physical Z the exposed one is unknown;
    # keep all reservations, and let the current snapshot decide visibility.
    removes = tuple(obj.id for obj in candidates) if len(candidates) == 1 else ()
    region_id = _region(context.main)
    surface = _surface_region(context, _root(context.main), "exposed-surface", region_id)
    # The new cursor must not depend on a region removed with its former owner.
    if removes:
        surface = replace(surface, parent_region_id=None)
    notes = () if removes else (f"{context.step_ref_id}: exposed {role} is resolved from the executed snapshot.",)
    return SchematicDelta(removes=removes, add_regions=(surface,), cursor_region_id=surface.id, notes=notes)


def _debond(context):
    return _remove_support(context, "carrier")


def _demount(context):
    return _remove_support(context, "frame")


def _flip(context):
    swapped = {"lower": "upper", "upper": "lower"}
    updates = tuple(replace(obj, anchors=tuple(replace(anchor, side=swapped.get(anchor.side, anchor.side))
                                             if anchor.kind == "physical-face" else anchor for anchor in obj.anchors))
                    for obj in context.main.objects)
    surface = _surface_region(context, _root(context.main), "flipped-surface", _region(context.main))
    return SchematicDelta(updates=updates, orientation=-context.main.orientation,
                          add_regions=(surface,), cursor_region_id=surface.id, vertical_transform="mirror")


def _saw(context):
    # Current saw crops one assembly; it does not split its output identity.
    root = _root(context.main)
    outer_region = root.region_id or _region(context.main)
    contents = SceneRegion(context.local_id("cow-contents"), root.id, parent_region_id=outer_region)
    updates = tuple(
        replace(obj, kind="component", role="cow", label="CoW", diagram_label=None,
                nesting="arranged", region_id=outer_region)
        if obj.id == root.id else
        replace(obj, region_id=contents.id,
                anchors=tuple(replace(anchor, source_ref=contents.id)
                              if anchor.kind == "region-boundary" and anchor.source_ref == outer_region
                              else anchor for anchor in obj.anchors))
        if obj.region_id == outer_region else obj for obj in context.main.objects)
    return SchematicDelta(
        updates=updates, add_regions=(contents,),
        update_regions=tuple(replace(region, parent_region_id=contents.id)
                             for region in context.main.regions if region.parent_region_id == outer_region),
        update_relations=tuple(replace(relation, region_id=contents.id)
                               for relation in context.main.relations if relation.region_id == outer_region),
        cursor_region_id=contents.id if context.main.cursor_region_id == outer_region else None,
        phase_id=context.local_id("cow-phase"),
        derivations=tuple(SceneDerivation(obj.id, obj.id, "main_geometry", "crop")
                          for obj in context.main.objects))


def _grind(context):
    surface = _surface_region(context, _root(context.main), "ground-surface", _region(context.main))
    return SchematicDelta(add_regions=(surface,), cursor_region_id=surface.id,
                          vertical_transform="clip", trim_depth=float(context.parameter_values["thk"]),
                          derivations=tuple(SceneDerivation(obj.id, obj.id, "main_geometry", "transform")
                                            for obj in context.main.objects))


def _placement_ports(parameters, connected_ports):
    placements = parameters.get("placements")
    if isinstance(placements, (tuple, list)) and not placements:
        return tuple(port for port in connected_ports if port != "die_geometry")
    return connected_ports


def register_descriptors(registry: SchematicDescriptorRegistry) -> None:
    registry.register("pnp/pnp", _place, active_ports=_placement_ports)
    for program in ("layer/molding", "layer/ecl", "layer/daf", "layer/fow"):
        registry.register(program, _deposit)
    for program in ("layer/tim1", "layer/tim2"):
        registry.register(program, _coat)
    registry.register("layer/rdl", _rdl)
    registry.register("tmv/tmv", _tmv)
    registry.register("uf/under_fill", _underfill)
    for program in ("bump/uBump_formation", "bump/bga_bump_formation", "bump/c4_bump_formation"):
        registry.register(program, _bump)
    for program in ("joint/mr_joint", "joint/tcb_joint"):
        registry.register(program, _joint)
    registry.register("carrier/bond", _carrier)
    registry.register("carrier/debond", _debond)
    registry.register("frame/mount", _frame)
    registry.register("frame/demount", _demount)
    registry.register("flip/flip", _flip)
    registry.register("saw/saw", _saw)
    registry.register("grinding/grinding", _grind)


def describe_schematic(context: SchematicDescriptorContext) -> SchematicDelta:
    registry = SchematicDescriptorRegistry()
    register_descriptors(registry)
    return registry.describe(context)
