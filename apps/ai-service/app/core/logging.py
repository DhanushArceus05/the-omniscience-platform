"""Structured logging configuration.

Uses the standard library logging module with a JSON formatter so
log output is consistent with the Node services (packages/utils
logger), satisfying observability requirements (Claude Development
Rule 11).
"""

import json
import logging
import sys
from datetime import UTC, datetime


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname.lower(),
            "service": "ai-service",
            "message": record.getMessage(),
            "time": datetime.now(UTC).isoformat(),
            "logger": record.name,
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging(level: str = "info") -> logging.Logger:
    logger = logging.getLogger("omniscience.ai-service")
    logger.setLevel(level.upper())
    logger.handlers.clear()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.propagate = False

    return logger
