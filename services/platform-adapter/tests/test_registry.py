"""The adapter's registry copy must not drift from the shared protocol copy."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from livescape_platform_adapter.registry import REGISTRY_PATH, scene_action_owners

SHARED_REGISTRY = Path(__file__).resolve().parents[3] / "packages" / "protocol" / "registry.json"


@pytest.mark.skipif(
    not SHARED_REGISTRY.exists(),
    reason="shared protocol registry is only present inside the monorepo",
)
def test_adapter_registry_matches_the_shared_protocol_registry() -> None:
    shared = json.loads(SHARED_REGISTRY.read_text(encoding="utf-8"))
    copy = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))

    assert copy == shared, (
        "services/platform-adapter/src/livescape_platform_adapter/registry.json is out of "
        "sync with packages/protocol/registry.json"
    )


def test_scene_action_owners_lists_every_registry_action() -> None:
    owners = scene_action_owners()

    assert owners["roadside.send-bus"] == "roadside-workshop"
    assert owners["roadside.blow-leaves"] == "roadside-workshop"
    assert owners["forest.bird-flock"] == "forest"
