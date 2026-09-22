"""Runtime configuration, read from the environment with local-first defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from .registry import SCENE_IDS

DEFAULT_ALLOWED_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://localhost:5174",
)


@dataclass(frozen=True, slots=True)
class Settings:
    #: Loopback by default: the control API is unauthenticated and local-only.
    host: str = "127.0.0.1"
    port: int = 8765
    default_scene: str = "city"
    log_level: str = "info"
    allowed_origins: tuple[str, ...] = field(default_factory=lambda: DEFAULT_ALLOWED_ORIGINS)


def _env_str(name: str, fallback: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or fallback


def load_settings() -> Settings:
    port_raw = _env_str("LIVESCAPE_PORT", "8765")
    try:
        port = int(port_raw)
    except ValueError as exc:
        raise ValueError(f"LIVESCAPE_PORT must be an integer, got {port_raw!r}") from exc

    default_scene = _env_str("LIVESCAPE_DEFAULT_SCENE", "city")
    if default_scene not in SCENE_IDS:
        raise ValueError(
            f"LIVESCAPE_DEFAULT_SCENE must be one of {SCENE_IDS}, got {default_scene!r}"
        )

    origins_raw = os.environ.get("LIVESCAPE_ALLOWED_ORIGINS", "").strip()
    origins = (
        tuple(part.strip() for part in origins_raw.split(",") if part.strip())
        if origins_raw
        else DEFAULT_ALLOWED_ORIGINS
    )

    return Settings(
        host=_env_str("LIVESCAPE_HOST", "127.0.0.1"),
        port=port,
        default_scene=default_scene,
        log_level=_env_str("LIVESCAPE_LOG_LEVEL", "info").lower(),
        allowed_origins=origins,
    )
