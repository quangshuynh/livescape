"""Deduplication is bounded, expires, and is keyed per platform."""

from __future__ import annotations

import pytest

from livescape_platform_adapter.dedup import RecentEventIds


def test_a_repeat_is_a_duplicate_and_a_new_id_is_not() -> None:
    ids = RecentEventIds()

    assert ids.check_and_remember("simulation", "a", 0.0) is True
    assert ids.check_and_remember("simulation", "a", 1.0) is False
    assert ids.check_and_remember("simulation", "b", 1.0) is True


def test_ids_are_scoped_to_their_platform() -> None:
    ids = RecentEventIds()

    assert ids.check_and_remember("simulation", "a", 0.0) is True
    assert ids.check_and_remember("other", "a", 0.0) is True


def test_ids_expire_after_the_ttl() -> None:
    ids = RecentEventIds(ttl_s=10.0)
    ids.check_and_remember("simulation", "a", 0.0)

    assert ids.check_and_remember("simulation", "a", 9.9) is False
    assert ids.check_and_remember("simulation", "a", 10.0) is True
    assert len(ids) == 1


def test_expired_ids_are_released_even_when_never_seen_again() -> None:
    ids = RecentEventIds(ttl_s=10.0)
    for index in range(100):
        ids.check_and_remember("simulation", f"old-{index}", 0.0)

    ids.check_and_remember("simulation", "new", 20.0)

    assert len(ids) == 1


def test_capacity_is_a_hard_bound_and_the_oldest_ids_go_first() -> None:
    ids = RecentEventIds(ttl_s=1_000.0, capacity=100)
    for index in range(10_000):
        ids.check_and_remember("simulation", f"evt-{index}", float(index) / 1000)

    assert len(ids) == 100
    # The newest are remembered, the oldest have been evicted.
    assert ids.check_and_remember("simulation", "evt-9999", 10.0) is False
    assert ids.check_and_remember("simulation", "evt-0", 10.0) is True


@pytest.mark.parametrize(("ttl", "capacity"), [(0, 10), (10, 0), (-1, 10)])
def test_bounds_must_be_positive(ttl: float, capacity: int) -> None:
    with pytest.raises(ValueError):
        RecentEventIds(ttl_s=ttl, capacity=capacity)
