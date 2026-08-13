"""
SimulationTrajectorySampler.

The studio trajectory sample rate and the MAVSDK setpoint stream rate are
independent. This module is the ONLY place where interpolation happens — never
inside adapter callbacks.

Operational time starts at 0 for the first reference; show time is preserved
(and may be negative inside the pre-show region), so both clocks stay monotonic.
"""

from __future__ import annotations

import math
from typing import Sequence

from ..models.errors import BridgeError
from ..models.run import SimulationReference

Vec3 = tuple[float, float, float]


def _lerp3(a: Sequence[float], b: Sequence[float], u: float) -> Vec3:
    return (
        a[0] + (b[0] - a[0]) * u,
        a[1] + (b[1] - a[1]) * u,
        a[2] + (b[2] - a[2]) * u,
    )


class SimulationTrajectorySampler:
    """Resamples a studio trajectory onto a fixed output rate."""

    version = "0.1.0"

    def __init__(self, samples: Sequence[object]) -> None:
        pts: list[tuple[float, Vec3, Vec3]] = []
        for s in samples:
            t = float(getattr(s, "t"))
            p = tuple(float(v) for v in getattr(s, "p"))  # type: ignore[arg-type]
            v = tuple(float(v) for v in getattr(s, "v", (0.0, 0.0, 0.0)))  # type: ignore[arg-type]
            pts.append((t, (p[0], p[1], p[2]), (v[0], v[1], v[2])))
        if len(pts) < 2:
            raise BridgeError("TRAJECTORY_INVALID", "at least two trajectory samples are required")
        for i in range(1, len(pts)):
            if pts[i][0] <= pts[i - 1][0]:
                raise BridgeError("TRAJECTORY_INVALID", f"non-monotonic timestamp at index {i}")
        self._pts = pts

    @property
    def start_time(self) -> float:
        return self._pts[0][0]

    @property
    def end_time(self) -> float:
        return self._pts[-1][0]

    @property
    def duration(self) -> float:
        return self.end_time - self.start_time

    def sample_at(self, t_show: float) -> tuple[Vec3, Vec3]:
        """Clamped linear interpolation at a show time."""
        pts = self._pts
        if t_show <= pts[0][0]:
            return pts[0][1], pts[0][2]
        if t_show >= pts[-1][0]:
            return pts[-1][1], pts[-1][2]
        lo, hi = 0, len(pts) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if pts[mid][0] <= t_show:
                lo = mid
            else:
                hi = mid
        t0, p0, v0 = pts[lo]
        t1, p1, v1 = pts[hi]
        span = t1 - t0
        u = 0.0 if span <= 0 else (t_show - t0) / span
        return _lerp3(p0, p1, u), _lerp3(v0, v1, u)

    def resample(self, output_rate_hz: float) -> list[SimulationReference]:
        if not math.isfinite(output_rate_hz) or output_rate_hz <= 0:
            raise BridgeError("BRIDGE_CONFIG_INVALID", "output rate must be positive")
        step = 1.0 / output_rate_hz
        count = int(math.floor(self.duration / step + 1e-9)) + 1
        refs: list[SimulationReference] = []
        for i in range(count):
            t_op = i * step
            t_show = self.start_time + t_op
            p, v = self.sample_at(t_show)
            refs.append(SimulationReference(t_operational=t_op, t_show=t_show, position=p, velocity=v))
        # Always terminate exactly on the final planned point.
        if refs[-1].t_show < self.end_time - 1e-9:
            p, v = self.sample_at(self.end_time)
            refs.append(
                SimulationReference(
                    t_operational=self.duration, t_show=self.end_time, position=p, velocity=v
                )
            )
        return refs
