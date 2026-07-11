"""Environment configuration for the AI service.

Mirrors packages/config in the Node workspace: fails fast and loudly
if required variables are missing, per Claude Development Rule 5
(no placeholders, no silent failures).
"""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    node_env: str = Field(default="development", alias="NODE_ENV")
    log_level: str = Field(default="info", alias="LOG_LEVEL")

    ai_service_port: int = Field(default=8000, alias="AI_SERVICE_PORT")
    ai_service_host: str = Field(default="0.0.0.0", alias="AI_SERVICE_HOST")

    api_cors_origin: str = Field(default="http://localhost:5173", alias="API_CORS_ORIGIN")

    postgres_url: str = Field(default="", alias="POSTGRES_URL")
    mongo_url: str = Field(default="", alias="MONGO_URL")
    redis_url: str = Field(default="", alias="REDIS_URL")
    qdrant_url: str = Field(default="", alias="QDRANT_URL")


@lru_cache
def get_settings() -> Settings:
    """Returns a cached Settings instance (loaded once per process)."""
    return Settings()
