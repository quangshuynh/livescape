"""Simulated platform event -> adapter -> the real event server.

These tests use the event server package from this repository. They prove that
the adapter produces the very same ``scene.action`` the control panel sends,
that the server's ownership and cooldown rules apply to it unchanged, and that
the adapter survives the server disappearing and coming back.
"""

from __future__ import annotations

import asyncio
import json
import socket
import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest

pytest.importorskip("livescape_event_server", reason="needs services/event-server installed")
uvicorn = pytest.importorskip("uvicorn")

from fastapi.testclient import TestClient  # noqa: E402
from livescape_event_server.app import create_app  # noqa: E402
from livescape_event_server.config import Settings  # noqa: E402

from livescape_platform_adapter.adapter import Adapter  # noqa: E402
from livescape_platform_adapter.client import (  # noqa: E402
    EventServerClient,
    HttpResponse,
    UrllibTransport,
)
from livescape_platform_adapter.mapping import (  # noqa: E402
    MappingRule,
    MappingTable,
    load_mappings,
)
from livescape_platform_adapter.simulation import (  # noqa: E402
    SimulationScript,
    normalize_simulation_event,
)

from .conftest import ManualClock, inline_runner  # noqa: E402


class InProcessTransport:
    """Posts through FastAPI's in-process test client instead of a socket."""

    def __init__(self, client: TestClient) -> None:
        self._client = client

    def post_json(self, path: str, body: dict[str, Any]) -> HttpResponse:
        response = self._client.post(path, json=body)
        return HttpResponse(response.status_code, response.content, dict(response.headers))


@pytest.fixture
def server_clock() -> ManualClock:
    return ManualClock()


@pytest.fixture
def server(server_clock: ManualClock) -> Iterator[TestClient]:
    app = create_app(Settings())
    app.state.clock = server_clock
    with TestClient(app) as client:
        yield client


def make_adapter(transport: Any, mappings: MappingTable | None = None) -> Adapter:
    return Adapter(
        mappings or load_mappings(),
        EventServerClient(transport, "simulation"),
        runner=inline_runner,
        report=lambda line: None,
    )


def show_roadside(server: TestClient) -> None:
    response = server.post(
        "/api/events",
        json={"version": 1, "type": "scene.change", "payload": {"sceneId": "roadside-workshop"}},
    )
    assert response.status_code == 202


def feed(adapter: Adapter, *raw: object) -> None:
    for event in raw:
        try:
            adapter.offer(normalize_simulation_event(event))
        except ValueError as exc:
            adapter.offer(exc)  # type: ignore[arg-type]
    asyncio.run(adapter.dispatch_pending())


def test_a_simulated_gift_reaches_renderers_as_the_control_panel_scene_action(
    server: TestClient,
) -> None:
    show_roadside(server)
    adapter = make_adapter(InProcessTransport(server))
    script = SimulationScript()

    with server.websocket_connect("/ws") as renderer:
        renderer.receive_json()  # state.sync
        feed(adapter, script.gift("demo.bus"))
        event = renderer.receive_json()

    assert adapter.counters.accepted == 1
    assert event["type"] == "scene.action"
    assert event["source"] == "simulation"
    assert event["payload"] == {"actionId": "roadside.send-bus"}
    # The broadcast envelope has exactly the protocol's fields: nothing about
    # the platform, the gift or the viewer reaches the renderer.
    assert set(event) == {"version", "id", "type", "source", "timestamp", "payload"}
    wire = json.dumps(event)
    for leaked in ("demo.bus", "sim-viewer", "Simulated Viewer", "gift", "sim-0000"):
        assert leaked not in wire


def test_leaves_are_sent_as_the_foreground_action(server: TestClient) -> None:
    show_roadside(server)
    adapter = make_adapter(InProcessTransport(server))

    with server.websocket_connect("/ws") as renderer:
        renderer.receive_json()
        feed(adapter, SimulationScript().gift("demo.leaves"))
        assert renderer.receive_json()["payload"] == {"actionId": "roadside.blow-leaves"}


