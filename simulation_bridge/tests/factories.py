"""Deterministic package factories for the bridge test suite."""

from __future__ import annotations

from app.models.package import SimulationPackage
from app.services.integrity import simulation_payload_hash


def make_package(
    *,
    validation_status: str = "VALIDATED",
    stale: bool = False,
    samples: list[tuple[float, tuple[float, float, float]]] | None = None,
    drone_id: str = "DRN-001",
) -> SimulationPackage:
    pts = samples or [(i * 0.04, (0.0, 2.0 + i * 0.01, 0.0)) for i in range(60)]
    payload_samples = [{"t": t, "p": list(p), "v": [0.0, 0.0, 0.0]} for t, p in pts]
    trajectory = {
        "droneId": drone_id,
        "droneIndex": 0,
        "homePosition": [0.0, 0.0, 0.0],
        "sampleCount": len(payload_samples),
        "startTime": pts[0][0],
        "endTime": pts[-1][0],
        "duration": pts[-1][0] - pts[0][0],
        "samples": payload_samples,
    }
    body = {
        "schema": "DroneShowStudioSimulationPackage",
        "schemaVersion": 1,
        "generator": "Drone Show Studio",
        "clientVersion": "test",
        "showPackageId": "show-test-0001",
        "analysisRevision": "rev-test-0001",
        "projectId": "prj-test",
        "projectName": "Bridge Test Show",
        "coordinateSystem": {
            "frame": "show-local",
            "upAxis": "Y",
            "handedness": "right",
            "units": "metres",
        },
        "sampleRate": 25.0,
        "showTimeZero": 0.0,
        "operationalTiming": {"showStartTime": 0.0, "preShowStartTime": 0.0},
        "algorithmVersions": {"planner": "0.1.0"},
        "validationProvenance": {
            "fullShowStatus": validation_status,
            "exportReadiness": "READY" if validation_status == "VALIDATED" else "BLOCKED",
            "stale": stale,
            "analysisRevision": "rev-test-0001",
            "engineVersion": "0.1.0",
        },
        "trajectory": trajectory,
    }
    return SimulationPackage(**body, payloadHash=simulation_payload_hash(body))
