"""
Built-in simulation TEST TRAJECTORY (bridge self-test).

Small, bounded and slow on purpose: it exists only to verify connection,
coordinate mapping, timing and telemetry — and to make an axis inversion
obvious. Pattern (studio frame, metres):

    hold at 2 m altitude  ->  UP +1 m  ->  RIGHT (+X) 2 m  ->  FORWARD (+Z) 2 m
    ->  RETURN to start   ->  hold

It carries NO show package and never touches show data.
"""

from __future__ import annotations

from dataclasses import dataclass

from .coordinates import studio_to_ned

TEST_TRAJECTORY_VERSION = "0.1.0"


@dataclass(frozen=True)
class _Keyframe:
    t: float
    p: tuple[float, float, float]
    label: str


#: t seconds, studio position (x=east, y=up, z=north)
TEST_KEYFRAMES: tuple[_Keyframe, ...] = (
    _Keyframe(0.0, (0.0, 2.0, 0.0), "START hold"),
    _Keyframe(3.0, (0.0, 2.0, 0.0), "hold"),
    _Keyframe(6.0, (0.0, 3.0, 0.0), "UP +1 m (studio +Y)"),
    _Keyframe(9.0, (0.0, 3.0, 0.0), "hold"),
    _Keyframe(12.0, (2.0, 3.0, 0.0), "RIGHT +2 m (studio +X)"),
    _Keyframe(15.0, (2.0, 3.0, 0.0), "hold"),
    _Keyframe(18.0, (2.0, 3.0, 2.0), "FORWARD +2 m (studio +Z)"),
    _Keyframe(21.0, (2.0, 3.0, 2.0), "hold"),
    _Keyframe(26.0, (0.0, 2.0, 0.0), "RETURN to start"),
    _Keyframe(29.0, (0.0, 2.0, 0.0), "END hold"),
)


class _TestSample:
    """Duck-typed like a package sample so the sampler can consume it directly."""

    __slots__ = ("t", "p", "v")

    def __init__(self, t: float, p: tuple[float, float, float], v: tuple[float, float, float]):
        self.t = t
        self.p = p
        self.v = v


def build_test_trajectory_samples(rate_hz: float = 10.0) -> list[_TestSample]:
    """Piecewise-linear densification of the keyframes at ``rate_hz``."""
    step = 1.0 / rate_hz
    samples: list[_TestSample] = []
    total = TEST_KEYFRAMES[-1].t
    i = 0
    t = 0.0
    while t <= total + 1e-9:
        while i + 1 < len(TEST_KEYFRAMES) - 1 and TEST_KEYFRAMES[i + 1].t <= t:
            i += 1
        a, b = TEST_KEYFRAMES[i], TEST_KEYFRAMES[i + 1]
        span = b.t - a.t
        u = 0.0 if span <= 0 else max(0.0, min(1.0, (t - a.t) / span))
        p = tuple(a.p[k] + (b.p[k] - a.p[k]) * u for k in range(3))
        v = tuple(0.0 if span <= 0 else (b.p[k] - a.p[k]) / span for k in range(3))
        samples.append(_TestSample(t, p, v))  # type: ignore[arg-type]
        t += step
    return samples


def coordinate_calibration_report() -> dict[str, str]:
    """
    Developer diagnostics: what each requested studio axis becomes in NED for
    the test trajectory. Makes an axis/sign inversion immediately visible.
    """
    right = studio_to_ned((1.0, 0.0, 0.0))
    up = studio_to_ned((0.0, 1.0, 0.0))
    forward = studio_to_ned((0.0, 0.0, 1.0))
    return {
        "requestedStudioPlusX": f"NED (N,E,D) = {right}  -> +East",
        "requestedStudioPlusY": f"NED (N,E,D) = {up}  -> NEGATIVE Down (altitude up)",
        "requestedStudioPlusZ": f"NED (N,E,D) = {forward}  -> +North",
        "testPattern": " -> ".join(k.label for k in TEST_KEYFRAMES),
        "version": TEST_TRAJECTORY_VERSION,
    }
