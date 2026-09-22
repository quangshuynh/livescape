"""Explicit allowlist of scenes and effects the renderer can display.

This mirrors ``packages/protocol/registry.json``; ``tests/test_registry.py``
fails if the two copies drift apart.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, get_args

REGISTRY_PATH = Path(__file__).with_name("registry.json")

SceneId = Literal["city", "forest", "space", "roadside-workshop"]
EffectId = Literal["rain", "snow", "fireworks"]
EventSource = Literal["manual", "simulation", "system"]

SCENE_IDS: tuple[str, ...] = get_args(SceneId)
EFFECT_IDS: tuple[str, ...] = get_args(EffectId)
EVENT_SOURCES: tuple[str, ...] = get_args(EventSource)

PROTOCOL_VERSION = 1


@lru_cache(maxsize=1)
def load_registry() -> dict[str, Any]:
    """Load and sanity-check the registry document."""
    data: dict[str, Any] = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))

    declared_scenes = tuple(entry["id"] for entry in data["scenes"])
    declared_effects = tuple(entry["id"] for entry in data["effects"])
    if sorted(declared_scenes) != sorted(SCENE_IDS):
        raise RuntimeError(f"registry.json scene ids {declared_scenes} != {SCENE_IDS}")
    if sorted(declared_effects) != sorted(EFFECT_IDS):
        raise RuntimeError(f"registry.json effect ids {declared_effects} != {EFFECT_IDS}")
    if sorted(data["sources"]) != sorted(EVENT_SOURCES):
        raise RuntimeError(f"registry.json sources {data['sources']} != {EVENT_SOURCES}")
    if data["protocolVersion"] != PROTOCOL_VERSION:
        raise RuntimeError("registry.json protocolVersion does not match the server")
    return data


def default_duration_ms(effect_id: str) -> int | None:
    """Duration an effect runs for when the event does not specify one."""
    for entry in load_registry()["effects"]:
        if entry["id"] == effect_id:
            duration: int | None = entry["defaultDurationMs"]
            return duration
    raise KeyError(f"unknown effect id: {effect_id}")
