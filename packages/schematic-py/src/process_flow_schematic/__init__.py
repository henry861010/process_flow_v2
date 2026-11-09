from .contracts import (
    SCHEMATIC_VERSION, Bounds, ComponentHint, Primitive, SchematicContext,
    SchematicPart, SchematicRegistry, slab,
    SchematicDocument, SchematicShape, SchematicItem, SchematicComponent,
    SchematicLayoutGroup, SchematicSlot, SchematicLayoutPlan, SchematicFeatureSlot, SchematicLayerFill,
)
from .layout import make_layout_plan, representation_for_role, resolve_component_hint
from .geometry import base_material, geometry_bounds, material_color, walk_containers
from .composer import compose_schematic, describe_schematic_components
from .palette import (
    ADHESIVE_FILL, CARRIER_FILL, COMPONENT_MATRIX_FILL, RDL_DIELECTRIC_FILL,
    CONDUCTOR_FILL, CONDUCTOR_OUTLINE, GENERIC_FILL, MATRIX_FILL, OUTLINE,
    SILICON_FILL, SOLDER_FILL, SUPPORT_FILL, UNDERFILL_FILL,
)

__all__ = [
    "ADHESIVE_FILL", "CARRIER_FILL", "COMPONENT_MATRIX_FILL", "RDL_DIELECTRIC_FILL",
    "SCHEMATIC_VERSION", "Bounds", "ComponentHint", "Primitive", "SchematicContext",
    "SchematicPart", "SchematicRegistry", "slab", "base_material", "geometry_bounds",
    "material_color", "walk_containers", "compose_schematic", "describe_schematic_components",
    "SchematicDocument", "SchematicShape", "SchematicItem", "SchematicComponent",
    "SchematicFeatureSlot", "SchematicLayerFill", "representation_for_role", "resolve_component_hint",
    "SchematicLayoutGroup", "SchematicSlot", "SchematicLayoutPlan", "make_layout_plan",
    "CONDUCTOR_FILL", "CONDUCTOR_OUTLINE", "GENERIC_FILL", "MATRIX_FILL", "OUTLINE",
    "SILICON_FILL", "SOLDER_FILL", "SUPPORT_FILL", "UNDERFILL_FILL",
]

# The semantic IR is separate from the stable v1 document transport.
from .scene import (
    SCENE_VERSION, AnchorRef, AnchorSpec, LayerFillIntent, LayoutRegion, PhysicalSample,
    ResolvedPhysicalData, SceneDerivation, SceneObject, SceneRegion,
    SceneRelation, SceneReparent, SceneState, SchematicDelta, SchematicObject,
    apply_delta, clone_scene, namespace_id, resolve_physical_data, validate_scene,
)
from .scene_layout import (
    SCENE_LAYOUT_POLICY_VERSION, SceneFeaturePlacement, SceneLayoutPlan, SceneLayoutPolicy, SceneMemberSlot,
    SceneRegionPlacement, make_scene_layout_plan, merge_scene_states,
)
from .scene_renderer import SceneSymbolContext, SceneSymbolRegistry, render_scene
from .source import describe_source_scene
from .flow import FlowNode, FlowSource, FlowSchematicPlan, SnapshotBindings, bind_flow_snapshots, plan_flow

__all__ += [
    "SCENE_VERSION", "AnchorRef", "AnchorSpec", "LayerFillIntent", "LayoutRegion", "PhysicalSample",
    "ResolvedPhysicalData", "SceneDerivation", "SceneObject", "SceneRegion",
    "SceneRelation", "SceneReparent", "SceneState", "SchematicDelta", "SchematicObject",
    "apply_delta", "clone_scene", "namespace_id", "resolve_physical_data", "validate_scene",
    "SCENE_LAYOUT_POLICY_VERSION", "SceneFeaturePlacement", "SceneLayoutPlan", "SceneLayoutPolicy", "SceneMemberSlot",
    "SceneRegionPlacement", "make_scene_layout_plan", "merge_scene_states",
    "SceneSymbolContext", "SceneSymbolRegistry", "render_scene", "describe_source_scene",
    "FlowNode", "FlowSource", "FlowSchematicPlan", "SnapshotBindings", "bind_flow_snapshots", "plan_flow",
]
