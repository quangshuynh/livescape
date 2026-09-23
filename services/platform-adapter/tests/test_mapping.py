"""Mappings are declarative, allowlisted, and validated completely at startup."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from livescape_platform_adapter.events import PlatformEvent
from livescape_platform_adapter.mapping import (
    MappingError,
    MappingTable,
    load_mappings,
    parse_mappings,
)
from livescape_platform_adapter.registry import scene_action_owners

from .conftest import gift


def rule(**overrides: Any) -> dict[str, Any]:
    return {
        "platform": "simulation",
        "kind": "gift",
        "gift": "demo.bus",
        "action": "roadside.send-bus",
        **overrides,
    }


def document(*rules: dict[str, Any], **top: Any) -> dict[str, Any]:
    return {"version": 1, "mapping": list(rules), **top}


def problems_of(doc: dict[str, Any]) -> list[str]:
    with pytest.raises(MappingError) as caught:
        parse_mappings(doc)
    return caught.value.problems


@pytest.mark.parametrize(
    ("gift_id", "action_id"),
    [
        ("demo.car", "roadside.send-car"),
        ("demo.bus", "roadside.send-bus"),
        ("demo.leaves", "roadside.blow-leaves"),
        ("demo.birds", "forest.bird-flock"),
    ],
)
def test_bundled_gifts_map_to_their_scene_actions(
    mappings: MappingTable, gift_id: str, action_id: str
) -> None:
    assert mappings.resolve(gift(gift_id)).action_id == action_id


def test_a_follow_maps_by_kind_alone(mappings: MappingTable) -> None:
    follow = PlatformEvent(platform="simulation", kind="follow", event_id="f-1")

    assert mappings.resolve(follow).action_id == "roadside.pedestrians"


def test_an_unknown_gift_stays_unmapped(mappings: MappingTable) -> None:
    decision = mappings.resolve(gift("demo.unknown"))

    assert decision.action_id is None
    assert decision.reason == "unmapped"


def test_mappings_only_match_their_own_platform(mappings: MappingTable) -> None:
    other = PlatformEvent(platform="elsewhere", kind="gift", gift_id="demo.bus")

    assert mappings.resolve(other).action_id is None


def test_min_quantity_gates_a_mapping(mappings: MappingTable) -> None:
    assert mappings.resolve(gift("demo.rush", quantity=4)).reason == "below-minimum"
    assert mappings.resolve(gift("demo.rush", quantity=5)).action_id == "roadside.rush-hour"
    assert mappings.resolve(gift("demo.rush", quantity=500)).action_id == "roadside.rush-hour"


def test_every_bundled_mapping_names_an_allowlisted_action(mappings: MappingTable) -> None:
    assert mappings.action_ids <= set(scene_action_owners())
    assert len(mappings.rules) == 6


def test_gift_ids_match_exactly(mappings: MappingTable) -> None:
    assert mappings.resolve(gift("DEMO.BUS")).action_id is None
    assert mappings.resolve(gift("demo.bus2")).action_id is None


@pytest.mark.parametrize(
    "action",
    ["roadside.send-tank", "roadside.send_bus", "", 7, None, "scene.change", "effect.trigger"],
)
def test_unknown_action_ids_are_rejected(action: object) -> None:
    (problem,) = problems_of(document(rule(action=action)))

    assert "not an allowlisted scene action" in problem


@pytest.mark.parametrize(
    "field",
    [
        {"script": "alert(1)"},
        {"python": "__import__('os').system('rm -rf /')"},
        {"command": "rm -rf /"},
        {"url": "https://example.com/hook"},
        {"target": "http://10.0.0.1:8765/api/events"},
        {"path": "/etc/passwd"},
        {"actor": {"sprite": "bus", "speed": 99}},
        {"html": "<img src=x onerror=alert(1)>"},
        {"css": "body{display:none}"},
        {"prompt": "draw a dragon"},
        {"when": "quantity > 3"},
        {"source": "manual"},
    ],
)
def test_executable_or_open_ended_fields_are_rejected(field: dict[str, object]) -> None:
    (problem,) = problems_of(document(rule(**field)))

    assert "unsupported key" in problem


def test_a_duplicate_mapping_is_rejected() -> None:
    problems = problems_of(document(rule(), rule(action="roadside.send-car")))

    assert problems == ["mapping 2: duplicates mapping 1 for the same event"]


def test_duplicate_follow_mappings_are_rejected() -> None:
    follow = {"platform": "simulation", "kind": "follow", "action": "roadside.pedestrians"}

    assert "duplicates" in problems_of(document(follow, dict(follow)))[0]


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"kind": "raid"}, "kind must be one of gift, follow"),
        ({"kind": "chat"}, "kind must be one of gift, follow"),
        ({"platform": "sim ulation"}, "platform must be a short token"),
        ({"gift": None}, "a gift mapping needs a gift id token"),
        ({"gift": "../bus"}, "a gift mapping needs a gift id token"),
        ({"min_quantity": 0}, "min_quantity must be from 1 to 10000"),
        ({"min_quantity": "5"}, "min_quantity must be an integer"),
        ({"min_quantity": True}, "min_quantity must be an integer"),
    ],
)
def test_malformed_rules_are_rejected(overrides: dict[str, object], expected: str) -> None:
    assert expected in problems_of(document(rule(**overrides)))[0]


def test_follow_mappings_take_no_gift_or_quantity() -> None:
    problems = problems_of(
        document(
            {
                "platform": "simulation",
                "kind": "follow",
                "gift": "demo.bus",
                "min_quantity": 3,
                "action": "roadside.pedestrians",
            }
        )
    )

    assert "mapping 1: only gift mappings take a gift id" in problems
    assert "mapping 1: min_quantity applies to gift mappings only" in problems


@pytest.mark.parametrize(
    ("doc", "expected"),
    [
        ({"mapping": []}, "version must be 1"),
        ({"version": 2, "mapping": []}, "version must be 1"),
        ({"version": 1, "mapping": [], "include": "other.toml"}, "unsupported top-level key"),
        ({"version": 1, "mapping": {"gift": "x"}}, "mapping must be a list"),
        ({"version": 1, "mapping": ["demo.bus"]}, "mapping must be a list"),
    ],
)
def test_malformed_documents_are_rejected(doc: dict[str, Any], expected: str) -> None:
    assert any(expected in problem for problem in problems_of(doc))


def test_every_problem_is_reported_at_once() -> None:
    problems = problems_of(
        document(rule(action="nope"), rule(gift="demo.car", kind="raid"), version=3)
    )

    assert len(problems) >= 3


def test_an_empty_mapping_file_is_valid_and_maps_nothing() -> None:
    table = parse_mappings({"version": 1})

    assert table.rules == ()
    assert table.resolve(gift()).action_id is None


def test_load_mappings_reads_toml_and_reports_syntax_errors(tmp_path: Path) -> None:
    good = tmp_path / "good.toml"
    good.write_text(
        'version = 1\n[[mapping]]\nplatform = "simulation"\nkind = "gift"\n'
        'gift = "demo.bus"\naction = "roadside.send-bus"\n',
        encoding="utf-8",
    )
    bad = tmp_path / "bad.toml"
    bad.write_text("version = = 1\n", encoding="utf-8")

    assert load_mappings(good).resolve(gift()).action_id == "roadside.send-bus"
    with pytest.raises(MappingError, match="not valid TOML"):
        load_mappings(bad)
    with pytest.raises(MappingError, match="cannot read mapping file"):
        load_mappings(tmp_path / "missing.toml")
