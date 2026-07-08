from __future__ import annotations


class Body:
    def __init__(self, geometry, material):
        self._geometry = geometry
        self._material = material

    def z_min(self):
        return self._geometry.z_min()

    def z_max(self):
        return self._geometry.z_max()

    def thk(self):
        return self._geometry.thk()

    def geometry(self):
        return self._geometry.copy()

    def material(self):
        return self._material

    def copy(self):
        return Body(self._geometry.copy(), self._material)

    def copy_with_thk(self, thk):
        return Body(self._geometry.copy_with_thk(thk), self._material)

    def move(self, x=0, y=0, z=0):
        self._geometry.move(x=x, y=y, z=z)

    def clip_top_to(self, to_z):
        return self._geometry.clip_top_to(to_z)

    def clip_xy_to_box(self, bounds):
        return self._geometry.clip_xy_to_box(bounds)

    def flip(self, around_z=0):
        self._geometry.flip(around_z)

    def json(self):
        return {
            "geometry": self._geometry.json(),
            "material": self._material,
        }


class Via:
    def __init__(self, geometry, density, material, direction, koz=0):
        _assert_direction(direction, "Via")
        self._geometry = geometry
        self._density = density
        self._material = material
        self._direction = direction
        self._koz = _non_negative_number(koz, "Via koz")

    def z_min(self):
        return self._geometry.z_min()

    def z_max(self):
        return self._geometry.z_max()

    def thk(self):
        return self._geometry.thk()

    def geometry(self):
        return self._geometry.copy()

    def density(self):
        return self._density

    def material(self):
        return self._material

    def direction(self):
        return self._direction

    def koz(self):
        return self._koz

    def copy(self):
        return Via(self._geometry.copy(), self._density, self._material, self._direction, self._koz)

    def copy_with_thk(self, thk):
        return Via(self._geometry.copy_with_thk(thk), self._density, self._material, self._direction, self._koz)

    def move(self, x=0, y=0, z=0):
        self._geometry.move(x=x, y=y, z=z)

    def clip_top_to(self, to_z):
        return self._geometry.clip_top_to(to_z)

    def clip_xy_to_box(self, bounds):
        return self._geometry.clip_xy_to_box(bounds)

    def flip(self, around_z=0):
        self._geometry.flip(around_z)
        self._direction = _reverse_direction(self._direction)

    def json(self):
        return {
            "geometry": self._geometry.json(),
            "material": self._material,
            "density": self._density,
            "direction": self._direction,
            "koz": self._koz,
        }


class Circuit:
    def __init__(self, geometry, density, material, koz=0):
        self._geometry = geometry
        self._density = density
        self._material = material
        self._koz = _non_negative_number(koz, "Circuit koz")

    def z_min(self):
        return self._geometry.z_min()

    def z_max(self):
        return self._geometry.z_max()

    def thk(self):
        return self._geometry.thk()

    def geometry(self):
        return self._geometry.copy()

    def density(self):
        return self._density

    def material(self):
        return self._material

    def koz(self):
        return self._koz

    def copy(self):
        return Circuit(self._geometry.copy(), self._density, self._material, self._koz)

    def copy_with_thk(self, thk):
        return Circuit(self._geometry.copy_with_thk(thk), self._density, self._material, self._koz)

    def move(self, x=0, y=0, z=0):
        self._geometry.move(x=x, y=y, z=z)

    def clip_top_to(self, to_z):
        return self._geometry.clip_top_to(to_z)

    def clip_xy_to_box(self, bounds):
        return self._geometry.clip_xy_to_box(bounds)

    def flip(self, around_z=0):
        self._geometry.flip(around_z)

    def json(self):
        return {
            "geometry": self._geometry.json(),
            "material": self._material,
            "density": self._density,
            "koz": self._koz,
        }


class Bump:
    def __init__(self, geometry, density, material, direction, koz=0):
        _assert_direction(direction, "Bump")
        self._geometry = geometry
        self._density = density
        self._material = material
        self._direction = direction
        self._koz = _non_negative_number(koz, "Bump koz")

    def z_min(self):
        return self._geometry.z_min()

    def z_max(self):
        return self._geometry.z_max()

    def thk(self):
        return self._geometry.thk()

    def geometry(self):
        return self._geometry.copy()

    def density(self):
        return self._density

    def material(self):
        return self._material

    def direction(self):
        return self._direction

    def koz(self):
        return self._koz

    def copy(self):
        return Bump(self._geometry.copy(), self._density, self._material, self._direction, self._koz)

    def copy_with_thk(self, thk):
        return Bump(self._geometry.copy_with_thk(thk), self._density, self._material, self._direction, self._koz)

    def move(self, x=0, y=0, z=0):
        self._geometry.move(x=x, y=y, z=z)

    def clip_top_to(self, to_z):
        return self._geometry.clip_top_to(to_z)

    def clip_xy_to_box(self, bounds):
        return self._geometry.clip_xy_to_box(bounds)

    def flip(self, around_z=0):
        self._geometry.flip(around_z)
        self._direction = _reverse_direction(self._direction)

    def json(self):
        return {
            "geometry": self._geometry.json(),
            "material": self._material,
            "density": self._density,
            "direction": self._direction,
            "koz": self._koz,
        }


def _assert_direction(direction, label):
    if direction not in ("+z", "-z"):
        raise ValueError(f'{label} direction must be "+z" or "-z"; received {direction}')


def _reverse_direction(direction):
    return "-z" if direction == "+z" else "+z"


def _non_negative_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a non-negative finite number") from None
    if number in (float("inf"), float("-inf")) or number != number or number < 0:
        raise ValueError(f"{label} must be a non-negative finite number")
    return number
