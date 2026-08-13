"""
Tracking analysis: planned vs simulated position/velocity.

These are SIMULATION DIAGNOSTICS. Nothing here is a real-flight tolerance and
no value is invented — when telemetry is missing the metric is ``None``.
"""

from __future__ import annotations

import math
from typing import Sequence

from ..models.run import TrackingMetrics, TrackingPoint

Vec3 = tuple[float, float, float]


def euclidean(a: Vec3, b: Vec3) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def _rms(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return math.sqrt(sum(v * v for v in values) / len(values))


def _percentile(values: Sequence[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    idx = (len(ordered) - 1) * pct
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return ordered[int(idx)]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (idx - lo)


def compute_tracking_metrics(points: Sequence[TrackingPoint]) -> TrackingMetrics | None:
    if not points:
        return None
    errors = [p.error for p in points]
    dx = [p.actual[0] - p.planned[0] for p in points]
    dy = [p.actual[1] - p.planned[1] for p in points]
    dz = [p.actual[2] - p.planned[2] for p in points]

    velocity_errors = [
        euclidean(p.actual_velocity, p.planned_velocity)
        for p in points
        if p.actual_velocity is not None and p.planned_velocity is not None
    ]

    return TrackingMetrics(
        sampleCount=len(points),
        rmsPositionError=_rms(errors),
        meanPositionError=sum(errors) / len(errors),
        maxPositionError=max(errors),
        p95PositionError=_percentile(errors, 0.95),
        finalPositionError=errors[-1],
        rmsErrorX=_rms(dx),
        rmsErrorY=_rms(dy),
        rmsErrorZ=_rms(dz),
        rmsVelocityError=_rms(velocity_errors) if velocity_errors else None,
        maxVelocityError=max(velocity_errors) if velocity_errors else None,
        estimatedTrackingLagSeconds=estimate_tracking_lag(points),
    )


def estimate_tracking_lag(points: Sequence[TrackingPoint], max_lag_s: float = 2.0) -> float | None:
    """
    Coarse ESTIMATED TRACKING LAG: the shift (in whole telemetry steps) that
    minimises the mean planned-vs-actual distance. Not an end-to-end measured
    controller latency, and deliberately labelled as an estimate.
    """
    if len(points) < 8:
        return None
    dt = (points[-1].t - points[0].t) / (len(points) - 1)
    if dt <= 0:
        return None
    max_shift = min(len(points) // 4, int(round(max_lag_s / dt)))
    if max_shift < 1:
        return None
    best_shift, best_cost = 0, math.inf
    for shift in range(0, max_shift + 1):
        pairs = [(points[i + shift].actual, points[i].planned) for i in range(len(points) - shift)]
        if not pairs:
            continue
        cost = sum(euclidean(a, p) for a, p in pairs) / len(pairs)
        if cost < best_cost - 1e-12:
            best_cost, best_shift = cost, shift
    return round(best_shift * dt, 4)


def classify_run(
    metrics: TrackingMetrics | None,
    *,
    warning_error_m: float,
    failure_error_m: float,
    had_errors: bool,
) -> tuple[str, list[str]]:
    """
    Simulation-diagnostic classification. PASS means the simulation completed and
    metrics were computed — NOT that real-world flight is safe.
    """
    warnings: list[str] = []
    if had_errors or metrics is None:
        return "FAIL", ["no tracking metrics could be computed"] if metrics is None else []
    if metrics.maxPositionError >= failure_error_m:
        return "FAIL", [
            f"maximum simulation tracking error {metrics.maxPositionError:.2f} m "
            f"exceeds the failure threshold {failure_error_m:.2f} m"
        ]
    if metrics.maxPositionError >= warning_error_m:
        warnings.append(
            f"maximum simulation tracking error {metrics.maxPositionError:.2f} m "
            f"exceeds the warning threshold {warning_error_m:.2f} m"
        )
        return "PASS_WITH_WARNINGS", warnings
    return "PASS", warnings
