"""FastAPI application factory for the AI service.

Phase 0 wires only cross-cutting infrastructure (health, CORS,
logging, error handling). RAG, agents, vision, voice and predictive
modules are added in their approved phases per
docs/08_Development_Roadmap.md.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging


def create_app() -> FastAPI:
    settings = get_settings()
    logger = configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "ai-service started host=%s port=%s",
            settings.ai_service_host,
            settings.ai_service_port,
        )
        yield

    app = FastAPI(
        title="The Omniscience Platform — AI Service",
        version="0.1.0",
        description="FastAPI AI/ML service. Phase 0: Foundation only.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.api_cors_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app, logger)
    app.include_router(health_router)

    return app


app = create_app()
