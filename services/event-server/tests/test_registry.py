"""The server's registry copy must not drift from the shared protocol copy."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from livescape_event_server.registry import (
    EFFECT_IDS,
    REGISTRY_PATH,
    SCENE_IDS,
    default_duration_ms,
    load_registry,
)

SHARED_REGISTRY = Path(__file__).resolve().parents[3] / "packages" / "protocol" / "registry.json"


@pytest.mark.skipif(
    not SHARED_REGISTRY.exists(),
    reason="shared protocol registry is only present inside the monorepo",
)
def test_server_registry_matches_the_shared_protocol_registry() -> None:
    shared = json.loads(SHARED_REGISTRY.read_text(encoding="utf-8"))
    served = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))

    assert served == shared, (
        "services/event-server/src/livescape_event_server/registry.json is out of sync "
        "with packages/protocol/registry.json"
    )


def test_registry_loads_and_matches_the_declared_literals() -> None:
    data = load_registry()

    assert tuple(entry["id"] for entry in data["scenes"]) == SCENE_IDS
    assert tuple(entry["id"] for entry in data["effects"]) == EFFECT_IDS


def test_default_duration_lookup() -> None:
    assert default_duration_ms("fireworks") == 8000
    assert default_duration_ms("rain") is None

    with pytest.raises(KeyError):
        default_duration_ms("lasers")
