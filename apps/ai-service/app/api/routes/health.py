"""Health-check route.

Unwrapped (no envelope) to stay compatible with standard infra
probes, mirroring apps/api's /health endpoint.
"""

import time
from datetime import UTC, datetime

from fastapi import APIRouter

from app.schemas.health import HealthCheckResponse

router = APIRouter(tags=["health"])

_START_TIME = time.monotonic()
_VERSION = "0.1.0"


@router.get("/health", response_model=HealthCheckResponse)
def get_health() -> HealthCheckResponse:
    uptime_seconds = time.monotonic() - _START_TIME
    return HealthCheckResponse(
        status="ok",
        service="ai-service",
        version=_VERSION,
        timestamp=datetime.now(UTC),
        uptime_seconds=uptime_seconds,
    )
