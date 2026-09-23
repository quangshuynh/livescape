"""A deterministic stand-in platform for development and tests.

The simulator is a real ``PlatformSource``: it has its own wire format, which
is deliberately *not* the normalized model (``type`` / ``id`` / ``sentAt`` /
``gift.count``, plus a ``viewer`` block), so every simulated event goes through
the same normalization step a real platform's would. It observes no real
viewer and connects to nothing.

Simulated wire format::

    {
      "type": "gift",
      "id": "sim-000001",
      "sentAt": "2026-09-22T20:00:00.000Z",
      "viewer": {"id": "sim-viewer-1", "name": "Simulated Viewer"},
      "gift": {"id": "demo.bus", "count": 1}
    }
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

from .events import MAX_QUANTITY, NormalizationError, PlatformEvent
from .source import AdapterEventSource, SourceStatus

PLATFORM = "simulation"

#: Raw events waiting to be read by the adapter. The simulator refuses more
#: rather than growing; a real source should bound its own buffering the same way.
INBOX_CAPACITY = 256


def normalize_simulation_event(raw: object) -> PlatformEvent:
    """Turn one simulated wire event into a ``PlatformEvent``.

    Unknown fields are ignored and the ``viewer`` block is dropped entirely:
    nothing about the viewer survives normalization.
    """
    if not isinstance(raw, dict):
        raise NormalizationError(PLATFORM, "event is not an object")
    kind = raw.get("type")
    if not isinstance(kind, str):
        raise NormalizationError(PLATFORM, "event type is missing")

    event_id = raw.get("id")
    if event_id is not None and not isinstance(event_id, str):
        raise NormalizationError(PLATFORM, "event id is not a string")
    occurred_at = _parse_time(raw.get("sentAt"))

    try:
        if kind == "gift":
            gift = raw.get("gift")
            if not isinstance(gift, dict):
                raise NormalizationError(PLATFORM, "gift event has no gift")
            gift_id = gift.get("id")
            if not isinstance(gift_id, str):
                raise NormalizationError(PLATFORM, "gift id is missing")
            count = gift.get("count", 1)
            if isinstance(count, bool) or not isinstance(count, int):
                raise NormalizationError(PLATFORM, "gift count is not an integer")
            return PlatformEvent(
                platform=PLATFORM,
                kind="gift",
                event_id=event_id,
                gift_id=gift_id,
                quantity=count,
                occurred_at=occurred_at,
            )
        if kind == "follow":
            return PlatformEvent(
                platform=PLATFORM, kind="follow", event_id=event_id, occurred_at=occurred_at
            )
    except ValueError as exc:
        if isinstance(exc, NormalizationError):
            raise
        raise NormalizationError(PLATFORM, str(exc)) from None
    raise NormalizationError(PLATFORM, "unsupported event type")


def _parse_time(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > 40:
        raise NormalizationError(PLATFORM, "sentAt is not a timestamp")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise NormalizationError(PLATFORM, "sentAt is not a timestamp") from None
    if parsed.tzinfo is None:
        raise NormalizationError(PLATFORM, "sentAt has no timezone")
    return parsed


class SimulationScript:
    """Builds simulated wire events with deterministic ids and times."""

    def __init__(self, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self._now = now
        self._counter = 0

    def next_id(self) -> str:
        self._counter += 1
        return f"sim-{self._counter:06d}"

    def _stamp(self, offset: timedelta = timedelta(0)) -> str:
        moment = self._now() + offset
        return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def gift(
        self,
        gift_id: str,
        count: int = 1,
        *,
        event_id: str | None = "auto",
        age: timedelta = timedelta(0),
    ) -> dict[str, Any]:
        event: dict[str, Any] = {
            "type": "gift",
            "sentAt": self._stamp(-age),
            # Present so tests can prove it never survives normalization.
            "viewer": {"id": "sim-viewer-1", "name": "Simulated Viewer"},
            "gift": {"id": gift_id, "count": count},
        }
        if event_id is not None:
            event["id"] = self.next_id() if event_id == "auto" else event_id
        return event

    def follow(self) -> dict[str, Any]:
        return {
            "type": "follow",
            "id": self.next_id(),
            "sentAt": self._stamp(),
            "viewer": {"id": "sim-viewer-2", "name": "Simulated Follower"},
        }

    def scenario(self, name: str) -> list[object]:
        """The raw events of a named scenario. Raises ``KeyError`` if unknown."""
        builder = _SCENARIOS[name]
        return list(builder(self))


def _duplicate(script: SimulationScript) -> Iterator[object]:
    event = script.gift("demo.bus")
    yield event
    yield dict(event)


def _no_id(script: SimulationScript) -> Iterator[object]:
    yield script.gift("demo.leaves", event_id=None)
    yield script.gift("demo.leaves", event_id=None)


def _mixed(script: SimulationScript) -> Iterator[object]:
    gifts = ("demo.car", "demo.bus", "demo.leaves", "demo.unknown", "demo.car")
    for index in range(50):
        yield script.gift(gifts[index % len(gifts)])


def _malformed(script: SimulationScript) -> Iterator[object]:
    yield "not an event"
    yield {"type": "gift", "id": script.next_id()}
    yield {"type": "gift", "id": script.next_id(), "gift": {"id": "demo.bus", "count": "many"}}
    yield {"type": "gift", "id": script.next_id(), "gift": {"id": "../../etc/passwd"}}
    yield {"type": "gift", "gift": {"id": "demo.bus", "count": MAX_QUANTITY + 1}}
    yield {"type": "raid", "id": script.next_id()}


_SCENARIOS: dict[str, Callable[[SimulationScript], Iterator[object]]] = {
    "car": lambda s: iter([s.gift("demo.car")]),
    "bus": lambda s: iter([s.gift("demo.bus")]),
    "leaves": lambda s: iter([s.gift("demo.leaves")]),
    "rush": lambda s: iter([s.gift("demo.rush", 5)]),
    "rush-small": lambda s: iter([s.gift("demo.rush", 1)]),
    "birds": lambda s: iter([s.gift("demo.birds")]),
    "follow": lambda s: iter([s.follow()]),
    "unknown": lambda s: iter([s.gift("demo.unknown")]),
    "stale": lambda s: iter([s.gift("demo.bus", age=timedelta(minutes=5))]),
    "duplicate": _duplicate,
    "no-id": _no_id,
    "burst": lambda s: (s.gift("demo.bus") for _ in range(50)),
    "mixed": _mixed,
    "malformed": _malformed,
}

SCENARIO_NAMES: tuple[str, ...] = tuple(_SCENARIOS)


class SimulationSource:
    """``PlatformSource`` fed by ``emit`` (from a script, the CLI, or a test)."""

    platform = PLATFORM
    event_source: AdapterEventSource = "simulation"

    def __init__(self, capacity: int = INBOX_CAPACITY) -> None:
        self._inbox: asyncio.Queue[object] = asyncio.Queue(maxsize=capacity)
        self._status: SourceStatus = "idle"
        #: Raw events refused because the inbox was full.
        self.overflowed = 0

    @property
    def status(self) -> SourceStatus:
        return self._status

    async def connect(self) -> None:
        self._status = "connected"

    async def disconnect(self) -> None:
        self._status = "disconnected"
        # Wake a reader blocked in events() so it can finish.
        while not self._inbox.empty():
            self._inbox.get_nowait()
        self._inbox.put_nowait(_CLOSED)

    def emit(self, raw: object) -> bool:
        """Queue one raw event. ``False`` when the inbox is full and it was dropped."""
        if self._status != "connected":
            return False
        try:
            self._inbox.put_nowait(raw)
        except asyncio.QueueFull:
            self.overflowed += 1
            return False
        return True

    def pending(self) -> int:
        return self._inbox.qsize()

    async def events(self) -> AsyncIterator[PlatformEvent | NormalizationError]:
        while True:
            raw = await self._inbox.get()
            if raw is _CLOSED:
                return
            try:
                yield normalize_simulation_event(raw)
            except NormalizationError as exc:
                yield exc


_CLOSED = object()