def test_the_action_is_not_replayed_to_a_renderer_that_connects_later(
    server: TestClient,
) -> None:
    show_roadside(server)
    feed(make_adapter(InProcessTransport(server)), SimulationScript().gift("demo.bus"))

    with server.websocket_connect("/ws") as late:
        sync = late.receive_json()

    assert sync["type"] == "state.sync"
    assert "actionId" not in json.dumps(sync)


def test_the_wrong_scene_is_refused_by_the_server(server: TestClient) -> None:
    adapter = make_adapter(InProcessTransport(server))  # default scene: city

    feed(adapter, SimulationScript().gift("demo.bus"))

    assert adapter.counters.refused_wrong_scene == 1
    assert "roadside-workshop" in (adapter.last_result or "")


def test_the_server_cooldown_applies_to_the_adapter(
    server: TestClient, server_clock: ManualClock
) -> None:
    show_roadside(server)
    adapter = make_adapter(InProcessTransport(server))
    script = SimulationScript()

    feed(adapter, script.gift("demo.bus"))
    feed(adapter, script.gift("demo.bus"))  # server says 429, Retry-After 8 s
    feed(adapter, script.gift("demo.bus"))  # held locally, not sent

    assert adapter.counters.accepted == 1
    assert adapter.counters.refused_cooldown == 1
    assert adapter.counters.held_for_cooldown == 1
    assert 7000 <= adapter.snapshot()["cooldownHoldsMs"]["roadside.send-bus"] <= 8000


def test_fifty_simulated_gifts_cost_one_broadcast(server: TestClient) -> None:
    show_roadside(server)
    adapter = make_adapter(InProcessTransport(server))

    with server.websocket_connect("/ws") as renderer:
        renderer.receive_json()
        feed(adapter, *SimulationScript().scenario("burst"))
        assert renderer.receive_json()["payload"] == {"actionId": "roadside.send-bus"}
        health = server.get("/healthz").json()

    assert adapter.counters.submitted == 1
    assert adapter.counters.coalesced == 49
    assert 0 < health["actionCooldowns"]["roadside.send-bus"] <= 8000


def test_an_action_the_server_does_not_know_is_a_422(server: TestClient) -> None:
    # A mapping table built around the validation, as if the adapter's registry
    # copy had drifted from the server's: the server stays the authority.
    drifted = MappingTable([MappingRule("simulation", "gift", "demo.tank", "roadside.send-tank")])
    adapter = make_adapter(InProcessTransport(server), drifted)

    feed(adapter, SimulationScript().gift("demo.tank"))

    assert adapter.counters.rejected_invalid == 1


# ------------------------------------------------------------- real sockets


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class LiveServer:
    def __init__(self, port: int) -> None:
        app = create_app(Settings(port=port))
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self) -> LiveServer:
        self.thread.start()
        deadline = time.monotonic() + 10
        while not self.server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("event server did not start")
            time.sleep(0.02)
        return self

    def __exit__(self, *exc: object) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=10)


def test_the_adapter_survives_an_outage_and_recovers_over_real_http() -> None:
    port = _free_port()
    transport = UrllibTransport(f"http://127.0.0.1:{port}", timeout_s=2.0)
    clock = ManualClock()
    adapter = Adapter(
        load_mappings(),
        EventServerClient(transport, "simulation"),
        clock=clock,
        report=lambda line: None,
    )
    script = SimulationScript()

    async def send(raw: object) -> None:
        adapter.offer(normalize_simulation_event(raw))
        await adapter.dispatch_pending()

    # Server down: the action is dropped, the adapter keeps going.
    asyncio.run(send(script.gift("demo.bus")))
    assert adapter.server_status == "unavailable"
    assert adapter.counters.server_unreachable == 1

    with LiveServer(port):
        clock.advance(1.0)
        asyncio.run(send(script.gift("demo.follow-up")))  # unmapped, not sent
        asyncio.run(send(script.gift("demo.car")))

    assert adapter.server_status == "available"
    # City is showing on a fresh server, so the car is refused as wrong-scene:
    # the round trip worked, and nothing from the outage was replayed.
    assert adapter.counters.refused_wrong_scene == 1
    assert adapter.counters.submitted == 2
