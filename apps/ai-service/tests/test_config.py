from app.core.config import Settings


def test_settings_apply_defaults(monkeypatch) -> None:
    monkeypatch.delenv("AI_SERVICE_PORT", raising=False)
    settings = Settings(_env_file=None)
    assert settings.ai_service_port == 8000
    assert settings.ai_service_host == "0.0.0.0"


def test_settings_read_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("AI_SERVICE_PORT", "9001")
    settings = Settings(_env_file=None)
    assert settings.ai_service_port == 9001
