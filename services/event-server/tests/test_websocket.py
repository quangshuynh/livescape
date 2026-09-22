from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import effect_clear, effect_trigger, scene_change


def test_new_client_receives_a_state_sync_snapshot(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        message = socket.receive_json()

    assert message["type"] == "state.sync"
    assert message["source"] == "system"
    assert message["version"] == 1
    assert message["payload"] == {"sceneId": "city", "effects": []}


def test_reconnecting_client_is_told_the_current_scene_and_effects(client: TestClient) -> None:
    client.post("/api/events", json=scene_change("space"))
    client.post("/api/events", json=effect_trigger("snow", intensity=0.4, durationMs=None))

    with client.websocket_connect("/ws") as socket:
        message = socket.receive_json()

    assert message["payload"]["sceneId"] == "space"
    assert message["payload"]["effects"] == [
        {"effectId": "snow", "intensity": 0.4, "durationMs": None}
    ]


def test_accepted_events_are_broadcast_to_connected_clients(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        socket.receive_json()  # state.sync

        response = client.post("/api/events", json=scene_change("forest", transitionMs=250))
        assert response.json()["deliveredTo"] == 1

        event = socket.receive_json()

    assert event["type"] == "scene.change"
    assert event["payload"] == {"sceneId": "forest", "transitionMs": 250}


def test_every_connected_client_receives_the_same_event(client: TestClient) -> None:
    with client.websocket_connect("/ws") as first, client.websocket_connect("/ws") as second:
        first.receive_json()
        second.receive_json()

        response = client.post("/api/events", json=effect_trigger("rain", intensity=0.8))
        assert response.json()["deliveredTo"] == 2

        first_event = first.receive_json()
        second_event = second.receive_json()

    assert first_event == second_event
    assert first_event["payload"]["effectId"] == "rain"


def test_rejected_events_are_not_broadcast(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        socket.receive_json()  # state.sync

        assert client.post("/api/events", json=scene_change("volcano")).status_code == 422

        client.post("/api/events", json=effect_clear())
        assert socket.receive_json()["type"] == "effect.clear"


def test_inbound_socket_frames_are_ignored_not_executed(client: TestClient) -> None:
    """The socket is a subscription channel; it never accepts commands."""
    with client.websocket_connect("/ws") as socket:
        socket.receive_json()
        socket.send_json({"version": 1, "type": "scene.change", "payload": {"sceneId": "space"}})

        client.post("/api/events", json=scene_change("forest"))
        assert socket.receive_json()["payload"]["sceneId"] == "forest"

    assert client.get("/healthz").json()["currentScene"] == "forest"


def test_client_count_returns_to_zero_after_disconnect(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        socket.receive_json()
        assert client.get("/healthz").json()["connectedClients"] == 1

    assert client.get("/healthz").json()["connectedClients"] == 0
