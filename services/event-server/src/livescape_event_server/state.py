"""In-memory scene state.

There is no persistence: the state exists so that a renderer which connects
(or reconnects) mid-session is told what is currently on screen instead of
snapping back to the default scene. Only durable state lives here. A
``scene.action`` is a transient event and is deliberately not recorded, so it
is never replayed to a renderer that connects after it happened.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from .models import (
    MIN_DURATION_MS,
    ActiveEffect,
    EffectClearPayload,
    EffectTriggerPayload,
    EventEnvelope,
    SceneChangePayload,
    StateSyncPayload,
)
from .registry import SceneId


@dataclass(frozen=True, slots=True)
class _TrackedEffect:
    effect: ActiveEffect
    started_at: float

    def remaining_ms(self, now: float) -> int | None:
        """Milliseconds left, or ``None`` for an effect that runs until cleared."""
        if self.effect.duration_ms is None:
            return None
        elapsed_ms = (now - self.started_at) * 1000
        return int(self.effect.duration_ms - elapsed_ms)


class SceneState:
    def __init__(self, default_scene: SceneId = "city") -> None:
        self._scene_id: SceneId = default_scene
        self._effects: dict[str, _TrackedEffect] = {}

    @property
    def scene_id(self) -> SceneId:
        return self._scene_id

    def snapshot(self, now: float | None = None) -> StateSyncPayload:
        """Current scene plus the effects that still have time left on them."""
        now = time.monotonic() if now is None else now
        live: list[ActiveEffect] = []
        for tracked in self._effects.values():
            remaining = tracked.remaining_ms(now)
            if remaining is None:
                live.append(tracked.effect)
            elif remaining >= MIN_DURATION_MS:
                live.append(
                    tracked.effect.model_copy(update={"duration_ms": remaining}),
                )
        return StateSyncPayload(scene_id=self._scene_id, effects=tuple(live))

    def apply(self, envelope: EventEnvelope, now: float | None = None) -> None:
        """Fold a broadcast event into the current state."""
        now = time.monotonic() if now is None else now
        payload = envelope.payload
        if isinstance(payload, SceneChangePayload):
            self._scene_id = payload.scene_id
        elif isinstance(payload, EffectTriggerPayload):
            self._effects[payload.effect_id] = _TrackedEffect(
                effect=ActiveEffect(
                    effect_id=payload.effect_id,
                    intensity=payload.intensity,
                    duration_ms=payload.duration_ms,
                ),
                started_at=now,
            )
        elif isinstance(payload, EffectClearPayload):
            if payload.effect_id is None:
                self._effects.clear()
            else:
                self._effects.pop(payload.effect_id, None)
