from .application.context import ProcessStepContext
from .application.execution_plan import ExecutionPlan, PlannedGeometryInput, PlannedStep
from .application.execution_result import GeometryKernelExecutionResult
from .application.flow_compiler import FlowCompiler
from .application.flow_validation import analyze_flow_graph, validate_flow_graph, validate_process_step_template
from .application.geometry_kernel import GeometryKernel
from .application.options import ExecuteOptions
from .application.protocols import ModuleResolver, ProcessStepModule
from .application.resource_resolution import GeometryCatalogResolver, InMemoryGeometryCatalog
from .domain.container import Container
from .domain.features import Body, Bump, Circuit, Via
from .domain.geometry import BoxGeometry, ConeGeometry, CylinderGeometry, Geometry, PolygonGeometry
from .domain.process_geometry_state import ProcessGeometryState
from .domain.region import Region, TYPE_DIE, TYPE_EMPTY, TYPE_TARGET
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
    "Body",
    "BoxGeometry",
    "Bump",
    "Circuit",
    "ConeGeometry",
    "Container",
    "CylinderGeometry",
    "DEFAULT_UNIT_SYSTEM",
    "ExecuteOptions",
    "ExecutionPlan",
    "FlowCompiler",
    "GEOMETRY_SCHEMA_VERSION",
    "Geometry",
    "GeometryCatalogResolver",
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
    "analyze_flow_graph",
    "classify_polygon_loops",
    "geometry_structure_to_process_geometry_state",
    "normalize_geometry_structure",
    "process_geometry_state_to_geometry_structure",
    "stable_id",
    "validate_flow_graph",
    "validate_process_step_template",
    "validate_polygon_loops",
]
