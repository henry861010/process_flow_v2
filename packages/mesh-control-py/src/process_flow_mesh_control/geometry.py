"""Read-only selection helpers for detached ``find_geometry()`` summaries."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from .contracts import JsonObject


def select_upper_right(nodes: Iterable[JsonObject]) -> JsonObject | None:
    """Return the node with the greatest XY bounding-box center, X first.

    Args:
        nodes: Geometry summaries with xMin/xMax/yMin/yMax bounds in um.
            Nodes with missing or None XY bounds (empty containers) are ignored.

    Returns:
        The original node maximizing (center X, center Y), or None when no
        positioned node exists. Exact ties keep the first input node, so DFS
        order is preserved for coincident features. Z and IDs do not affect rank.

    The iterable is consumed once. Neither nodes nor their order are modified.
    """
    selected = None
    selected_position = None
    for node in nodes:
        if any(node.get(field) is None for field in ("xMin", "xMax", "yMin", "yMax")):
            continue
        position = (
            (node["xMin"] + node["xMax"]) / 2,
            (node["yMin"] + node["yMax"]) / 2,
        )
        if selected_position is None or position > selected_position:
            selected = node
            selected_position = position
    return selected


def belongs_to_subtree(
    node: JsonObject,
    container_id: str,
    containers_by_id: Mapping[str, JsonObject],
) -> bool:
    """Return whether a node belongs to a container, including the container.

    Args:
        node: A detached geometry summary with kind, id and containerId fields.
        container_id: Serialized structure ID of the subtree root.
        containers_by_id: Container summaries indexed by their structure IDs;
            parentId links must describe an acyclic tree.

    Returns:
        True for the root or any descendant, False for unrelated nodes or a
        parent chain that ends outside the supplied index.

    Inputs are not modified. Missing required summary fields raise KeyError.
    """
    current_id = node["id"] if node["kind"] == "container" else node["containerId"]
    while current_id is not None:
        if current_id == container_id:
            return True
        current = containers_by_id.get(current_id)
        current_id = None if current is None else current["parentId"]
    return False


def subtree_nodes(
    nodes: Iterable[JsonObject],
    containers_by_id: Mapping[str, JsonObject],
    container: JsonObject | None,
    *,
    kind: str | None = None,
    key: str | None = None,
) -> list[JsonObject]:
    """Return subtree summaries in input order, optionally filtered by kind/key.

    Args:
        nodes: Detached geometry summaries, normally from find_geometry().
        containers_by_id: The acyclic container index used by belongs_to_subtree.
        container: Subtree root summary, or None to return an empty list.
        kind: Optional exact kind filter, such as "body" or "bump".
        key: Optional exact semantic key filter, such as "hbm.base_die".

    Returns:
        A new list referencing the matching input nodes. With no kind filter,
        the root container itself is included when present in nodes.

    Inputs are not modified. Missing required summary fields raise KeyError.
    """
    if container is None:
        return []
    return [
        node for node in nodes
        if (kind is None or node["kind"] == kind)
        and (key is None or node["key"] == key)
        and belongs_to_subtree(node, container["id"], containers_by_id)
    ]
