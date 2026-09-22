from __future__ import annotations

from fastapi.testclient import TestClient

from livescape_event_server.registry import PROTOCOL_VERSION

from .conftest import scene_change


def test_healthz_reports_ok(client: TestClient) -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["protocolVersion"] == PROTOCOL_VERSION
    assert body["connectedClients"] == 0
    assert body["currentScene"] == "city"
    assert body["uptimeSeconds"] >= 0
    assert body["activeEffects"] == []


def test_healthz_reflects_current_scene(client: TestClient) -> None:
    client.post("/api/events", json=scene_change("space"))

    assert client.get("/healthz").json()["currentScene"] == "space"


def test_healthz_lists_the_effects_currently_running(client: TestClient) -> None:
    client.post(
        "/api/events",
        json={
            "version": 1,
            "type": "effect.trigger",
            "source": "manual",
            "payload": {"effectId": "snow", "intensity": 1, "durationMs": None},
        },
    )

    assert client.get("/healthz").json()["activeEffects"] == ["snow"]


def test_registry_endpoint_exposes_the_allowlist(client: TestClient) -> None:
    body = client.get("/api/registry").json()

    assert body["protocolVersion"] == PROTOCOL_VERSION
    assert [scene["id"] for scene in body["scenes"]] == [
        "city",
        "forest",
        "space",
        "roadside-workshop",
    ]
    assert [effect["id"] for effect in body["effects"]] == ["rain", "snow", "fireworks"]
