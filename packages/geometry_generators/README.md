# Geometry Generators

This package owns versioned geometry generator implementations, their manifest
contract, registry, preview generation, and bounded materialization cache. It
does not import the API application.

Install it with `pip install -e packages/geometry_generators`. A new registry is
empty until generators are registered:

```python
from process_flow_geometry_generators import (
    GeometryGeneratorRegistry,
    register_builtin_generators,
)

registry = GeometryGeneratorRegistry()
register_builtin_generators(registry)
```

Register an additional implementation with `registry.register(generator)`. A
generator implements `definition()`, `validate(parameters)`, and
`evaluate(parameters)`; the latter returns `GeneratorEvaluation`. Each `(id,
version)` pair must be unique. Keep versions referenced by saved instances
registered so compilation can resolve their exact recipes.
