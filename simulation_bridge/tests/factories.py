"""Deterministic package factories for the bridge test suite."""

from __future__ import annotations

from app.models.package import SimulationPackage
from app.services.integrity import simulation_payload_hash


def make_package(
    *,
    validation_state: str = "VALIDATED",
    stale: bool = False,
    samples: list[tuple[float, tuple[float, float, float]]] | None = None,
    drone_id: str = "DRN-001",
    payload_hash: str | None = None,
) -> SimulationPackage:
    pts = samples or [(i * 0.04, (0.0, 2.0 + i * 0.01, 0.0)) for i in range(60)]
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
            "id": "show-local",
            "handedness": "right-handed",
            "altitudeAxis": "y",
        },
        "sampleRate": 25.0,
        "showTimeZero": 0.0,
        "operationalTiming": {
            "firstPlayableShowTime": pts[0][0],
            "showStartOperationalTime": 0.0,
            "includesPreShow": False,
        },
        "algorithmVersions": {"planner": "0.1.0"},
        "validationProvenance": {
            "state": validation_state,
            "fullShowStatus": "VALIDATED" if validation_state.startswith("VALIDATED") else "FAILED",
            "stale": stale,
            "exportReadiness": "READY" if validation_state == "VALIDATED" else "BLOCKED",
            "errorCount": 0,
            "warningCount": 0,
            "engineVersion": "0.1.0",
        },
        "trajectory": {
            "droneId": drone_id,
            "droneIndex": 0,
            "homePosition": [0.0, 0.0, 0.0],
            "sampleCount": len(pts),
            "startTime": pts[0][0],
            "endTime": pts[-1][0],
            "duration": pts[-1][0] - pts[0][0],
            "samples": [{"t": t, "p": list(p), "v": [0.0, 0.0, 0.0]} for t, p in pts],
        },
    }
    computed = simulation_payload_hash(
        schema_version=1,
        show_package_id=body["showPackageId"],
        analysis_revision=body["analysisRevision"],
        drone_id=drone_id,
        sample_rate=25.0,
        samples=[(t, p) for t, p in pts],
    )
    return SimulationPackage(**body, payloadHash=payload_hash or computed)
