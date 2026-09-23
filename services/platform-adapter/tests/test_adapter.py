"""The adapter pipeline: dedup, mapping, coalescing, failure and burst bounds."""

from __future__ import annotations

import asyncio
import tracemalloc
from datetime import timedelta

import pytest

from livescape_platform_adapter.adapter import Adapter
from livescape_platform_adapter.client import SubmitResult
from livescape_platform_adapter.dedup import RecentEventIds
from livescape_platform_adapter.events import NormalizationError, PlatformEvent
from livescape_platform_adapter.mapping import MappingTable

from .conftest import FakeClient, ManualClock, gift, inline_runner


def run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


def unavailable(_: str) -> SubmitResult:
    return SubmitResult("unavailable", detail="refused")


def cooling(ms: int):  # type: ignore[no-untyped-def]
    return lambda _: SubmitResult("cooling-down", 429, retry_after_ms=ms)


# ------------------------------------------------------------------- one event


def test_one_mapped_event_becomes_one_request(adapter: Adapter, fake_client: FakeClient) -> None:
    assert adapter.offer(gift("demo.bus")) == "queued"
    assert run(adapter.dispatch_pending()) == 1

    assert fake_client.calls == ["roadside.send-bus"]
    counters = adapter.counters
    assert (counters.received, counters.mapped, counters.accepted) == (1, 1, 1)
    assert adapter.server_status == "available"


def test_a_malformed_event_is_counted_and_sends_nothing(
    adapter: Adapter, fake_client: FakeClient
) -> None:
    assert adapter.offer(NormalizationError("simulation", "gift id is missing")) == "malformed"
    run(adapter.dispatch_pending())

    assert fake_client.calls == []
    assert adapter.counters.malformed == 1


def test_an_unmapped_event_sends_nothing(adapter: Adapter, fake_client: FakeClient) -> None:
    assert adapter.offer(gift("demo.unknown")) == "unmapped"
    run(adapter.dispatch_pending())

    assert fake_client.calls == []
    assert adapter.counters.unmapped == 1


def test_below_minimum_sends_nothing(adapter: Adapter, fake_client: FakeClient) -> None:
    assert adapter.offer(gift("demo.rush", quantity=2)) == "below-minimum"
    assert adapter.offer(gift("demo.rush", event_id="evt-2", quantity=5)) == "queued"
    run(adapter.dispatch_pending())

    assert fake_client.calls == ["roadside.rush-hour"]
    assert adapter.counters.below_minimum == 1


# ------------------------------------------------------------- deduplication


def test_a_redelivered_event_is_ignored(adapter: Adapter, fake_client: FakeClient) -> None:
    adapter.offer(gift("demo.bus", event_id="evt-1"))
    run(adapter.dispatch_pending())

    assert adapter.offer(gift("demo.bus", event_id="evt-1")) == "duplicate"
    run(adapter.dispatch_pending())

    assert fake_client.calls == ["roadside.send-bus"]
    assert adapter.counters.duplicates == 1


