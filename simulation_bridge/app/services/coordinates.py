"""
COORDINATE MAPPING — studio show-local  <->  PX4 local NED.

Studio show-local (canonical, see src/lib/show/coordinates.ts):
    +X  east / stage right
    +Y  UP (altitude axis; ground is y = 0)
    +Z  north / depth
    right-handed, metres, yaw 0 along +X

PX4 local NED (offboard local position setpoints):
    +North, +East, +Down (down is POSITIVE, so altitude is negative)

Mapping (the ONLY place sign changes are allowed to live):
    NED North =  Studio Z
    NED East  =  Studio X
    NED Down  = -Studio Y

Inverse:
    Studio X =  NED East
    Studio Y = -NED Down
    Studio Z =  NED North

Yaw: studio yaw is CCW from +X seen from above; NED yaw is CW from North.
    ned_yaw_deg = 90 - studio_yaw_deg   (normalised to (-180, 180])
"""

from __future__ import annotations

Vec3 = tuple[float, float, float]

COORDINATE_MAPPING: dict[str, str] = {
    "studioFrame": "show-local (X=east, Y=up, Z=north, right-handed)",
    "targetFrame": "PX4 local NED (North, East, Down)",
    "north": "+Studio Z",
    "east": "+Studio X",
    "down": "-Studio Y",
    "altitudeAxis": "Studio Y (up) maps to negative NED Down",
    "yaw": "ned_yaw_deg = 90 - studio_yaw_deg",
}

COORDINATE_MAPPING_VERSION = "1.0"


def studio_to_ned(p: Vec3) -> Vec3:
    """Studio (x=east, y=up, z=north) -> NED (north, east, down)."""
    x, y, z = p
    return (float(z), float(x), float(-y))


def ned_to_studio(p: Vec3) -> Vec3:
    """NED (north, east, down) -> studio (x=east, y=up, z=north)."""
    n, e, d = p
    return (float(e), float(-d), float(n))


def studio_velocity_to_ned(v: Vec3) -> Vec3:
    """Velocities transform with the same linear map as positions."""
    return studio_to_ned(v)


def ned_velocity_to_studio(v: Vec3) -> Vec3:
    return ned_to_studio(v)


def normalize_yaw_deg(deg: float) -> float:
    a = float(deg) % 360.0
    if a <= -180.0:
        a += 360.0
    if a > 180.0:
        a -= 360.0
    return a


def studio_yaw_to_ned(yaw_deg: float) -> float:
    return normalize_yaw_deg(90.0 - float(yaw_deg))


def ned_yaw_to_studio(yaw_deg: float) -> float:
    return normalize_yaw_deg(90.0 - float(yaw_deg))
