"""The adapter pipeline: normalized events in, bounded scene-action requests out.

```text
PlatformEvent | NormalizationError
  → malformed?            drop
  → duplicate event id?   drop
  → too old?              drop
  → mapping               unmapped / below minimum: drop
  → action held by 429?   drop (the server said when to come back)
  → server unavailable?   drop (until the next probe)
  → already pending or in flight?  coalesce into it
  → pending slot          one per action id
  → worker                one request at a time, no retries
  → event server          accepted / 409 / 422 / 429 / error / unreachable
```

Visual events favour the present over completeness. Many platform events can
become one action, or none, and nothing is replayed later: an action that
could not be delivered promptly is dropped and counted. The only buffer is one
pending slot per allowlisted action, so memory does not depend on how fast
events arrive or how long the server is gone. This is a visual adapter, never
a ledger: do not use its counts to account for gifts or money.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from .client import EventServerClient, SubmitResult
from .dedup import RecentEventIds
from .events import NormalizationError, PlatformEvent
from .mapping import MappingTable
from .source import PlatformSource

logger = logging.getLogger("livescape.adapter")

#: Refuse platform events that say they happened longer ago than this.
DEFAULT_MAX_EVENT_AGE_S = 30.0
#: A pending action that could not be sent within this long is dropped.
DEFAULT_PENDING_TTL_S = 2.0
#: After the server is found unreachable, drop new actions for this long
#: before trying again, so an outage costs one attempt per interval.
DEFAULT_UNAVAILABLE_BACKOFF_S = 1.0

IntakeOutcome = Literal[
    "malformed",
    "duplicate",
    "stale",
    "unmapped",
    "below-minimum",
    "cooldown-held",
    "server-unavailable",
    "coalesced",
    "queued",
]
ServerStatus = Literal["unknown", "available", "unavailable"]

Runner = Callable[[Callable[[str], SubmitResult], str], Awaitable[SubmitResult]]


@dataclass(slots=True)
class AdapterCounters:
    """In-memory counters for local status. Never persisted or sent anywhere."""

    received: int = 0
    malformed: int = 0
    duplicates: int = 0
    stale: int = 0
    unmapped: int = 0
    below_minimum: int = 0
    mapped: int = 0
    coalesced: int = 0
    held_for_cooldown: int = 0
    dropped_server_unavailable: int = 0
    dropped_expired: int = 0
    submitted: int = 0
    accepted: int = 0
    accepted_without_renderer: int = 0
    refused_wrong_scene: int = 0
    refused_cooldown: int = 0
    rejected_invalid: int = 0
    server_errors: int = 0
    server_unreachable: int = 0


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


class Adapter:
    def __init__(
        self,
        mappings: MappingTable,
        client: EventServerClient,
        *,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        dedup: RecentEventIds | None = None,
        max_event_age_s: float = DEFAULT_MAX_EVENT_AGE_S,
        pending_ttl_s: float = DEFAULT_PENDING_TTL_S,
        unavailable_backoff_s: float = DEFAULT_UNAVAILABLE_BACKOFF_S,
        runner: Runner | None = None,
        report: Callable[[str], None] | None = None,
    ) -> None:
        self._mappings = mappings
        self._client = client
        self._clock = clock
        self._wall_clock = wall_clock
        self._dedup = dedup if dedup is not None else RecentEventIds()
        self._max_event_age_s = max_event_age_s
        self._pending_ttl_s = pending_ttl_s
        self._unavailable_backoff_s = unavailable_backoff_s
        self._runner: Runner = runner or asyncio.to_thread
        self._report = report or (lambda line: logger.info("%s", line))

        self.counters = AdapterCounters()
        self.server_status: ServerStatus = "unknown"
        self.last_error: str | None = None
        self.last_result: str | None = None
        #: action id -> monotonic time it was queued. Insertion order is send order.
        self._pending: dict[str, float] = {}
        self._in_flight: str | None = None
        #: action id -> monotonic time the server's 429 said to wait until.
        self._holds: dict[str, float] = {}
        self._server_retry_at = 0.0
        self._wake = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()

    # ------------------------------------------------------------------ intake

    def offer(self, item: PlatformEvent | NormalizationError) -> IntakeOutcome:
        """Take one normalized event (or normalization failure). Never blocks."""
        counters = self.counters
        counters.received += 1
        if isinstance(item, NormalizationError):
            counters.malformed += 1
            self._report(f"malformed {item.platform} event: {item.reason}")
            return "malformed"

        now = self._clock()
        label = item.describe()
        if item.event_id is not None and not self._dedup.check_and_remember(
            item.platform, item.event_id, now
        ):
            counters.duplicates += 1
            self._report(f"{label}: duplicate delivery ignored")
            return "duplicate"

        if item.occurred_at is not None:
            age_s = (self._wall_clock() - item.occurred_at).total_seconds()
            if age_s > self._max_event_age_s:
                counters.stale += 1
                self._report(f"{label}: {age_s:.0f} s old, dropped")
                return "stale"

        decision = self._mappings.resolve(item)
        if decision.action_id is None:
            if decision.reason == "below-minimum" and decision.rule is not None:
                counters.below_minimum += 1
                self._report(f"{label}: below the minimum of {decision.rule.min_quantity}")
                return "below-minimum"
            counters.unmapped += 1
            self._report(f"{label}: no mapping")
            return "unmapped"

        action_id = decision.action_id
        counters.mapped += 1
        prefix = f"{label} -> {action_id}"

        hold_until = self._holds.get(action_id)
        if hold_until is not None:
            if now < hold_until:
                counters.held_for_cooldown += 1
                self._report(
                    f"{prefix}: cooling down on the server, "
                    f"{round((hold_until - now) * 1000)} ms left"
                )
                return "cooldown-held"
            del self._holds[action_id]

        if self.server_status == "unavailable" and now < self._server_retry_at:
            counters.dropped_server_unavailable += 1
            self._report(f"{prefix}: event server unavailable, dropped")
            return "server-unavailable"

        if action_id in self._pending or action_id == self._in_flight:
            counters.coalesced += 1
            self._report(f"{prefix}: coalesced with the request already on its way")
            return "coalesced"

        self._pending[action_id] = now
        self._idle.clear()
        self._wake.set()
        self._report(f"{prefix}: queued")
        return "queued"

    async def consume(self, source: PlatformSource) -> None:
        """Feed every event of ``source`` into ``offer`` until it ends."""
        async for item in source.events():
            self.offer(item)

    # ---------------------------------------------------------------- dispatch

    async def run(self) -> None:
        """Worker loop: send pending actions one at a time, forever."""
        while True:
            await self._wake.wait()
            self._wake.clear()
            await self.dispatch_pending()

    async def dispatch_pending(self) -> int:
        """Send every pending action once. Returns how many requests were made."""
        sent = 0
        while self._pending:
            action_id, queued_at = next(iter(self._pending.items()))
            del self._pending[action_id]
            now = self._clock()
            if now - queued_at > self._pending_ttl_s:
                self.counters.dropped_expired += 1
                self._report(f"{action_id}: not sent within {self._pending_ttl_s:g} s, dropped")
                continue

            self._in_flight = action_id
            self.counters.submitted += 1
            sent += 1
            try:
                result = await self._runner(self._client.submit_action, action_id)
            except Exception as exc:
                # A bug in a transport must not stop the adapter.
                logger.exception("submitting %s failed", action_id)
                result = SubmitResult("server-error", detail=f"{type(exc).__name__}")
            finally:
                self._in_flight = None
            self._record(action_id, result)
        self._idle.set()
        return sent

    async def wait_idle(self) -> None:
        """Wait until nothing is pending or in flight."""
        await self._idle.wait()

    def _record(self, action_id: str, result: SubmitResult) -> None:
        counters = self.counters
        now = self._clock()
        if result.outcome != "unavailable" and self.server_status != "available":
            if self.server_status == "unavailable":
                self._report("event server reachable again")
            self.server_status = "available"

        match result.outcome:
            case "accepted":
                counters.accepted += 1
                delivered = result.delivered_to or 0
                if delivered == 0:
                    counters.accepted_without_renderer += 1
                plural = "" if delivered == 1 else "s"
                line = f"{action_id}: accepted, delivered to {delivered} renderer client{plural}"
            case "wrong-scene":
                counters.refused_wrong_scene += 1
                line = f"{action_id}: refused, {result.detail}"
            case "cooling-down":
                counters.refused_cooldown += 1
                retry_ms = result.retry_after_ms or 0
                self._holds[action_id] = now + retry_ms / 1000
                line = f"{action_id}: refused, cooling down for {retry_ms} ms"
            case "rejected":
                counters.rejected_invalid += 1
                line = f"{action_id}: rejected by the event server (422)"
                self.last_error = line
            case "unavailable":
                counters.server_unreachable += 1
                self.server_status = "unavailable"
                self._server_retry_at = now + self._unavailable_backoff_s
                line = f"{action_id}: event server unavailable ({result.detail}), dropped"
                self.last_error = f"event server unavailable: {result.detail}"
                # Everything else waiting would fail the same way; drop it now
                # instead of spending a timeout on each.
                dropped = len(self._pending)
                if dropped:
                    counters.dropped_server_unavailable += dropped
                    self._pending.clear()
                    line += f"; dropped {dropped} other pending action(s)"
            case _:
                counters.server_errors += 1
                line = f"{action_id}: event server error ({result.detail})"
                self.last_error = line
        self.last_result = line
        self._report(line)

    # ------------------------------------------------------------------ status

    def snapshot(self, source: PlatformSource | None = None) -> dict[str, Any]:
        """Local status. Contains counts and action ids only, no viewer data."""
        now = self._clock()
        holds = {
            action_id: round((until - now) * 1000)
            for action_id, until in self._holds.items()
            if until > now
        }
        return {
            "source": None
            if source is None
            else {"platform": source.platform, "status": source.status},
            "server": self.server_status,
            "counters": {_camel(name): value for name, value in asdict(self.counters).items()},
            "pending": list(self._pending),
            "inFlight": self._in_flight,
            "cooldownHoldsMs": holds,
            "rememberedEventIds": len(self._dedup),
            "lastResult": self.last_result,
            "lastError": self.last_error,
        }
