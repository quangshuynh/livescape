"""FastAPI application for the LiveScape event server.

Responsibilities are deliberately narrow: validate normalized events, keep a
small amount of in-memory scene state, and fan events out to renderer clients.
It never interprets payloads as code, paths, URLs or prompts -- scene, effect
and action ids are resolved through the explicit registry allowlist and
nothing else crosses the boundary.
"""

from __future__ import annotations

import logging
import math
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Body, FastAPI, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from . import __version__
from .actions import ActionGate
from .config import Settings, load_settings
from .hub import ConnectionHub
from .models import (
    EventEnvelope,
    EventRequest,
    SceneActionRequest,
    envelope_from_request,
    state_sync_envelope,
)
from .registry import (
    PROTOCOL_VERSION,
    SCENE_ACTION_IDS,
    EffectId,
    SceneActionId,
    SceneId,
    load_registry,
)
from .state import SceneState

logger = logging.getLogger("livescape.app")


class ApiModel(BaseModel):
    """camelCase on the wire, snake_case in Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class HealthResponse(ApiModel):
    status: str
    version: str
    protocol_version: int
    uptime_seconds: float
    connected_clients: int
    current_scene: SceneId
    active_effects: list[EffectId]
    #: Scene actions still inside their cooldown, with the milliseconds left.
    action_cooldowns: dict[SceneActionId, int]


class AcceptedEventResponse(ApiModel):
    event: EventEnvelope
    delivered_to: int


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "LiveScape event server ready on http://%s:%d (protocol v%d)",
            resolved.host,
            resolved.port,
            PROTOCOL_VERSION,
        )
        yield

    app = FastAPI(
        title="LiveScape event server",
        version=__version__,
        summary="Local-first normalized event intake and renderer broadcast.",
        lifespan=lifespan,
    )

    app.state.settings = resolved
    app.state.hub = ConnectionHub()
    app.state.scene = SceneState(default_scene=resolved.default_scene)  # type: ignore[arg-type]
    app.state.actions = ActionGate()
    #: Monotonic seconds for action cooldowns; replaced by the tests.
    app.state.clock = time.monotonic
    app.state.started_at = time.monotonic()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    def hub_of(request: Request) -> ConnectionHub:
        return request.app.state.hub  # type: ignore[no-any-return]

    @app.get("/healthz", response_model=HealthResponse, tags=["system"])
    async def healthz(request: Request) -> HealthResponse:
        """Liveness probe used by the control panel's connection indicator."""
        app_state = request.app.state
        now = app_state.clock()
        cooldowns = {
            action_id: remaining
            for action_id in SCENE_ACTION_IDS
            if (remaining := app_state.actions.remaining_ms(action_id, now)) > 0
        }
        return HealthResponse(
            status="ok",
            version=__version__,
            protocol_version=PROTOCOL_VERSION,
            uptime_seconds=round(time.monotonic() - app_state.started_at, 3),
            connected_clients=app_state.hub.client_count,
            current_scene=app_state.scene.scene_id,
            active_effects=[effect.effect_id for effect in app_state.scene.snapshot().effects],
            action_cooldowns=cooldowns,  # type: ignore[arg-type]
        )

    @app.get("/api/registry", tags=["protocol"])
    async def registry() -> dict[str, Any]:
        """The allowlist of scenes, effects and scene actions this deployment supports."""
        return load_registry()

    @app.post(
        "/api/events",
        response_model=AcceptedEventResponse,
        status_code=status.HTTP_202_ACCEPTED,
        tags=["events"],
    )
    async def post_event(
        request: Request,
        event: Annotated[EventRequest, Body()],
    ) -> AcceptedEventResponse | JSONResponse:
        """Validate a normalized event, fold it into state, and broadcast it.

        Anything that does not match the protocol is rejected with 422 before
        it can reach a renderer. A ``scene.action`` is transient: it is
        broadcast but never folded into state, and it is rejected with 409 when
        the current scene does not own it or 429 while it is cooling down.
        """
        scene: SceneState = request.app.state.scene
        if isinstance(event, SceneActionRequest):
            rejection = _admit_action(
                request.app.state.actions, event, scene.scene_id, request.app.state.clock()
            )
            if rejection is not None:
                return rejection
        envelope = envelope_from_request(event)
        scene.apply(envelope)
        delivered = await hub_of(request).broadcast(envelope.to_wire())
        logger.info(
            "accepted %s from %s -> %d client(s)", envelope.type, envelope.source, delivered
        )
        return AcceptedEventResponse(event=envelope, delivered_to=delivered)

    @app.websocket("/ws")
    async def renderer_socket(websocket: WebSocket) -> None:
        """Renderer/control-panel subscription channel.

        The socket is read-only from the client's perspective: inbound frames
        are drained so disconnects are noticed, but they are never interpreted
        as commands. Events are only accepted through ``POST /api/events``.
        """
        await websocket.accept()
        hub: ConnectionHub = websocket.app.state.hub
        scene: SceneState = websocket.app.state.scene
        await hub.register(websocket)
        try:
            await hub.send_to(websocket, state_sync_envelope(scene.snapshot()).to_wire())
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
        except WebSocketDisconnect:
            pass
        finally:
            await hub.unregister(websocket)

    return app


def _admit_action(
    gate: ActionGate, event: SceneActionRequest, current_scene: SceneId, now: float
) -> JSONResponse | None:
    """``None`` when the action may be broadcast, otherwise the rejection."""
    action_id = event.payload.action_id
    admission = gate.admit(action_id, current_scene, now)
    if admission.outcome == "accepted":
        return None
    if admission.outcome == "wrong-scene":
        logger.info("rejected %s: not an action of %s", action_id, current_scene)
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": f"{action_id} belongs to {admission.scene_id}, "
                f"but the current scene is {current_scene}",
                "sceneId": admission.scene_id,
            },
        )
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        headers={"Retry-After": str(math.ceil(admission.retry_after_ms / 1000))},
        content={
            "detail": f"{action_id} is cooling down",
            "retryAfterMs": admission.retry_after_ms,
        },
    )


app = create_app()
