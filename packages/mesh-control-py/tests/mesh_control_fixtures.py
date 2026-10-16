"""Small spatial layouts shared by selection and mesher regression tests."""

from process_flow_kernel import normalize_geometry_structure


def feature(item_id, x, y, z, thickness, *, key=None, width=40):
    result = {
        "id": item_id, "material": "Si",
        "geometry": {
            "type": "BoxGeometry", "bottom_left": [x, y, z],
            "top_right": [x + width, y + width, z], "thk": thickness,
        },
    }
    if key is not None:
        result["key"] = key
    return result


def bump(item_id, x, y, z=10, thickness=10):
    return {
        **feature(item_id, x, y, z, thickness, width=10),
        "density": 50, "direction": "+z", "koz": 0, "stage": "reflowed",
    }


def soc(name, x, y, *, include_bumps=True):
    return {
        "id": f"soc:{name}", "key": "soc",
        "bodies": [feature(f"si:{name}", x, y, 20, 300, key="soc.si")],
        "bumps": [bump(f"bump:{name}", x, y)] if include_bumps else [],
    }


def hbm(name, x, y, *, include_bumps=True):
    return {
        "id": f"hbm:{name}", "key": "hbm",
        "bumps": [bump(f"bump:{name}", x, y)] if include_bumps else [],
        # Deliberately scramble the stack's DFS order.
        "children": [
            {"id": f"core2:{name}", "bodies": [feature(
                f"die:core2:{name}", x, y, 130, 30, key="hbm.core_die_2",
            )]},
            {"id": f"top:{name}", "bodies": [feature(
                f"die:top:{name}", x, y, 180, 40, key="hbm.top_die",
            )]},
            {"id": f"base:{name}", "bodies": [feature(
                f"die:base:{name}", x, y, 20, 40, key="hbm.base_die",
            )]},
            {"id": f"core1:{name}", "bodies": [feature(
                f"die:core1:{name}", x, y, 80, 30, key="hbm.core_die_1",
            )]},
        ],
    }


def layout(children):
    return normalize_geometry_structure({
        "id": "root", "bodies": [feature("base", -200, -200, 0, 10, width=400)],
        "children": children,
    })
