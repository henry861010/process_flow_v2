"""Bind process-owned display intervals without inspecting polygon topology."""
from collections import defaultdict
from dataclasses import replace

from .contracts import SchematicLayerFill
from .geometry import geometry_bounds, walk_containers


def bind_layer_fills(plan, snapshots, bindings, *, input_structures=None, input_cursors=None):
    input_structures = input_structures or {}
    input_cursors = input_cursors or {}
    previous = {}
    by_step = {snapshot.step_ref_id: snapshot for snapshot in snapshots}
    extents = {}

    def structure(source):
        return (input_structures[source.owner_id] if source.kind == "flowInput"
                else by_step[source.owner_id].geometry_structure)

    def extent(source):
        key = (source.kind, source.owner_id)
        if key not in extents:
            bounds = [geometry_bounds(node.get("geometry", {}))
                      for container, _ in walk_containers(structure(source))
                      for collection in ("bodies", "bumps", "vias", "circuits")
                      for node in container.get(collection, ())]
            bounds = [bound for bound in bounds if bound is not None and bound.thickness > 0]
            extents[key] = (min((b.z_min for b in bounds), default=0),
                            max((b.z_max for b in bounds), default=0))
        return extents[key]

    def physical(binding):
        return {row.object_id: row.samples for row in getattr(binding, "physical_data", ())}

    for snapshot in snapshots:
        step = snapshot.step_ref_id
        bound = bindings.get(step)
        if step is None or not hasattr(bound, "scene") or step not in plan.deltas:
            continue
        delta = plan.deltas[step]
        sources = dict(plan.nodes[step].inputs)
        main = sources.get("main_geometry")
        objects = bound.scene.object_map
        records = dict(previous.get(main.owner_id, {})) if main is not None and main.kind == "stepOutput" else {}
        records = {key: value for key, value in records.items() if key in objects}

        # Copies use the already-bound physical samples to obtain one Z shift
        # per input. XY placement and pairwise contact never enter this path.
        copies = defaultdict(list)
        for derivation in delta.derivations:
            if derivation.source_object_id != derivation.target_object_id:
                copies[derivation.input_port_id].append(derivation)
        current_samples = None
        for port, derivations in copies.items():
            source = sources.get(port)
            if source is None or source.kind != "stepOutput" or not previous.get(source.owner_id):
                continue
            old_samples = physical(bindings.get(source.owner_id))
            if current_samples is None:
                current_samples = physical(bound)
            shifts = [min(s.z_min for s in current_samples[d.target_object_id]) -
                      min(s.z_min for s in old_samples[d.source_object_id])
                      for d in derivations if d.source_object_id in old_samples
                      and d.target_object_id in current_samples]
            if not shifts:
                raise ValueError("A copied layer fill has no bound vertical reference")
            shift = shifts[0]
            for derivation in derivations:
                record = previous[source.owner_id].get(derivation.source_object_id)
                if record is not None and derivation.target_object_id in objects:
                    records[derivation.target_object_id] = replace(
                        record, object_id=derivation.target_object_id,
                        z_min=record.z_min + shift, z_max=record.z_max + shift)

        if records and delta.vertical_transform != "identity":
            if main is None:
                raise ValueError("A vertical display transform needs a main source")
            top = extent(main)[1]
            if delta.vertical_transform == "mirror":
                from .flow import FlowSource
                offset = top + extent(FlowSource("stepOutput", step))[0]
                records = {key: replace(record, z_min=offset-record.z_max, z_max=offset-record.z_min)
                           for key, record in records.items()}
            else:
                cut = top - delta.trim_depth
                records = {key: replace(record, z_max=min(record.z_max, cut))
                           for key, record in records.items() if record.z_min < cut}

        for intent in delta.layer_fills:
            if main is None:
                raise ValueError("A layer fill needs a main source")
            cursor = (input_cursors.get(main.owner_id) if main.kind == "flowInput"
                      else getattr(by_step[main.owner_id], "cursor_z", None))
            if cursor is None:
                cursor = extent(main)[1]
            records[intent.object_id] = SchematicLayerFill(
                intent.object_id, intent.source_step_ref_id, "", intent.label,
                intent.material, intent.fill, cursor, cursor + intent.thickness)

        samples = physical(bound) if records else {}
        current = {}
        for key, record in records.items():
            obj = objects.get(key)
            if obj is None or obj.region_id is None:
                continue
            # The producer supplies fills relations with excluded roles. The
            # generic binder only follows the relation's selected object IDs.
            participants = {target.object_id for relation in bound.scene.relations
                            if relation.kind == "fills" and relation.subject_id == key
                            for target in relation.targets}
            group_keys = tuple(dict.fromkeys(
                member.group_key or member.id for member in bound.scene.objects
                if member.id in participants and member.layout == "member"
                and member.region_id == obj.region_id))
            current[key] = replace(record, region_id=obj.region_id, group_keys=group_keys,
                                   source_ids=tuple(sample.source_id for sample in samples.get(key, ())))
        previous[step] = current
        bound.layer_fills = tuple(current.values())
