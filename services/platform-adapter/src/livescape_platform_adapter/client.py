"""Submits scene actions to the event server's existing HTTP API.

The adapter is an ordinary event source, exactly like the control panel: it
POSTs a normal ``scene.action`` request to ``/api/events`` and the event server
decides. There is no adapter-specific endpoint, WebSocket or privilege.

Every call is one attempt. The client never retries: a refused action (409,
422, 429) is final, and a server that cannot be reached means the visual moment
has passed, not that it should be replayed later.

The server URL must be loopback. The event server is unauthenticated and
loopback-only, so there is no supported reason to send events anywhere else,
and refusing other hosts keeps a mistyped configuration from doing so.
"""

from __future__ import annotations

import ipaddress
import json
import math
import urllib.error
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib.parse import urlsplit

DEFAULT_SERVER_URL = "http://127.0.0.1:8765"
DEFAULT_TIMEOUT_S = 2.0
#: Responses are small JSON documents; anything bigger is not our server.
MAX_RESPONSE_BYTES = 64 * 1024
#: Upper bound on how long a 429 may hold an action locally (the registry's
#: longest allowed cooldown), so a bad response cannot silence an action forever.
MAX_RETRY_AFTER_MS = 60_000
#: Used when a 429 carries no usable retry information.
FALLBACK_RETRY_AFTER_MS = 1_000

SubmitOutcome = Literal[
    "accepted",
    "wrong-scene",
    "cooling-down",
    "rejected",
    "server-error",
    "unavailable",
]


class TransportError(Exception):
    """The server could not be reached or did not answer in time."""


@dataclass(frozen=True, slots=True)
class HttpResponse:
    status: int
    body: bytes
    headers: Mapping[str, str]


class Transport(Protocol):
    def post_json(self, path: str, body: Mapping[str, Any]) -> HttpResponse: ...


@dataclass(frozen=True, slots=True)
class SubmitResult:
    outcome: SubmitOutcome
    status: int | None = None
    #: Renderer clients the server broadcast to, for ``accepted``.
    delivered_to: int | None = None
    #: For ``cooling-down``: how long the server says to wait.
    retry_after_ms: int | None = None
    detail: str = ""


def require_loopback_url(url: str) -> str:
    """Return ``url`` without a trailing slash, or raise ``ValueError``."""
    parts = urlsplit(url)
    if parts.scheme != "http" or not parts.hostname:
        raise ValueError(f"event server URL must be http://<loopback>:<port>, got {url!r}")
    if parts.path not in ("", "/") or parts.query or parts.fragment or parts.username:
        raise ValueError("event server URL must not carry a path, query or credentials")
    host = parts.hostname
    if host != "localhost":
        try:
            loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = False
        if not loopback:
            raise ValueError(f"event server URL must be loopback, got host {host!r}")
    return url.rstrip("/")


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


class UrllibTransport:
    """Loopback HTTP with the standard library: no proxies, no redirects."""

    def __init__(self, base_url: str = DEFAULT_SERVER_URL, timeout_s: float = DEFAULT_TIMEOUT_S):
        self.base_url = require_loopback_url(base_url)
        self._timeout_s = timeout_s
        # An empty ProxyHandler ignores http_proxy and friends: loopback
        # traffic must never be routed through a proxy.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirects())

    def post_json(self, path: str, body: Mapping[str, Any]) -> HttpResponse:
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with self._opener.open(request, timeout=self._timeout_s) as response:
                return HttpResponse(
                    response.status, response.read(MAX_RESPONSE_BYTES), dict(response.headers)
                )
        except urllib.error.HTTPError as exc:
            with exc:
                return HttpResponse(exc.code, exc.read(MAX_RESPONSE_BYTES), dict(exc.headers))
        except (urllib.error.URLError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            raise TransportError(str(reason)) from None


class EventServerClient:
    def __init__(self, transport: Transport, source: str) -> None:
        self._transport = transport
        self._source = source

    def scene_action_request(self, action_id: str) -> dict[str, Any]:
        """The same request body the control panel builds for a scene action."""
        return {
            "version": 1,
            "type": "scene.action",
            "source": self._source,
            "payload": {"actionId": action_id},
        }

    def submit_action(self, action_id: str) -> SubmitResult:
        """One attempt to have the event server broadcast ``action_id``."""
        try:
            response = self._transport.post_json(
                "/api/events", self.scene_action_request(action_id)
            )
        except TransportError as exc:
            return SubmitResult("unavailable", detail=str(exc) or "unreachable")
        return interpret_response(response)


def interpret_response(response: HttpResponse) -> SubmitResult:
    status = response.status
    body = _json_object(response.body)
    detail = body.get("detail") if isinstance(body.get("detail"), str) else ""

    if status == 202:
        delivered = body.get("deliveredTo")
        event = body.get("event")
        if (
            isinstance(delivered, int)
            and not isinstance(delivered, bool)
            and isinstance(event, dict)
            and event.get("type") == "scene.action"
        ):
            return SubmitResult("accepted", status, delivered_to=delivered)
        return SubmitResult("server-error", status, detail="malformed 202 response")
    if status == 409:
        return SubmitResult("wrong-scene", status, detail=detail or "not the current scene")
    if status == 422:
        return SubmitResult("rejected", status, detail="event server rejected the request")
    if status == 429:
        return SubmitResult(
            "cooling-down", status, retry_after_ms=_retry_after_ms(body, response.headers)
        )
    return SubmitResult("server-error", status, detail=f"unexpected HTTP {status}")


def _json_object(raw: bytes) -> dict[str, Any]:
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _retry_after_ms(body: Mapping[str, Any], headers: Mapping[str, str]) -> int:
    value = body.get("retryAfterMs")
    if not (isinstance(value, int) and not isinstance(value, bool) and value > 0):
        header = next((v for k, v in headers.items() if k.lower() == "retry-after"), None)
        try:
            seconds = float(header) if header is not None else math.nan
        except ValueError:
            seconds = math.nan
        value = math.ceil(seconds * 1000) if math.isfinite(seconds) and seconds > 0 else None
    if value is None:
        return FALLBACK_RETRY_AFTER_MS
    return min(int(value), MAX_RETRY_AFTER_MS)
