from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from livescape_event_server.app import create_app
from livescape_event_server.config import Settings


@pytest.fixture
def anyio_backend() -> str:
    """Run ``@pytest.mark.anyio`` tests on asyncio only."""
    return "asyncio"


@pytest.fixture
def app() -> FastAPI:
    return create_app(Settings())


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def scene_change(scene_id: str = "forest", **payload: object) -> dict[str, object]:
    return {
        "version": 1,
        "type": "scene.change",
        "source": "manual",
        "payload": {"sceneId": scene_id, **payload},
    }


def effect_trigger(effect_id: str = "rain", **payload: object) -> dict[str, object]:
    return {
        "version": 1,
        "type": "effect.trigger",
        "source": "simulation",
        "payload": {"effectId": effect_id, **payload},
    }


def effect_clear(effect_id: str | None = None) -> dict[str, object]:
    return {
        "version": 1,
        "type": "effect.clear",
        "source": "manual",
        "payload": {"effectId": effect_id},
    }


def scene_action(action_id: str = "roadside.send-bus", **extra: object) -> dict[str, object]:
    return {
        "version": 1,
        "type": "scene.action",
        "source": "manual",
        "payload": {"actionId": action_id, **extra},
    }


class ManualClock:
    """Monotonic seconds the test moves by hand, for action cooldowns."""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds
