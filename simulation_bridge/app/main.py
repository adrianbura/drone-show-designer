"""
Drone Show Studio — Simulation Bridge (SIMULATION ONLY).

A local FastAPI service that replays ONE validated Drone Show Studio trajectory
through a local PX4 SITL vehicle (or an in-process mock) and reports tracking
diagnostics. It binds to loopback, accepts only local simulation endpoints, and
contains no path to a physical aircraft.

Run it with:  python -m uvicorn app.main:app --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import BRIDGE_VERSION
from .api.v1 import router as v1_router
from .config import SIMULATION_ONLY, Settings, get_settings
from .models.errors import BridgeError
from .services.runner import SimulationRunner

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("dss.bridge")

#: HTTP status per error class — the studio maps on the code, not the status.
_STATUS_BY_CODE = {
    "BRIDGE_CONFIG_INVALID": 500,
    "NON_LOCAL_ENDPOINT_REJECTED": 403,
    "PACKAGE_INVALID": 422,
    "PACKAGE_STALE": 409,
    "SHOW_VALIDATION_FAILED": 409,
    "TRAJECTORY_INVALID": 422,
    "PX4_NOT_AVAILABLE": 503,
    "PX4_CONNECTION_FAILED": 503,
    "VEHICLE_NOT_DISCOVERED": 503,
    "MULTIPLE_SYSTEMS_NOT_SUPPORTED": 409,
    "MULTI_VEHICLE_NOT_SUPPORTED": 409,
    "SIMULATION_NOT_READY": 409,
    "SIMULATION_ALREADY_RUNNING": 409,
    "SIMULATION_CANCELLED": 409,
    "TELEMETRY_UNAVAILABLE": 503,
    "SIMULATION_EXECUTION_FAILED": 500,
    "INVALID_STATE_TRANSITION": 409,
}


def create_app(settings: Settings | None = None, *, time_scale: float = 1.0) -> FastAPI:
    settings = (settings or get_settings()).validate()
    app = FastAPI(
        title="Drone Show Studio — Simulation Bridge",
        version=BRIDGE_VERSION,
        description=(
            "SIMULATION ONLY. Replays one validated studio trajectory through a local "
            "PX4 SITL vehicle or an in-process mock. No physical-aircraft capability."
        ),
    )
    app.state.settings = settings
    app.state.runner = SimulationRunner(settings, time_scale=time_scale)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )

    @app.exception_handler(BridgeError)
    async def _bridge_error(_: Request, exc: BridgeError) -> JSONResponse:
        log.warning("bridge error %s: %s (%s)", exc.code, exc.message, exc.detail)
        return JSONResponse(status_code=_STATUS_BY_CODE.get(exc.code, 400), content=exc.to_dict())

    @app.get("/")
    async def root() -> dict:
        return {
            "service": "drone-show-studio-simulation-bridge",
            "version": BRIDGE_VERSION,
            "simulationOnly": SIMULATION_ONLY,
            "docs": "/docs",
            "api": "/api/v1/health",
        }

    app.include_router(v1_router)

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        runner: SimulationRunner = app.state.runner
        if runner.is_running() and runner.record:
            await runner.cancel(runner.record.run_id)

    log.info(
        "simulation bridge ready host=%s port=%s endpoint=%s setpoints=%.0f Hz",
        settings.host, settings.port, settings.px4_endpoint, settings.setpoint_rate_hz,
    )
    return app


app = create_app()
