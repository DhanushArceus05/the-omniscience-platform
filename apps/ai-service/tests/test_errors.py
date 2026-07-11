from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_unknown_route_returns_api_error_envelope() -> None:
    response = client.get("/this-route-does-not-exist")
    assert response.status_code == 404
    body = response.json()
    assert body["success"] is False
    assert "code" in body["error"]
    assert "message" in body["error"]


def test_error_envelope_never_leaks_raw_traceback() -> None:
    response = client.get("/this-route-does-not-exist")
    body = response.json()
    assert "Traceback" not in str(body)
