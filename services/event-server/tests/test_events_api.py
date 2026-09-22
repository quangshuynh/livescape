from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from .conftest import effect_clear, effect_trigger, scene_change


def test_accepts_a_valid_scene_change(client: TestClient) -> None:
    response = client.post("/api/events", json=scene_change("forest", transitionMs=400))

    assert response.status_code == 202
    event = response.json()["event"]
    assert event["type"] == "scene.change"
    assert event["source"] == "manual"
    assert event["payload"] == {"sceneId": "forest", "transitionMs": 400}
    # Identity and time are assigned by the server, never by the client.
    assert event["id"]
    assert event["timestamp"].endswith("Z")
    assert response.json()["deliveredTo"] == 0


def test_effect_trigger_falls_back_to_the_registry_duration(client: TestClient) -> None:
    response = client.post("/api/events", json=effect_trigger("fireworks", intensity=0.5))

    assert response.status_code == 202
    assert response.json()["event"]["payload"] == {
        "effectId": "fireworks",
        "intensity": 0.5,
        "durationMs": 8000,
    }


def test_effect_trigger_keeps_an_explicit_null_duration(client: TestClient) -> None:
    response = client.post(
        "/api/events", json=effect_trigger("fireworks", intensity=1, durationMs=None)
    )

    assert response.json()["event"]["payload"]["durationMs"] is None


def test_effect_clear_without_an_id_means_clear_all(client: TestClient) -> None:
    response = client.post("/api/events", json=effect_clear())

    assert response.status_code == 202
    assert response.json()["event"]["payload"] == {"effectId": None}


@pytest.mark.parametrize(
    ("label", "body"),
    [
        ("unknown scene id", scene_change("volcano")),
        ("unknown effect id", effect_trigger("lasers")),
        ("unknown effect id on clear", effect_clear("lasers")),
        ("unknown event type", {"version": 1, "type": "scene.explode", "payload": {}}),
        ("unknown source", {**scene_change(), "source": "tiktok"}),
        ("unsupported version", {**scene_change(), "version": 2}),
        ("missing version", {"type": "scene.change", "payload": {"sceneId": "city"}}),
        ("missing payload", {"version": 1, "type": "scene.change"}),
        ("payload is not an object", {"version": 1, "type": "scene.change", "payload": "city"}),
        ("transition below range", scene_change("city", transitionMs=-1)),
        ("transition above range", scene_change("city", transitionMs=10_001)),
        ("intensity above range", effect_trigger("rain", intensity=1.5)),
        ("intensity below range", effect_trigger("rain", intensity=0)),
        ("duration below range", effect_trigger("rain", durationMs=5)),
        ("duration above range", effect_trigger("rain", durationMs=10_000_000)),
        ("unexpected payload field", scene_change("city", shellCommand="rm -rf /")),
        ("scene id is not a string", scene_change(None)),
        ("body is not an object", ["scene.change"]),
    ],
)
def test_rejects_malformed_events(client: TestClient, label: str, body: object) -> None:
    response = client.post("/api/events", json=body)

    assert response.status_code == 422, f"{label} should have been rejected"


def test_rejecting_an_event_leaves_state_untouched(client: TestClient) -> None:
    client.post("/api/events", json=scene_change("forest"))
    client.post("/api/events", json=scene_change("volcano"))

    assert client.get("/healthz").json()["currentScene"] == "forest"


def test_state_sync_cannot_be_injected_by_a_client(client: TestClient) -> None:
    """``state.sync`` is server-authored; clients must not be able to forge it."""
    response = client.post(
        "/api/events",
        json={
            "version": 1,
            "type": "state.sync",
            "source": "system",
            "payload": {"sceneId": "space", "effects": []},
        },
    )

    assert response.status_code == 422
