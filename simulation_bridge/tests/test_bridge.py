"""
Bridge test suite — deterministic, PX4-free.

Covers: coordinate mapping round-trip and axis signs, the simulation-only
network guard, package validation gates, resampling, tracking metrics,
state-machine transitions, and a full mock run through the HTTP API.
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, assert_local_endpoint
from app.models.errors import BridgeError
from app.models.run import TrackingPoint
from app.main import create_app
from app.services.coordinates import ned_to_studio, studio_to_ned, studio_yaw_to_ned
from app.services.metrics import classify_run, compute_tracking_metrics
from app.services.sampler import SimulationTrajectorySampler
from app.services.state_machine import SimulationStateMachine
from app.services.test_trajectory import build_test_trajectory_samples
from app.services.validation import validate_package

from .factories import make_package


# --------------------------------------------------------------- coordinates

def test_studio_up_maps_to_negative_down():
    assert studio_to_ned((0.0, 5.0, 0.0)) == (0.0, 0.0, -5.0)


def test_studio_axes_map_to_expected_ned_axes():
    assert studio_to_ned((1.0, 0.0, 0.0)) == (0.0, 1.0, 0.0)  # +X -> East
    assert studio_to_ned((0.0, 0.0, 1.0)) == (1.0, 0.0, 0.0)  # +Z -> North


@pytest.mark.parametrize("p", [(1.0, 2.0, 3.0), (-4.5, 0.0, 7.25), (0.0, 0.0, 0.0)])
def test_coordinate_round_trip(p):
    assert ned_to_studio(studio_to_ned(p)) == pytest.approx(p)


def test_yaw_mapping():
    assert studio_yaw_to_ned(0.0) == pytest.approx(90.0)
    assert studio_yaw_to_ned(90.0) == pytest.approx(0.0)


# ------------------------------------------------------------ network guard

def test_local_endpoint_accepted():
    assert assert_local_endpoint("udpin://127.0.0.1:14540") == ("udpin", "127.0.0.1", 14540)


@pytest.mark.parametrize(
    "endpoint",
    ["udpin://8.8.8.8:14540", "udp://example.com:14540", "udpin://192.168.1.42:14540"],
)
def test_remote_endpoints_rejected(endpoint):
    with pytest.raises(BridgeError) as exc:
        assert_local_endpoint(endpoint)
    assert exc.value.code == "NON_LOCAL_ENDPOINT_REJECTED"


def test_non_loopback_bind_rejected():
    with pytest.raises(BridgeError):
        Settings(host="0.0.0.0").validate()


# ------------------------------------------------------------ package gates

def test_valid_package_is_runnable():
    result = validate_package(make_package())
    assert result["accepted"] is True
    assert result["runnable"] is True
    assert result["errors"] == []


def test_failed_show_validation_is_not_runnable():
    result = validate_package(make_package(validation_state="FAILED_VALIDATION"))
    assert result["runnable"] is False


def test_stale_analysis_is_not_runnable():
    result = validate_package(make_package(validation_state="STALE_VALIDATION", stale=True))
    assert result["runnable"] is False


def test_non_monotonic_samples_rejected():
    pkg = make_package(samples=[(0.0, (0, 1, 0)), (0.5, (0, 1, 0)), (0.25, (0, 1, 0))])
    result = validate_package(pkg)
    assert result["accepted"] is False


def test_non_finite_sample_rejected():
    pkg = make_package(samples=[(0.0, (0, 1, 0)), (0.5, (0, float("inf"), 0))])
    assert validate_package(pkg)["accepted"] is False


def test_tampered_payload_hash_rejected():
    tampered = make_package(payload_hash="sph-deadbeef-deadbeef")
    assert validate_package(tampered)["accepted"] is False


# ---------------------------------------------------------------- resampling

def test_resample_preserves_endpoints_and_rate():
    samples = build_test_trajectory_samples(10.0)
    refs = SimulationTrajectorySampler(samples).resample(25.0)
    assert refs[0].t_operational == pytest.approx(0.0)
    assert refs[-1].t_operational == pytest.approx(samples[-1].t, abs=0.05)
    assert refs[0].position == pytest.approx(samples[0].p)
    dt = refs[1].t_operational - refs[0].t_operational
    assert dt == pytest.approx(0.04)
    assert all(b.t_operational > a.t_operational for a, b in zip(refs, refs[1:]))


def test_test_trajectory_is_bounded_and_low_altitude():
    samples = build_test_trajectory_samples()
    assert max(s.p[1] for s in samples) <= 3.0
    assert max(abs(s.p[0]) for s in samples) <= 2.0


# ------------------------------------------------------------------- metrics

def test_perfect_tracking_passes():
    points = [
        TrackingPoint(t=i * 0.04, planned=(0.0, 2.0, 0.0), actual=(0.0, 2.0, 0.0), error=0.0)
        for i in range(30)
    ]
    metrics = compute_tracking_metrics(points)
    assert metrics is not None and metrics.rmsPositionError == 0.0
    status, _ = classify_run(metrics, warning_error_m=1.0, failure_error_m=5.0, had_errors=False)
    assert status == "PASS"


def test_large_tracking_error_fails():
    points = [
        TrackingPoint(t=i * 0.04, planned=(0.0, 2.0, 0.0), actual=(0.0, 12.0, 0.0), error=10.0)
        for i in range(10)
    ]
    status, notes = classify_run(
        compute_tracking_metrics(points), warning_error_m=1.0, failure_error_m=5.0, had_errors=False
    )
    assert status == "FAIL" and notes


def test_no_telemetry_yields_no_metrics():
    assert compute_tracking_metrics([]) is None


# ------------------------------------------------------------ state machine

def test_invalid_transition_rejected():
    machine = SimulationStateMachine()
    with pytest.raises(BridgeError) as exc:
        machine.to("RUNNING")
    assert exc.value.code == "INVALID_STATE_TRANSITION"


def test_happy_path_transitions():
    machine = SimulationStateMachine()
    for state in ("PACKAGE_LOADED", "PX4_CONNECTING", "PX4_CONNECTED", "READY", "RUNNING", "COMPLETED"):
        machine.to(state)
    assert machine.is_terminal()


# ------------------------------------------------------------------ HTTP API

@pytest.fixture()
def client():
    # time_scale compresses the simulation clock so the suite stays fast.
    with TestClient(create_app(time_scale=120.0)) as c:
        yield c


def test_health_reports_simulation_only(client):
    body = client.get("/api/v1/health").json()
    assert body["simulationOnly"] is True
    assert {a["id"] for a in body["adapters"]} >= {"MOCK", "PX4_SITL_MAVSDK"}
    assert any(a["id"] == "MDS" and not a["implemented"] for a in body["adapters"])


def test_no_vehicle_command_endpoints_exist(client):
    paths = client.get("/openapi.json").json()["paths"]
    joined = " ".join(paths)
    for forbidden in ("arm", "takeoff", "land", "goto", "mavlink"):
        assert forbidden not in joined


def test_full_mock_run_produces_report(client):
    pkg = make_package().model_dump(by_alias=True)
    prepared = client.post(
        "/api/v1/simulation/prepare", json={"package": pkg, "environmentMode": "MOCK"}
    )
    assert prepared.status_code == 200, prepared.text
    run_id = prepared.json()["runId"]
    assert prepared.json()["state"] == "READY"

    started = client.post("/api/v1/simulation/run", json={"runId": run_id, "mode": "SHOW_TRAJECTORY"})
    assert started.status_code == 200, started.text

    report = _await_report(client, run_id)
    assert report["environment"]["mode"] == "MOCK"
    assert "MOCK" in report["statement"]
    assert report["trackingMetrics"]["sampleCount"] > 0
    assert report["selectedDroneId"] == "DRN-001"
    assert report["coordinateMapping"]["down"] == "-Studio Y"
    assert report["status"] in ("PASS", "PASS_WITH_WARNINGS")


def test_test_trajectory_run_reports_calibration(client):
    prepared = client.post("/api/v1/simulation/prepare", json={"environmentMode": "MOCK"})
    run_id = prepared.json()["runId"]
    client.post("/api/v1/simulation/run", json={"runId": run_id, "mode": "TEST_TRAJECTORY"})
    report = _await_report(client, run_id)
    assert report["trajectorySource"] == "TEST_TRAJECTORY"
    assert report["coordinateCalibration"] is not None
    assert "NEGATIVE Down" in report["coordinateCalibration"]["requestedStudioPlusY"]


def test_failed_validation_package_cannot_run(client):
    pkg = make_package(validation_state="FAILED_VALIDATION").model_dump(by_alias=True)
    prepared = client.post(
        "/api/v1/simulation/prepare", json={"package": pkg, "environmentMode": "MOCK"}
    )
    assert prepared.status_code in (409, 422)
    assert prepared.json()["code"] in ("SHOW_VALIDATION_FAILED", "PACKAGE_INVALID", "PACKAGE_STALE")


def test_history_records_completed_runs(client):
    pkg = make_package().model_dump(by_alias=True)
    run_id = client.post(
        "/api/v1/simulation/prepare", json={"package": pkg, "environmentMode": "MOCK"}
    ).json()["runId"]
    client.post("/api/v1/simulation/run", json={"runId": run_id, "mode": "SHOW_TRAJECTORY"})
    _await_report(client, run_id)
    runs = client.get("/api/v1/simulation/history").json()["runs"]
    assert runs and runs[0]["runId"] == run_id
    assert runs[0]["maxPositionError"] is not None


def _await_report(client: TestClient, run_id: str) -> dict:
    for _ in range(600):
        state = client.get(f"/api/v1/simulation/{run_id}").json()
        if state["state"] in ("COMPLETED", "FAILED", "CANCELLED"):
            break
    response = client.get(f"/api/v1/simulation/{run_id}/report")
    assert response.status_code == 200, response.text
    body = response.json()
    assert math.isfinite(body["durationSeconds"])
    return body
