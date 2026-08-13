"""
Package validation + the validation gate.

Two independent checks:

1. STRUCTURAL — schema/version, ids, finite samples, monotonic time, sample
   rate, coordinate system, provenance presence, duration > 0, integrity hash.
2. GATE — the show's own validation state. The bridge NEVER re-validates the
   show and never silently bypasses studio validation.
"""

from __future__ import annotations

import math

from ..models.errors import BridgeError
from ..models.package import (
    KNOWN_COORDINATE_SYSTEMS,
    RUNNABLE_VALIDATION_STATES,
    SUPPORTED_PACKAGE_SCHEMA,
    SUPPORTED_PACKAGE_SCHEMA_VERSIONS,
    VALIDATION_STATES,
    SimulationPackage,
)
from .integrity import simulation_payload_hash

MAX_SAMPLE_RATE_HZ = 200.0
MIN_SAMPLE_RATE_HZ = 1.0


def _issue(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def validate_package(pkg: SimulationPackage, *, max_samples: int = 600_000) -> dict:
    """Structural validation. Returns a report; never raises for bad content."""
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    if pkg.schema_ != SUPPORTED_PACKAGE_SCHEMA:
        errors.append(_issue("PACKAGE_INVALID", f"unsupported schema {pkg.schema_!r}"))
    if pkg.schemaVersion not in SUPPORTED_PACKAGE_SCHEMA_VERSIONS:
        errors.append(_issue("PACKAGE_INVALID", f"unsupported schemaVersion {pkg.schemaVersion}"))
    if not pkg.showPackageId:
        errors.append(_issue("PACKAGE_INVALID", "showPackageId is missing"))
    if not pkg.analysisRevision:
        errors.append(_issue("PACKAGE_INVALID", "analysisRevision is missing"))
    if pkg.coordinateSystem.id not in KNOWN_COORDINATE_SYSTEMS:
        errors.append(
            _issue("PACKAGE_INVALID", f"unknown coordinate system {pkg.coordinateSystem.id!r}")
        )
    if pkg.coordinateSystem.altitudeAxis != "y":
        errors.append(_issue("PACKAGE_INVALID", "altitude axis must be studio Y"))
    if not (MIN_SAMPLE_RATE_HZ <= pkg.sampleRate <= MAX_SAMPLE_RATE_HZ):
        errors.append(_issue("PACKAGE_INVALID", f"sampleRate {pkg.sampleRate} out of range"))
    if pkg.showTimeZero != 0:
        errors.append(_issue("PACKAGE_INVALID", "showTimeZero must be 0"))
    if pkg.validationProvenance.state not in VALIDATION_STATES:
        errors.append(
            _issue("PACKAGE_INVALID", f"unknown validation state {pkg.validationProvenance.state!r}")
        )

    traj = pkg.trajectory
    if not traj.droneId:
        errors.append(_issue("TRAJECTORY_INVALID", "trajectory has no stable drone id"))
    samples = traj.samples
    if len(samples) < 2:
        errors.append(_issue("TRAJECTORY_INVALID", "trajectory needs at least two samples"))
    elif len(samples) > max_samples:
        errors.append(_issue("TRAJECTORY_INVALID", f"trajectory exceeds {max_samples} samples"))
    else:
        previous = -math.inf
        for i, s in enumerate(samples):
            if not s.finite():
                errors.append(_issue("TRAJECTORY_INVALID", f"non-finite sample at index {i}"))
                break
            if s.t <= previous:
                errors.append(_issue("TRAJECTORY_INVALID", f"non-monotonic timestamp at index {i}"))
                break
            previous = s.t
        else:
            duration = samples[-1].t - samples[0].t
            if duration <= 0:
                errors.append(_issue("TRAJECTORY_INVALID", "trajectory duration must be > 0"))
            if traj.sampleCount and traj.sampleCount != len(samples):
                warnings.append(
                    _issue("PACKAGE_INVALID", "declared sampleCount differs from the sample list")
                )

    expected_hash = simulation_payload_hash(
        schema_version=pkg.schemaVersion,
        show_package_id=pkg.showPackageId,
        analysis_revision=pkg.analysisRevision,
        drone_id=traj.droneId,
        sample_rate=pkg.sampleRate,
        samples=[(s.t, s.p) for s in samples],
    )
    if expected_hash != pkg.payloadHash:
        errors.append(
            _issue(
                "PACKAGE_INVALID",
                "simulationPayloadHash mismatch — package was modified after preparation",
            )
        )

    if samples and samples[0].t < 0:
        warnings.append(
            _issue(
                "PACKAGE_INVALID",
                "trajectory includes negative pre-show time (this is expected for launch phases)",
            )
        )

    state = pkg.validationProvenance.state
    runnable = not errors and state in RUNNABLE_VALIDATION_STATES
    if state not in RUNNABLE_VALIDATION_STATES:
        warnings.append(_issue(_gate_code(state), f"show validation state is {state}"))

    return {
        "accepted": not errors,
        "payloadHash": expected_hash,
        "errors": errors,
        "warnings": warnings,
        "validationState": state,
        "runnable": runnable,
    }


def _gate_code(state: str) -> str:
    if state == "STALE_VALIDATION":
        return "PACKAGE_STALE"
    if state == "FAILED_VALIDATION":
        return "SHOW_VALIDATION_FAILED"
    return "PACKAGE_INVALID"


def assert_package_acceptable(pkg: SimulationPackage, *, max_samples: int = 600_000) -> dict:
    """Structural gate. Raises ``PACKAGE_INVALID`` / ``TRAJECTORY_INVALID``."""
    report = validate_package(pkg, max_samples=max_samples)
    if not report["accepted"]:
        first = report["errors"][0]
        raise BridgeError(
            "TRAJECTORY_INVALID" if first["code"] == "TRAJECTORY_INVALID" else "PACKAGE_INVALID",
            first["message"],
            "; ".join(e["message"] for e in report["errors"][1:]),
        )
    return report


def assert_runnable(pkg: SimulationPackage) -> None:
    """
    Sprint 5 execution policy: only VALIDATED / VALIDATED_WITH_WARNINGS shows may
    run. Stale, failed and unvalidated shows are blocked (the built-in test
    trajectory is the only alternative and it carries no show package).
    """
    state = pkg.validationProvenance.state
    if state in RUNNABLE_VALIDATION_STATES:
        return
    if state == "STALE_VALIDATION":
        raise BridgeError("PACKAGE_STALE", "Full-show validation is stale — re-validate the show")
    if state == "FAILED_VALIDATION":
        raise BridgeError("SHOW_VALIDATION_FAILED", "Full-show validation FAILED — simulation blocked")
    raise BridgeError("SHOW_VALIDATION_FAILED", "Show is not validated — run full-show validation first")
