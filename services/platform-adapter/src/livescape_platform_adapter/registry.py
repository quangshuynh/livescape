"""The scene-action allowlist the adapter's mappings are checked against.

``registry.json`` is a copy of ``packages/protocol/registry.json``, the same
arrangement the event server uses; ``tests/test_registry.py`` fails if the
copies drift. The adapter only reads action ids and their owning scenes from
it. What an action does, and whether it may run right now, stays with the
event server and the renderer.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

REGISTRY_PATH = Path(__file__).with_name("registry.json")


@lru_cache(maxsize=1)
def load_registry() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    if data.get("protocolVersion") != 1:
        raise RuntimeError("registry.json protocolVersion is not 1")
    return data


def scene_action_owners() -> dict[str, str]:
    """Every allowlisted scene action id, with the scene that owns it."""
    return {entry["id"]: entry["sceneId"] for entry in load_registry()["actions"]}
