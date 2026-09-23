"""Pydantic models for the LiveScape event protocol (version 1).

Two shapes exist:

* ``EventRequest`` -- what a client may POST. It carries no identity or time;
  the server assigns those so ordering is decided in exactly one place.
* ``EventEnvelope`` -- what the server broadcasts to renderer clients.

Payload bounds here intentionally match ``packages/protocol/src/validate.ts``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from .registry import (
    EFFECT_IDS,
    PROTOCOL_VERSION,
    EffectId,
    EventSource,
    SceneActionId,
    SceneId,
    default_duration_ms,
)

MIN_TRANSITION_MS = 0
MAX_TRANSITION_MS = 10_000
DEFAULT_TRANSITION_MS = 900
MIN_INTENSITY = 0.01
MAX_INTENSITY = 1.0
MIN_DURATION_MS = 100
MAX_DURATION_MS = 600_000

ProtocolVersion = Literal[1]


class ProtocolModel(BaseModel):
    """Strict base model: camelCase on the wire, snake_case in Python."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        frozen=True,
    )


class SceneChangePayload(ProtocolModel):
    scene_id: SceneId
    transition_ms: Annotated[int, Field(ge=MIN_TRANSITION_MS, le=MAX_TRANSITION_MS)] = (
        DEFAULT_TRANSITION_MS
    )


class EffectTriggerPayload(ProtocolModel):
    effect_id: EffectId
    intensity: Annotated[float, Field(ge=MIN_INTENSITY, le=MAX_INTENSITY)] = MAX_INTENSITY
    duration_ms: Annotated[int, Field(ge=MIN_DURATION_MS, le=MAX_DURATION_MS)] | None = None

    @model_validator(mode="before")
    @classmethod
    def _default_duration_from_registry(cls, data: Any) -> Any:
        """An omitted duration falls back to the effect's registry default.

        An explicit ``null`` still means "run until cleared", so the two cases
        must stay distinguishable.
        """
        if not isinstance(data, dict):
            return data
        if "durationMs" in data or "duration_ms" in data:
            return data
        effect_id = data.get("effectId", data.get("effect_id"))
        if isinstance(effect_id, str) and effect_id in EFFECT_IDS:
            return {**data, "durationMs": default_duration_ms(effect_id)}
        return data


class EffectClearPayload(ProtocolModel):
    #: ``None`` clears every active effect.
    effect_id: EffectId | None = None


class SceneActionPayload(ProtocolModel):
    """A one-shot request for a predefined scene action.

    The payload is an allowlisted id and nothing else: an action selects a
    capability the renderer already has and cannot carry parameters, code,
    URLs, paths or prompts. It is transient and never folded into state.
    """

    action_id: SceneActionId


class ActiveEffect(ProtocolModel):
    effect_id: EffectId
    intensity: Annotated[float, Field(ge=MIN_INTENSITY, le=MAX_INTENSITY)]
    duration_ms: Annotated[int, Field(ge=MIN_DURATION_MS, le=MAX_DURATION_MS)] | None = None


class StateSyncPayload(ProtocolModel):
    scene_id: SceneId
    effects: tuple[ActiveEffect, ...] = ()


class SceneChangeRequest(ProtocolModel):
    version: ProtocolVersion
    type: Literal["scene.change"]
    source: EventSource = "manual"
    payload: SceneChangePayload


class EffectTriggerRequest(ProtocolModel):
    version: ProtocolVersion
    type: Literal["effect.trigger"]
    source: EventSource = "manual"
    payload: EffectTriggerPayload


class EffectClearRequest(ProtocolModel):
    version: ProtocolVersion
    type: Literal["effect.clear"]
    source: EventSource = "manual"
    payload: EffectClearPayload = EffectClearPayload()


class SceneActionRequest(ProtocolModel):
    version: ProtocolVersion
    type: Literal["scene.action"]
    source: EventSource = "manual"
    payload: SceneActionPayload


ClientRequest = SceneChangeRequest | EffectTriggerRequest | EffectClearRequest | SceneActionRequest

EventRequest = Annotated[ClientRequest, Field(discriminator="type")]

EventPayload = (
    SceneChangePayload
    | EffectTriggerPayload
    | EffectClearPayload
    | SceneActionPayload
    | StateSyncPayload
)


class EventEnvelope(ProtocolModel):
    """The normalized event as broadcast to renderer clients."""

    version: ProtocolVersion = PROTOCOL_VERSION
    id: str
    type: Literal["scene.change", "effect.trigger", "effect.clear", "scene.action", "state.sync"]
    source: EventSource
    timestamp: str
    payload: EventPayload

    def to_wire(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True)


def utc_now_iso() -> str:
    """ISO-8601 UTC timestamp with a ``Z`` suffix."""
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def envelope_from_request(request: ClientRequest) -> EventEnvelope:
    """Stamp a validated client request with server-owned identity and time."""
    return EventEnvelope(
        version=PROTOCOL_VERSION,
        id=str(uuid.uuid4()),
        type=request.type,
        source=request.source,
        timestamp=utc_now_iso(),
        payload=request.payload,
    )


def state_sync_envelope(payload: StateSyncPayload) -> EventEnvelope:
    return EventEnvelope(
        version=PROTOCOL_VERSION,
        id=str(uuid.uuid4()),
        type="state.sync",
        source="system",
        timestamp=utc_now_iso(),
        payload=payload,
    )
