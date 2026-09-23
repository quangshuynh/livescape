from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest

from livescape_platform_adapter.adapter import Adapter
from livescape_platform_adapter.client import SubmitResult
from livescape_platform_adapter.events import PlatformEvent
from livescape_platform_adapter.mapping import MappingTable, load_mappings

WALL_START = datetime(2026, 9, 22, 20, 0, tzinfo=UTC)


class ManualClock:
    """Monotonic seconds moved by hand, plus the matching wall clock."""

    def __init__(self, start: float = 1000.0) -> None:
        self.start = start
        self.now = start

    def __call__(self) -> float:
        return self.now

    def wall(self) -> datetime:
        return WALL_START + timedelta(seconds=self.now - self.start)

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeClient:
    """Stands in for ``EventServerClient``: records calls, answers from a script.

    ``respond`` decides the result per call; by default every action is
    accepted and delivered to one renderer. ``during_submit`` runs while a
    request is "in flight", which is how tests deliver events mid-request.
    """

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.respond: Callable[[str], SubmitResult] = lambda action_id: SubmitResult(
            "accepted", 202, delivered_to=1
        )
        self.during_submit: Callable[[str], None] | None = None

    def submit_action(self, action_id: str) -> SubmitResult:
        self.calls.append(action_id)
        if self.during_submit is not None:
            self.during_submit(action_id)
        return self.respond(action_id)


async def inline_runner(fn: Callable[[str], SubmitResult], action_id: str) -> SubmitResult:
    return fn(action_id)


def gift(
    gift_id: str = "demo.bus",
    event_id: str | None = "evt-1",
    quantity: int = 1,
    occurred_at: datetime | None = None,
) -> PlatformEvent:
    return PlatformEvent(
        platform="simulation",
        kind="gift",
        event_id=event_id,
        gift_id=gift_id,
        quantity=quantity,
        occurred_at=occurred_at,
    )


@pytest.fixture
def clock() -> ManualClock:
    return ManualClock()


@pytest.fixture
def mappings() -> MappingTable:
    return load_mappings()


@pytest.fixture
def fake_client() -> FakeClient:
    return FakeClient()


@pytest.fixture
def adapter(mappings: MappingTable, fake_client: FakeClient, clock: ManualClock) -> Adapter:
    return Adapter(
        mappings,
        fake_client,  # type: ignore[arg-type]
        clock=clock,
        wall_clock=clock.wall,
        runner=inline_runner,
        report=lambda line: None,
    )