def test_different_ids_for_the_same_gift_are_distinct_events(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    adapter.offer(gift("demo.car", event_id="evt-1"))
    run(adapter.dispatch_pending())
    clock.advance(2)
    assert adapter.offer(gift("demo.car", event_id="evt-2")) == "queued"
    run(adapter.dispatch_pending())

    assert fake_client.calls == ["roadside.send-car", "roadside.send-car"]


def test_a_redelivery_after_a_failed_send_is_still_a_duplicate(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    fake_client.respond = unavailable
    adapter.offer(gift("demo.bus", event_id="evt-1"))
    run(adapter.dispatch_pending())
    clock.advance(5)
    fake_client.respond = lambda _: SubmitResult("accepted", 202, delivered_to=1)

    # The platform retries after the outage; the moment has passed.
    assert adapter.offer(gift("demo.bus", event_id="evt-1")) == "duplicate"


def test_events_without_an_id_are_never_treated_as_duplicates(
    adapter: Adapter, clock: ManualClock
) -> None:
    assert adapter.offer(gift("demo.leaves", event_id=None)) == "queued"
    run(adapter.dispatch_pending())
    clock.advance(5)

    assert adapter.offer(gift("demo.leaves", event_id=None)) == "queued"
    assert adapter.counters.duplicates == 0


def test_an_event_that_is_too_old_is_dropped(adapter: Adapter, clock: ManualClock) -> None:
    old = gift("demo.bus", occurred_at=clock.wall() - timedelta(seconds=31))
    fresh = gift("demo.bus", event_id="evt-2", occurred_at=clock.wall() - timedelta(seconds=5))

    assert adapter.offer(old) == "stale"
    assert adapter.offer(fresh) == "queued"


# ------------------------------------------------------------ server outcomes


@pytest.mark.parametrize(
    ("result", "counter"),
    [
        (SubmitResult("wrong-scene", 409, detail="belongs to forest"), "refused_wrong_scene"),
        (SubmitResult("rejected", 422), "rejected_invalid"),
        (SubmitResult("cooling-down", 429, retry_after_ms=3000), "refused_cooldown"),
        (SubmitResult("server-error", 500, detail="unexpected HTTP 500"), "server_errors"),
    ],
)
def test_refusals_are_counted_and_never_retried(
    adapter: Adapter, fake_client: FakeClient, result: SubmitResult, counter: str
) -> None:
    fake_client.respond = lambda _: result
    adapter.offer(gift("demo.bus"))

    run(adapter.dispatch_pending())
    run(adapter.dispatch_pending())

    assert fake_client.calls == ["roadside.send-bus"]
    assert getattr(adapter.counters, counter) == 1
    assert adapter.server_status == "available"


def test_422_and_500_are_recorded_as_the_last_error(
    adapter: Adapter, fake_client: FakeClient
) -> None:
    fake_client.respond = lambda _: SubmitResult("rejected", 422)
    adapter.offer(gift("demo.bus"))
    run(adapter.dispatch_pending())

    assert (
        adapter.snapshot()["lastError"] == "roadside.send-bus: rejected by the event server (422)"
    )


def test_a_409_does_not_hold_the_action(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    fake_client.respond = lambda _: SubmitResult("wrong-scene", 409, detail="x")
    adapter.offer(gift("demo.birds", event_id="a"))
    run(adapter.dispatch_pending())
    clock.advance(0.1)

    # After an operator switches scene the next event must go straight through.
    assert adapter.offer(gift("demo.birds", event_id="b")) == "queued"


def test_a_429_holds_that_action_until_the_server_said(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    fake_client.respond = cooling(3000)
    adapter.offer(gift("demo.bus", event_id="a"))
    run(adapter.dispatch_pending())
    fake_client.respond = lambda _: SubmitResult("accepted", 202, delivered_to=1)

    clock.advance(2.9)
    assert adapter.offer(gift("demo.bus", event_id="b")) == "cooldown-held"
    # Other actions are unaffected.
    assert adapter.offer(gift("demo.car", event_id="c")) == "queued"
    run(adapter.dispatch_pending())

    clock.advance(0.2)
    assert adapter.offer(gift("demo.bus", event_id="d")) == "queued"
    assert adapter.snapshot()["cooldownHoldsMs"] == {}
    assert fake_client.calls == ["roadside.send-bus", "roadside.send-car"]


def test_holds_are_reported_in_the_status(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    fake_client.respond = cooling(8000)
    adapter.offer(gift("demo.bus"))
    run(adapter.dispatch_pending())
    clock.advance(1)

    assert adapter.snapshot()["cooldownHoldsMs"] == {"roadside.send-bus": 7000}


def test_an_accept_with_no_renderer_connected_is_visible(
    adapter: Adapter, fake_client: FakeClient
) -> None:
    fake_client.respond = lambda _: SubmitResult("accepted", 202, delivered_to=0)
    adapter.offer(gift("demo.bus"))
    run(adapter.dispatch_pending())

    assert adapter.counters.accepted_without_renderer == 1
    assert "delivered to 0 renderer clients" in (adapter.last_result or "")


def test_a_crashing_transport_does_not_stop_the_adapter(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    def explode(_: str) -> SubmitResult:
        raise RuntimeError("boom")

    fake_client.respond = explode
    adapter.offer(gift("demo.bus", event_id="a"))
    run(adapter.dispatch_pending())
    assert adapter.counters.server_errors == 1

    fake_client.respond = lambda _: SubmitResult("accepted", 202, delivered_to=1)
    clock.advance(1)
    adapter.offer(gift("demo.car", event_id="b"))
    run(adapter.dispatch_pending())
    assert adapter.counters.accepted == 1


# ------------------------------------------------------ unavailable / recovery


def test_an_unavailable_server_drops_the_action_and_backs_off(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    fake_client.respond = unavailable
    adapter.offer(gift("demo.bus", event_id="a"))
    run(adapter.dispatch_pending())

    assert adapter.server_status == "unavailable"
    assert adapter.snapshot()["lastError"] == "event server unavailable: refused"

    # Inside the back-off nothing is attempted and nothing is kept.
    for index in range(100):
        assert adapter.offer(gift("demo.car", event_id=f"b-{index}")) == "server-unavailable"
    assert adapter.snapshot()["pending"] == []
    assert fake_client.calls == ["roadside.send-bus"]
    assert adapter.counters.dropped_server_unavailable == 100


def test_the_adapter_recovers_when_the_server_returns(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    fake_client.respond = unavailable
    adapter.offer(gift("demo.bus", event_id="a"))
    run(adapter.dispatch_pending())

    clock.advance(1.0)
    adapter.offer(gift("demo.car", event_id="b"))
    run(adapter.dispatch_pending())
    assert adapter.server_status == "unavailable"
    assert fake_client.calls == ["roadside.send-bus", "roadside.send-car"]

    fake_client.respond = lambda _: SubmitResult("accepted", 202, delivered_to=1)
    clock.advance(1.0)
    adapter.offer(gift("demo.leaves", event_id="c"))
    run(adapter.dispatch_pending())

    assert adapter.server_status == "available"
    # Nothing from the outage was replayed: only the new event was sent.
    assert fake_client.calls[-1] == "roadside.blow-leaves"
    assert len(fake_client.calls) == 3


def test_an_outage_drops_everything_already_pending(
    adapter: Adapter, fake_client: FakeClient
) -> None:
    fake_client.respond = unavailable
    for index, name in enumerate(("demo.bus", "demo.car", "demo.leaves")):
        adapter.offer(gift(name, event_id=str(index)))

    run(adapter.dispatch_pending())

    # One attempt, not one timeout per pending action.
    assert fake_client.calls == ["roadside.send-bus"]
    assert adapter.counters.dropped_server_unavailable == 2
    assert adapter.snapshot()["pending"] == []


def test_a_pending_action_that_waited_too_long_is_dropped(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    adapter.offer(gift("demo.bus"))
    clock.advance(2.5)

    assert run(adapter.dispatch_pending()) == 0
    assert fake_client.calls == []
    assert adapter.counters.dropped_expired == 1


# --------------------------------------------------------------------- bursts


def test_fifty_identical_gifts_become_one_request(
    adapter: Adapter, fake_client: FakeClient
) -> None:
    outcomes = [adapter.offer(gift("demo.bus", event_id=f"evt-{i}")) for i in range(50)]
    run(adapter.dispatch_pending())

    assert outcomes.count("queued") == 1
    assert outcomes.count("coalesced") == 49
    assert fake_client.calls == ["roadside.send-bus"]


def test_events_arriving_while_a_request_is_in_flight_coalesce_into_it(
    adapter: Adapter, fake_client: FakeClient
) -> None:
    during: list[str] = []

    def more_gifts(_: str) -> None:
        fake_client.during_submit = None
        for index in range(20):
            during.append(adapter.offer(gift("demo.bus", event_id=f"late-{index}")))
        during.append(adapter.offer(gift("demo.car", event_id="car")))

    fake_client.during_submit = more_gifts
    adapter.offer(gift("demo.bus", event_id="first"))
    run(adapter.dispatch_pending())

    assert during[:20] == ["coalesced"] * 20
    assert during[20] == "queued"
    assert fake_client.calls == ["roadside.send-bus", "roadside.send-car"]


def test_a_burst_against_a_cooling_action_costs_one_refusal(
    adapter: Adapter, fake_client: FakeClient, clock: ManualClock
) -> None:
    fake_client.respond = cooling(8000)
    for round_ in range(5):
        for index in range(50):
            adapter.offer(gift("demo.bus", event_id=f"{round_}-{index}"))
        run(adapter.dispatch_pending())
        clock.advance(0.5)

    assert fake_client.calls == ["roadside.send-bus"]
    assert adapter.counters.refused_cooldown == 1
    assert adapter.counters.held_for_cooldown == 200


def test_a_mixed_burst_sends_at_most_one_request_per_action(
    adapter: Adapter, fake_client: FakeClient, mappings: MappingTable
) -> None:
    names = ("demo.car", "demo.bus", "demo.leaves", "demo.unknown", "demo.birds")
    for index in range(500):
        adapter.offer(gift(names[index % len(names)], event_id=f"evt-{index}"))
    assert len(adapter.snapshot()["pending"]) <= len(mappings.action_ids)

    run(adapter.dispatch_pending())

    assert sorted(fake_client.calls) == sorted(
        ["roadside.send-car", "roadside.send-bus", "roadside.blow-leaves", "forest.bird-flock"]
    )
    assert adapter.counters.unmapped == 100


def test_pending_state_never_exceeds_the_mapped_action_count(
    adapter: Adapter, mappings: MappingTable
) -> None:
    for index in range(10_000):
        adapter.offer(gift(("demo.car", "demo.bus", "demo.leaves")[index % 3], f"e{index}"))
        assert len(adapter._pending) <= len(mappings.action_ids)


def test_memory_stays_bounded_under_a_long_burst(mappings: MappingTable) -> None:
    clock = ManualClock()
    client = FakeClient()
    client.respond = unavailable
    adapter = Adapter(
        mappings,
        client,  # type: ignore[arg-type]
        clock=clock,
        wall_clock=clock.wall,
        dedup=RecentEventIds(ttl_s=600, capacity=1000),
        runner=inline_runner,
        report=lambda line: None,
    )

    def burst(start: int) -> None:
        for index in range(start, start + 20_000):
            adapter.offer(gift("demo.bus", event_id=f"evt-{index}"))
            if index % 100 == 0:
                clock.advance(0.5)
                asyncio.run(adapter.dispatch_pending())

    burst(0)
    tracemalloc.start()
    baseline = tracemalloc.take_snapshot()
    burst(20_000)
    grown = sum(
        stat.size_diff for stat in tracemalloc.take_snapshot().compare_to(baseline, "lineno")
    )
    tracemalloc.stop()

    assert len(adapter._dedup) == 1000
    assert adapter._pending == {}
    # A second burst as large as the first adds (almost) nothing.
    assert grown < 256 * 1024
    # One attempt per one-second back-off interval, not one per event: the
    # clock moves 0.5 s per 100 events, so 40 000 events span 200 s.
    assert len(client.calls) <= 200 + 1


# ----------------------------------------------------------------- run loop


def test_the_worker_sends_as_events_arrive(mappings: MappingTable) -> None:
    async def scenario() -> list[str]:
        client = FakeClient()
        adapter = Adapter(mappings, client, report=lambda line: None)  # type: ignore[arg-type]
        worker = asyncio.create_task(adapter.run())
        adapter.offer(gift("demo.bus", event_id="a"))
        adapter.offer(gift("demo.leaves", event_id="b"))
        await asyncio.wait_for(adapter.wait_idle(), timeout=5)
        worker.cancel()
        return client.calls

    assert run(scenario()) == ["roadside.send-bus", "roadside.blow-leaves"]


def test_the_status_snapshot_holds_counts_not_viewer_data(adapter: Adapter) -> None:
    adapter.offer(gift("demo.bus", event_id="viewer-secret-event"))
    snapshot = adapter.snapshot()

    assert set(snapshot) == {
        "source",
        "server",
        "counters",
        "pending",
        "inFlight",
        "cooldownHoldsMs",
        "rememberedEventIds",
        "lastResult",
        "lastError",
    }
    assert "viewer-secret-event" not in repr(snapshot)
    assert snapshot["counters"]["refusedWrongScene"] == 0


def test_the_platform_event_carries_no_viewer_fields() -> None:
    assert set(PlatformEvent.__dataclass_fields__) == {
        "platform",
        "kind",
        "event_id",
        "gift_id",
        "quantity",
        "occurred_at",
    }
