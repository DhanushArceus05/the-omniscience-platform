"""Health-check schema, kept in lockstep with
packages/types/src/health.ts and packages/schemas/src/health.ts.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ServiceStatus = Literal["ok", "degraded", "down"]


class HealthCheckResponse(BaseModel):
    status: ServiceStatus
    service: str
    version: str
    timestamp: datetime
    uptime_seconds: float = Field(ge=0, serialization_alias="uptimeSeconds")

    model_config = {
        "populate_by_name": True,
        "json_schema_extra": {
            "example": {
                "status": "ok",
                "service": "ai-service",
                "version": "0.1.0",
                "timestamp": "2026-07-11T12:00:00Z",
                "uptimeSeconds": 12.5,
            }
        },
    }
