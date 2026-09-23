"""Simulated platform events are normalized, and everything else is refused."""

from __future__ import annotations

import dataclasses
from datetime import UTC, datetime

import pytest

from livescape_platform_adapter.events import NormalizationError, PlatformEvent
from livescape_platform_adapter.simulation import SimulationScript, normalize_simulation_event


def test_a_simulated_gift_normalizes_to_the_platform_event_model() -> None:
    event = normalize_simulation_event(
        {
            "type": "gift",
            "id": "sim-000001",
            "sentAt": "2026-09-22T20:00:00.000Z",
            "gift": {"id": "demo.bus", "count": 3},
        }
    )

    assert event == PlatformEvent(
        platform="simulation",
        kind="gift",
        event_id="sim-000001",
        gift_id="demo.bus",
        quantity=3,
        occurred_at=datetime(2026, 9, 22, 20, 0, tzinfo=UTC),
    )


def test_a_follow_normalizes_without_a_gift() -> None:
    event = normalize_simulation_event({"type": "follow", "id": "sim-000002"})

    assert event.kind == "follow"
    assert event.gift_id is None
    assert event.quantity == 1


def test_count_defaults_to_one_and_id_and_time_are_optional() -> None:
    event = normalize_simulation_event({"type": "gift", "gift": {"id": "demo.car"}})

    assert event.quantity == 1
    assert event.event_id is None
    assert event.occurred_at is None


def test_viewer_data_never_survives_normalization() -> None:
    raw = {
        "type": "gift",
        "id": "sim-000003",
        "viewer": {
            "id": "viewer-42",
            "name": "Real Name",
            "avatar": "https://example.com/a.png",
            "email": "viewer@example.com",
            "bio": "about me",
            "location": "somewhere",
        },
        "gift": {"id": "demo.bus", "count": 1, "sender": "viewer-42"},
        "profile": {"followers": 10},
    }

    event = normalize_simulation_event(raw)
    fields = {field.name for field in dataclasses.fields(event)}
    values = " ".join(str(getattr(event, name)) for name in fields)

    assert fields == {"platform", "kind", "event_id", "gift_id", "quantity", "occurred_at"}
    for leaked in ("viewer-42", "Real Name", "example.com", "about me", "somewhere"):
        assert leaked not in values


@pytest.mark.parametrize(
    ("label", "raw"),
    [
        ("not an object", "gift demo.bus"),
        ("a list", [{"type": "gift"}]),
        ("missing type", {"gift": {"id": "demo.bus"}}),
        ("type is not a string", {"type": 7, "gift": {"id": "demo.bus"}}),
        ("unknown event type", {"type": "raid", "id": "x"}),
        ("gift without gift", {"type": "gift"}),
        ("gift is a string", {"type": "gift", "gift": "demo.bus"}),
        ("gift id missing", {"type": "gift", "gift": {"count": 1}}),
        ("gift id with a path", {"type": "gift", "gift": {"id": "../etc/passwd"}}),
        ("gift id with a URL", {"type": "gift", "gift": {"id": "https://example.com"}}),
        ("gift id too long", {"type": "gift", "gift": {"id": "a" * 65}}),
        ("count is a string", {"type": "gift", "gift": {"id": "demo.bus", "count": "5"}}),
        ("count is a bool", {"type": "gift", "gift": {"id": "demo.bus", "count": True}}),
        ("count is zero", {"type": "gift", "gift": {"id": "demo.bus", "count": 0}}),
        ("count too large", {"type": "gift", "gift": {"id": "demo.bus", "count": 10_001}}),
        ("id is a number", {"type": "gift", "id": 5, "gift": {"id": "demo.bus"}}),
        ("id has whitespace", {"type": "gift", "id": "a b", "gift": {"id": "demo.bus"}}),
        ("id too long", {"type": "gift", "id": "x" * 129, "gift": {"id": "demo.bus"}}),
        ("sentAt garbage", {"type": "gift", "sentAt": "yesterday", "gift": {"id": "demo.bus"}}),
        ("sentAt naive", {"type": "gift", "sentAt": "2026-09-22T20:00:00", "gift": {"id": "x"}}),
    ],
)
def test_malformed_events_raise_a_normalization_error(label: str, raw: object) -> None:
    with pytest.raises(NormalizationError) as caught:
        normalize_simulation_event(raw)
    assert caught.value.platform == "simulation"


def test_fields_a_kind_does_not_use_are_dropped_rather_than_carried() -> None:
    event = normalize_simulation_event({"type": "follow", "gift": {"id": "demo.bus"}})

    assert event.gift_id is None


def test_normalization_errors_do_not_echo_the_payload() -> None:
    with pytest.raises(NormalizationError) as caught:
        normalize_simulation_event(
            {"type": "gift", "viewer": {"name": "Real Name"}, "gift": {"id": "<script>"}}
        )

    assert "Real Name" not in str(caught.value)
    assert "<script>" not in str(caught.value)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"platform": "simulation", "kind": "raid"},
        {"platform": "", "kind": "follow"},
        {"platform": "simulation", "kind": "gift"},
        {"platform": "simulation", "kind": "follow", "gift_id": "demo.bus"},
        {"platform": "simulation", "kind": "gift", "gift_id": "demo.bus", "quantity": 0},
        {
            "platform": "simulation",
            "kind": "follow",
            "occurred_at": datetime(2026, 1, 1),
        },
    ],
)
def test_the_model_refuses_invalid_events_from_any_source(kwargs: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        PlatformEvent(**kwargs)  # type: ignore[arg-type]


def test_scenarios_are_deterministic() -> None:
    fixed = datetime(2026, 9, 22, 20, 0, tzinfo=UTC)
    first = SimulationScript(now=lambda: fixed).scenario("mixed")
    second = SimulationScript(now=lambda: fixed).scenario("mixed")

    assert first == second
    assert len(first) == 50


def test_the_duplicate_scenario_redelivers_the_same_event_id() -> None:
    first, second = SimulationScript().scenario("duplicate")

    assert first["id"] == second["id"]  # type: ignore[index]


def test_unknown_scenarios_are_refused() -> None:
    with pytest.raises(KeyError):
        SimulationScript().scenario("tiktok")
