from __future__ import annotations

import re
import uuid

JsonObject = dict[str, object]


def generated_geometry_id(payload: JsonObject) -> str:
    base = slug(payload.get("name") or payload.get("entityType") or "geometry")
    return f"geom_{base}_{uuid.uuid4().hex[:12]}"


def slug(value: object) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", str(value).lower()).strip("_")
    return normalized or "geometry"
