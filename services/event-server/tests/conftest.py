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
