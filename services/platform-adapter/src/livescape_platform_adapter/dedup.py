"""Bounded, expiring memory of platform event ids already handled.

Platforms redeliver: webhook systems commonly promise at-least-once delivery
and retry for a long time. The adapter remembers ``(platform, event_id)`` for
``ttl_s`` seconds, up to ``capacity`` ids, and treats a repeat inside that
window as a duplicate. The oldest ids are forgotten first when the capacity is
reached, so memory is fixed no matter how many events arrive.

This is best-effort deduplication, not exactly-once delivery: a redelivery that
arrives after its id has expired or been evicted is not recognised (the
adapter's separate freshness check usually drops such a late event anyway),
and ids are lost when the adapter restarts. An event without an ``event_id``
cannot be deduplicated at all and is always treated as new; bursts of those are
still bounded by coalescing and by the event server's cooldowns.
"""

from __future__ import annotations

from collections import OrderedDict

DEFAULT_TTL_S = 600.0
DEFAULT_CAPACITY = 4096


class RecentEventIds:
    def __init__(self, ttl_s: float = DEFAULT_TTL_S, capacity: int = DEFAULT_CAPACITY) -> None:
        if ttl_s <= 0 or capacity <= 0:
            raise ValueError("ttl_s and capacity must be positive")
        self._ttl_s = ttl_s
        self._capacity = capacity
        #: key -> monotonic time first seen, oldest first.
        self._seen: OrderedDict[tuple[str, str], float] = OrderedDict()

    def __len__(self) -> int:
        return len(self._seen)

    def check_and_remember(self, platform: str, event_id: str, now: float) -> bool:
        """``True`` if the id is new (and is now remembered), ``False`` if a duplicate."""
        self._expire(now)
        key = (platform, event_id)
        if key in self._seen:
            return False
        self._seen[key] = now
        while len(self._seen) > self._capacity:
            self._seen.popitem(last=False)
        return True

    def _expire(self, now: float) -> None:
        cutoff = now - self._ttl_s
        while self._seen:
            first_key, first_seen = next(iter(self._seen.items()))
            if first_seen > cutoff:
                break
            del self._seen[first_key]
