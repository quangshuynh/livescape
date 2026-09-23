"""Admission control for scene actions.

A scene action is a transient event: it asks the renderer to do something once
(send a bus, blow some leaves) and is never folded into scene state, so a
renderer that connects later is not shown it again. This module decides only
whether an action may be broadcast right now:

* the action must belong to the scene that is currently showing, and
* the same action must not have been accepted within its registry cooldown.

Everything else is rejected immediately rather than queued, so a burst of
requests (many viewers reacting at once, once platform adapters exist) costs
one broadcast per cooldown window and never builds up a backlog. Memory is
bounded by the allowlist: one timestamp per action id.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from .registry import SceneId, action_entry


@dataclass(frozen=True, slots=True)
class Admission:
    outcome: Literal["accepted", "wrong-scene", "cooling-down"]
    #: The scene that owns the action.
    scene_id: SceneId
    #: For ``cooling-down``: how long until the action is accepted again.
    retry_after_ms: int = 0


class ActionGate:
    def __init__(self) -> None:
        self._last_accepted: dict[str, float] = {}

    def admit(self, action_id: str, current_scene: SceneId, now: float) -> Admission:
        """Accept ``action_id`` at ``now`` (seconds, monotonic) or say why not.

        Acceptance is recorded here, so the check and the update happen in one
        step with no ``await`` in between: concurrent requests cannot both win.
        """
        entry = action_entry(action_id)
        owner: SceneId = entry["sceneId"]
        if owner != current_scene:
            return Admission("wrong-scene", owner)

        cooldown_s = entry["cooldownMs"] / 1000
        last = self._last_accepted.get(action_id)
        if last is not None and now - last < cooldown_s:
            remaining_ms = math.ceil((cooldown_s - (now - last)) * 1000)
            return Admission("cooling-down", owner, retry_after_ms=max(1, remaining_ms))

        self._last_accepted[action_id] = now
        return Admission("accepted", owner)

    def remaining_ms(self, action_id: str, now: float) -> int:
        """Milliseconds until ``action_id`` leaves its cooldown; 0 when ready."""
        last = self._last_accepted.get(action_id)
        if last is None:
            return 0
        cooldown_s = action_entry(action_id)["cooldownMs"] / 1000
        return max(0, math.ceil((cooldown_s - (now - last)) * 1000))
