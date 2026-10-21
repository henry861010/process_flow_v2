from .application.context import ProcessStepContext
from .application.instance_configuration import instance_flow_configuration, resolve_instance_configuration
from .application.execution_plan import ExecutionPlan, PlannedGeometryInput, PlannedStep
from .application.execution_result import GeometryKernelExecutionResult
from .application.flow_compiler import (
    FLOW_DEFAULT_VALUE_TYPES,
    FlowCompiler,
    flow_default_values_for_step_template,
    validate_flow_parameter_defaults,
    validate_parameter_default_values,
)
from .application.geometry_artifact import (
    GeometryArtifact,
    effective_adaptation_contract,
)
from .application.flow_validation import analyze_flow_graph, validate_flow_graph, validate_process_step_template
from .application.geometry_kernel import GeometryKernel
from .application.options import ExecuteOptions
from .application.protocols import ModuleResolver, ProcessStepModule
from .application.resource_resolution import (
    GeometryCatalogResolver,
    GeometryGeneratorResolver,
    InMemoryGeometryCatalog,
)
from .domain.bump_stage import BUMP_STAGES, BumpStage, validate_bump_stage
from .domain.container import Container
from .domain.features import Body, Bump, Circuit, Via
from .domain.geometry import BoxGeometry, ConeGeometry, CylinderGeometry, Geometry, PolygonGeometry
from .domain.process_geometry_state import ProcessGeometryState
from .domain.region import Region, TYPE_DIE, TYPE_EMPTY, TYPE_TARGET
from .domain.semantic_keys import (
    BODY_KEYS,
    CONTAINER_KEYS,
    VIA_KEYS,
    container_key_matches,
    validate_body_key,
    validate_container_key,
    validate_geometry_semantic_keys,
    validate_via_key,
)
from .infrastructure.module_resolver import ProcessStepModuleResolver
from .serialization.geometry_hydration import (
    geometry_structure_to_process_geometry_state,
    process_geometry_state_to_geometry_structure,
)
from .serialization.schema import (
    DEFAULT_UNIT_SYSTEM,
    GEOMETRY_SCHEMA_VERSION,
    normalize_geometry_structure,
    stable_id,
)
from .utils.polygon import classify_polygon_loops, validate_polygon_loops

__all__ = [
    "instance_flow_configuration",
    "resolve_instance_configuration",
    "Body",
    "BODY_KEYS",
    "BoxGeometry",
    "Bump",
    "BumpStage",
    "BUMP_STAGES",
    "Circuit",
    "ConeGeometry",
    "Container",
    "CONTAINER_KEYS",
    "CylinderGeometry",
    "DEFAULT_UNIT_SYSTEM",
    "ExecuteOptions",
    "ExecutionPlan",
    "FlowCompiler",
    "FLOW_DEFAULT_VALUE_TYPES",
    "GEOMETRY_SCHEMA_VERSION",
    "Geometry",
    "GeometryArtifact",
    "GeometryCatalogResolver",
    "GeometryGeneratorResolver",
    "GeometryKernel",
    "GeometryKernelExecutionResult",
    "InMemoryGeometryCatalog",
    "ModuleResolver",
    "PlannedGeometryInput",
    "PlannedStep",
    "PolygonGeometry",
    "ProcessGeometryState",
    "ProcessStepContext",
    "ProcessStepModule",
    "ProcessStepModuleResolver",
    "Region",
    "TYPE_DIE",
    "TYPE_EMPTY",
    "TYPE_TARGET",
    "Via",
    "VIA_KEYS",
    "analyze_flow_graph",
    "classify_polygon_loops",
    "container_key_matches",
    "geometry_structure_to_process_geometry_state",
    "effective_adaptation_contract",
    "flow_default_values_for_step_template",
    "normalize_geometry_structure",
    "process_geometry_state_to_geometry_structure",
    "stable_id",
    "validate_flow_graph",
    "validate_flow_parameter_defaults",
    "validate_body_key",
    "validate_bump_stage",
    "validate_container_key",
    "validate_geometry_semantic_keys",
    "validate_via_key",
    "validate_process_step_template",
    "validate_parameter_default_values",
    "validate_polygon_loops",
]
