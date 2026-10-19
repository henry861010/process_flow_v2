"""Operation-local geometry indexes for region resolution; never cached on state."""
from __future__ import annotations

from process_flow_kernel import ProcessGeometryState

from .contracts import JsonObject


class _GeometryQuery:
    """Lazily snapshot a read-only state and aggregate physical bounds once.

    Instances belong to one build or validation operation. Container bounds
    are separate from kernel summaries so empty descendants cannot introduce
    placeholder Z=0 values, and other mesh rules keep their existing semantics.
    """

    def __init__(self, state: ProcessGeometryState | None):
        self._state = state
        self._nodes: list[JsonObject] | None = None
        self._by_id: dict[str, JsonObject] = {}
        self._by_kind: dict[str, list[JsonObject]] = {}
        self._by_kind_key: dict[tuple[str, str | None], list[JsonObject]] = {}
        self._container_bounds: dict[str, JsonObject] = {}

    def sources(self, reference: JsonObject, *, path: str) -> list[JsonObject]:
        """Return detached sources in DFS order, intersecting all filters."""
        if self._state is None:
            raise ValueError(f"{path}.reference: geometry is required")
        nodes = self._nodes
        if nodes is None:
            nodes = self._load(self._state)

        kind = reference["kind"]
        if kind == "root":
            candidates = nodes[:1]
        elif "id" in reference:
            source = self._by_id.get(reference["id"])
            candidates = [] if source is None else [source]
        elif "key" in reference:
            candidates = self._by_kind_key.get((kind, reference["key"]), [])
        else:
            candidates = self._by_kind.get(kind, [])
        matches = [
            node for node in candidates
            if kind == "root" or all(node.get(field) == value for field, value in reference.items())
        ]
        if not matches:
            raise ValueError(f"{path}.reference: no matching geometry")
        return [
            {**node, **self._container_bounds[node["id"]]}
            if node["kind"] == "container" else dict(node)
            for node in matches
        ]

    def _load(self, state: ProcessGeometryState) -> list[JsonObject]:
        nodes = state.find_geometry()
        for node in nodes:
            self._by_id[node["id"]] = node
            self._by_kind.setdefault(node["kind"], []).append(node)
            self._by_kind_key.setdefault((node["kind"], node["key"]), []).append(node)
            if node["kind"] == "container":
                self._container_bounds[node["id"]] = {
                    f"{axis}{bound}": None for axis in "xyz" for bound in ("Min", "Max")
                }

        # Reversed DFS visits every feature/child before its parent. Merge only
        # physical bounds; empty containers therefore contribute nothing.
        for node in reversed(nodes):
            parent_id = node["containerId"]
            if parent_id is None:
                continue
            bounds = self._container_bounds[node["id"]] if node["kind"] == "container" else node
            if bounds["xMin"] is None:
                continue
            parent = self._container_bounds[parent_id]
            for axis in "xyz":
                for bound, aggregate in (("Min", min), ("Max", max)):
                    field = f"{axis}{bound}"
                    parent[field] = bounds[field] if parent[field] is None else aggregate(parent[field], bounds[field])
        self._nodes = nodes
        return nodes
