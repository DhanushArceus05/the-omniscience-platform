from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_200() -> None:
    response = client.get("/health")
    assert response.status_code == 200


def test_health_payload_shape() -> None:
    response = client.get("/health")
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "ai-service"
    assert "uptimeSeconds" in body
    assert body["uptimeSeconds"] >= 0


def test_health_timestamp_is_iso() -> None:
    response = client.get("/health")
    body = response.json()
    # Should not raise
    from datetime import datetime

    datetime.fromisoformat(body["timestamp"].replace("Z", "+00:00"))
