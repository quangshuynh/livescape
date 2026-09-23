"""Scene actions: allowlisted, scene-owned, rate-bounded and never replayed."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from livescape_event_server.actions import ActionGate
from livescape_event_server.models import SceneActionRequest, envelope_from_request
from livescape_event_server.registry import SCENE_ACTION_IDS, action_entry, load_registry
from livescape_event_server.state import SceneState

from .conftest import ManualClock, effect_trigger, scene_action, scene_change


@pytest.fixture
def clock(app: FastAPI) -> ManualClock:
    manual = ManualClock()
    app.state.clock = manual
    return manual


@pytest.fixture
def roadside(client: TestClient, clock: ManualClock) -> TestClient:
    assert client.post("/api/events", json=scene_change("roadside-workshop")).status_code == 202
    return client


def test_registry_declares_every_action_with_an_owning_scene() -> None:
    registry = load_registry()
    scenes = {scene["id"] for scene in registry["scenes"]}

    assert tuple(entry["id"] for entry in registry["actions"]) == SCENE_ACTION_IDS
    for entry in registry["actions"]:
        assert entry["sceneId"] in scenes
        assert entry["label"]
        assert 250 <= entry["cooldownMs"] <= 60_000


def test_a_valid_action_is_accepted_and_broadcast_with_its_source(roadside: TestClient) -> None:
    with roadside.websocket_connect("/ws") as socket:
        socket.receive_json()  # state.sync

        response = roadside.post(
            "/api/events", json={**scene_action("roadside.send-bus"), "source": "simulation"}
        )
        assert response.status_code == 202
        assert response.json()["deliveredTo"] == 1

        event = socket.receive_json()

    assert event["type"] == "scene.action"
    assert event["source"] == "simulation"
    assert event["payload"] == {"actionId": "roadside.send-bus"}
    assert event["id"] and event["timestamp"].endswith("Z")


def test_every_connected_renderer_receives_an_accepted_action(roadside: TestClient) -> None:
    with roadside.websocket_connect("/ws") as first, roadside.websocket_connect("/ws") as second:
        first.receive_json()
        second.receive_json()

        response = roadside.post("/api/events", json=scene_action("roadside.blow-leaves"))
        assert response.json()["deliveredTo"] == 2

        assert first.receive_json() == second.receive_json()


@pytest.mark.parametrize(
    ("label", "body"),
    [
        ("unknown action", scene_action("roadside.send-tank")),
        ("near-miss spelling", scene_action("roadside.send_bus")),
        ("missing action id", {"version": 1, "type": "scene.action", "payload": {}}),
        ("action id is not a string", scene_action(None)),  # type: ignore[arg-type]
        ("payload is a string", {"version": 1, "type": "scene.action", "payload": "bus"}),
        ("extra field: script", scene_action("roadside.send-bus", script="alert(1)")),
        ("extra field: url", scene_action("roadside.send-bus", url="https://example.com")),
        ("extra field: path", scene_action("roadside.send-bus", path="/etc/passwd")),
        ("extra field: prompt", scene_action("roadside.send-bus", prompt="draw a dragon")),
        ("extra field: actor", scene_action("roadside.send-bus", actor={"sprite": "bus"})),
        ("unknown source", {**scene_action(), "source": "tiktok"}),
        ("unsupported version", {**scene_action(), "version": 2}),
        ("generic execute event", {"version": 1, "type": "execute", "payload": {"code": "1"}}),
        ("generic command event", {"version": 1, "type": "command", "payload": {"cmd": "ls"}}),
        ("scene-scoped execute", {"version": 1, "type": "scene.execute", "payload": {}}),
    ],
)
def test_rejects_malformed_or_arbitrary_actions(
    roadside: TestClient, label: str, body: object
) -> None:
    with roadside.websocket_connect("/ws") as socket:
        socket.receive_json()

        assert roadside.post("/api/events", json=body).status_code == 422, label

        # Nothing was broadcast: the next frame is the follow-up event.
        roadside.post("/api/events", json=scene_change("forest"))
        assert socket.receive_json()["type"] == "scene.change"


def test_an_action_for_another_scene_is_refused_and_not_broadcast(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        socket.receive_json()

        response = client.post("/api/events", json=scene_action("roadside.send-bus"))
        assert response.status_code == 409
        assert response.json()["sceneId"] == "roadside-workshop"
        assert "city" in response.json()["detail"]

        client.post("/api/events", json=scene_change("space"))
        assert socket.receive_json()["type"] == "scene.change"

        response = client.post("/api/events", json=scene_action("space.shooting-star"))
        assert response.status_code == 202
        assert socket.receive_json()["payload"] == {"actionId": "space.shooting-star"}


def test_an_action_does_not_touch_durable_state(roadside: TestClient) -> None:
    roadside.post("/api/events", json=effect_trigger("snow", durationMs=None))
    before = roadside.get("/healthz").json()

    assert roadside.post("/api/events", json=scene_action("roadside.rush-hour")).status_code == 202

    after = roadside.get("/healthz").json()
    assert after["currentScene"] == before["currentScene"] == "roadside-workshop"
    assert after["activeEffects"] == before["activeEffects"] == ["snow"]


def test_a_rejected_action_does_not_mutate_state(roadside: TestClient) -> None:
    roadside.post("/api/events", json=scene_action("roadside.send-tank"))
    roadside.post("/api/events", json=scene_action("forest.bird-flock"))

    health = roadside.get("/healthz").json()
    assert health["currentScene"] == "roadside-workshop"
    assert health["activeEffects"] == []
    # A refused action does not start a cooldown either.
    assert health["actionCooldowns"] == {}


def test_a_past_action_is_not_replayed_to_a_reconnecting_renderer(roadside: TestClient) -> None:
    with roadside.websocket_connect("/ws") as socket:
        socket.receive_json()
        roadside.post("/api/events", json=scene_action("roadside.send-bus"))
        assert socket.receive_json()["type"] == "scene.action"

    # The renderer was away when this one happened.
    assert roadside.post("/api/events", json=scene_action("roadside.send-car")).status_code == 202

    with roadside.websocket_connect("/ws") as socket:
        sync = socket.receive_json()
        assert sync["type"] == "state.sync"
        assert sync["payload"] == {"sceneId": "roadside-workshop", "effects": []}

        # The next frame is a new event, not a replay of either action.
        roadside.post("/api/events", json=scene_action("roadside.blow-leaves"))
        assert socket.receive_json()["payload"] == {"actionId": "roadside.blow-leaves"}


def test_an_action_repeated_inside_its_cooldown_is_throttled(
    roadside: TestClient, clock: ManualClock
) -> None:
    cooldown_ms = action_entry("roadside.send-bus")["cooldownMs"]
    assert roadside.post("/api/events", json=scene_action("roadside.send-bus")).status_code == 202

    clock.advance(1.0)
    response = roadside.post("/api/events", json=scene_action("roadside.send-bus"))
    assert response.status_code == 429
    assert response.json()["retryAfterMs"] == cooldown_ms - 1000
    assert response.headers["Retry-After"] == str(-(-(cooldown_ms - 1000) // 1000))
    assert roadside.get("/healthz").json()["actionCooldowns"] == {
        "roadside.send-bus": cooldown_ms - 1000
    }

    # Cooldowns are per action: a different one is unaffected.
    assert roadside.post("/api/events", json=scene_action("roadside.send-car")).status_code == 202

    clock.advance(cooldown_ms / 1000)
    assert roadside.post("/api/events", json=scene_action("roadside.send-bus")).status_code == 202


def test_a_burst_of_fifty_requests_becomes_one_broadcast(
    roadside: TestClient, clock: ManualClock
) -> None:
    with roadside.websocket_connect("/ws") as socket:
        socket.receive_json()

        statuses = []
        for _ in range(50):
            statuses.append(
                roadside.post("/api/events", json=scene_action("roadside.send-bus")).status_code
            )
            clock.advance(0.01)

        assert statuses.count(202) == 1
        assert statuses.count(429) == 49

        # Exactly one action reached the socket: the next frame is the marker.
        roadside.post("/api/events", json=effect_trigger("rain"))
        assert socket.receive_json()["type"] == "scene.action"
        assert socket.receive_json()["type"] == "effect.trigger"


def test_a_mixed_burst_is_bounded_by_the_number_of_actions(
    roadside: TestClient, clock: ManualClock
) -> None:
    roadside_actions = [
        entry["id"]
        for entry in load_registry()["actions"]
        if entry["sceneId"] == "roadside-workshop"
    ]
    accepted = 0
    for index in range(200):
        action_id = roadside_actions[index % len(roadside_actions)]
        if roadside.post("/api/events", json=scene_action(action_id)).status_code == 202:
            accepted += 1
        clock.advance(0.005)  # 200 requests inside one second

    assert accepted == len(roadside_actions)


def test_the_gate_accepts_again_exactly_when_the_cooldown_ends() -> None:
    gate = ActionGate()
    cooldown_s = action_entry("roadside.blow-leaves")["cooldownMs"] / 1000

    assert gate.admit("roadside.blow-leaves", "roadside-workshop", 10.0).outcome == "accepted"
    held = gate.admit("roadside.blow-leaves", "roadside-workshop", 10.0 + cooldown_s - 0.001)
    assert held.outcome == "cooling-down"
    assert held.retry_after_ms == 1
    assert (
        gate.admit("roadside.blow-leaves", "roadside-workshop", 10.0 + cooldown_s).outcome
        == "accepted"
    )


def test_scene_state_ignores_a_scene_action() -> None:
    state = SceneState(default_scene="roadside-workshop")
    envelope = envelope_from_request(
        SceneActionRequest.model_validate(
            {"version": 1, "type": "scene.action", "payload": {"actionId": "roadside.send-car"}}
        )
    )

    state.apply(envelope)

    assert state.snapshot().model_dump() == SceneState("roadside-workshop").snapshot().model_dump()
