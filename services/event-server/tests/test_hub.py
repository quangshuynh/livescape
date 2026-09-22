from __future__ import annotations

from typing import Any

import pytest

from livescape_event_server.hub import ConnectionHub


class RecordingClient:
    def __init__(self) -> None:
        self.received: list[dict[str, Any]] = []

    async def send_json(self, data: Any) -> None:
        self.received.append(data)


class BrokenClient:
    def __init__(self) -> None:
        self.attempts = 0

    async def send_json(self, data: Any) -> None:
        self.attempts += 1
        raise ConnectionResetError("socket is gone")


@pytest.mark.anyio
async def test_broadcast_reaches_every_registered_client() -> None:
    hub = ConnectionHub()
    first, second = RecordingClient(), RecordingClient()
    await hub.register(first)
    await hub.register(second)

    delivered = await hub.broadcast({"type": "effect.clear"})

    assert delivered == 2
    assert first.received == second.received == [{"type": "effect.clear"}]


@pytest.mark.anyio
async def test_one_broken_client_does_not_block_the_others() -> None:
    hub = ConnectionHub()
    broken, healthy = BrokenClient(), RecordingClient()
    await hub.register(broken)
    await hub.register(healthy)

    delivered = await hub.broadcast({"type": "scene.change"})

    assert delivered == 1
    assert healthy.received == [{"type": "scene.change"}]
    assert broken.attempts == 1


@pytest.mark.anyio
async def test_broken_clients_are_dropped_from_the_hub() -> None:
    hub = ConnectionHub()
    broken = BrokenClient()
    await hub.register(broken)

    await hub.broadcast({"type": "scene.change"})

    assert hub.client_count == 0
    await hub.broadcast({"type": "scene.change"})
    assert broken.attempts == 1, "a dropped client must not be sent to again"


@pytest.mark.anyio
async def test_broadcast_with_no_clients_is_a_no_op() -> None:
    assert await ConnectionHub().broadcast({"type": "scene.change"}) == 0


@pytest.mark.anyio
async def test_unregister_is_idempotent() -> None:
    hub = ConnectionHub()
    client = RecordingClient()
    await hub.register(client)
    await hub.unregister(client)
    await hub.unregister(client)

    assert hub.client_count == 0
