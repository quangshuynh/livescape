"""The simulated source is a bounded, real PlatformSource."""

from __future__ import annotations

import asyncio

from livescape_platform_adapter.events import NormalizationError, PlatformEvent
from livescape_platform_adapter.simulation import SimulationScript, SimulationSource
from livescape_platform_adapter.source import PlatformSource


def test_the_simulator_implements_the_source_interface() -> None:
    source: PlatformSource = SimulationSource()

    assert source.platform == "simulation"
    assert source.event_source == "simulation"
    assert source.status == "idle"


def test_events_are_normalized_on_the_way_out() -> None:
    async def scenario() -> list[PlatformEvent | NormalizationError]:
        source = SimulationSource()
        await source.connect()
        script = SimulationScript()
        source.emit(script.gift("demo.bus"))
        source.emit("garbage")
        source.emit(script.follow())
        received: list[PlatformEvent | NormalizationError] = []
        stream = source.events()
        for _ in range(3):
            received.append(await anext(stream))
        await source.disconnect()
        assert [item async for item in stream] == []
        assert source.status == "disconnected"
        return received

    bus, garbage, follow = asyncio.run(scenario())
    assert isinstance(bus, PlatformEvent) and bus.gift_id == "demo.bus"
    assert isinstance(garbage, NormalizationError)
    assert isinstance(follow, PlatformEvent) and follow.kind == "follow"


def test_the_inbox_is_bounded() -> None:
    async def scenario() -> SimulationSource:
        source = SimulationSource(capacity=10)
        await source.connect()
        script = SimulationScript()
        accepted = [source.emit(script.gift("demo.bus")) for _ in range(100)]
        assert accepted.count(True) == 10
        return source

    source = asyncio.run(scenario())
    assert source.pending() == 10
    assert source.overflowed == 90


def test_nothing_is_accepted_before_connect() -> None:
    assert SimulationSource().emit({"type": "follow"}) is False
