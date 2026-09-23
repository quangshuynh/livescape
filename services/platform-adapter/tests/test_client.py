"""The event-server client: one attempt, clean classification, loopback only."""

from __future__ import annotations

import json
import socket
import urllib.request
from typing import Any

import pytest

from livescape_platform_adapter.client import (
    FALLBACK_RETRY_AFTER_MS,
    MAX_RETRY_AFTER_MS,
    EventServerClient,
    HttpResponse,
    TransportError,
    UrllibTransport,
    interpret_response,
    require_loopback_url,
)


def response(status: int, body: object = None, **headers: str) -> HttpResponse:
    raw = b"" if body is None else json.dumps(body).encode()
    return HttpResponse(status, raw, headers)


ACCEPTED = {"event": {"type": "scene.action", "payload": {"actionId": "x"}}, "deliveredTo": 2}


class RecordingTransport:
    def __init__(self, result: HttpResponse | Exception) -> None:
        self.result = result
        self.requests: list[tuple[str, dict[str, Any]]] = []

    def post_json(self, path: str, body: dict[str, Any]) -> HttpResponse:
        self.requests.append((path, body))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def test_the_request_is_the_same_scene_action_the_control_panel_sends() -> None:
    transport = RecordingTransport(response(202, ACCEPTED))
    client = EventServerClient(transport, "simulation")

    result = client.submit_action("roadside.send-bus")

    assert transport.requests == [
        (
            "/api/events",
            {
                "version": 1,
                "type": "scene.action",
                "source": "simulation",
                "payload": {"actionId": "roadside.send-bus"},
            },
        )
    ]
    assert result.outcome == "accepted"
    assert result.delivered_to == 2


def test_202_is_accepted() -> None:
    assert interpret_response(response(202, ACCEPTED)).outcome == "accepted"


@pytest.mark.parametrize(
    "body",
    [None, "ok", {"deliveredTo": 1}, {"event": {"type": "scene.change"}, "deliveredTo": 1}],
)
def test_a_malformed_202_is_a_server_error(body: object) -> None:
    result = interpret_response(response(202, body))

    assert result.outcome == "server-error"
    assert result.detail == "malformed 202 response"


def test_409_is_wrong_scene_with_the_server_detail() -> None:
    result = interpret_response(response(409, {"detail": "belongs to forest", "sceneId": "x"}))

    assert result.outcome == "wrong-scene"
    assert result.detail == "belongs to forest"


def test_422_is_rejected() -> None:
    assert interpret_response(response(422, {"detail": [{"msg": "bad"}]})).outcome == "rejected"


def test_429_uses_retry_after_ms_from_the_body() -> None:
    result = interpret_response(response(429, {"retryAfterMs": 6500}, **{"Retry-After": "7"}))

    assert result.outcome == "cooling-down"
    assert result.retry_after_ms == 6500


def test_429_falls_back_to_the_retry_after_header() -> None:
    assert interpret_response(response(429, {}, **{"retry-after": "3"})).retry_after_ms == 3000


@pytest.mark.parametrize(
    ("body", "headers", "expected"),
    [
        ({}, {}, FALLBACK_RETRY_AFTER_MS),
        ({"retryAfterMs": -5}, {}, FALLBACK_RETRY_AFTER_MS),
        ({"retryAfterMs": "soon"}, {"Retry-After": "nan"}, FALLBACK_RETRY_AFTER_MS),
        ({"retryAfterMs": 10**9}, {}, MAX_RETRY_AFTER_MS),
        ({}, {"Retry-After": "86400"}, MAX_RETRY_AFTER_MS),
    ],
)
def test_429_retry_information_is_bounded(
    body: dict[str, object], headers: dict[str, str], expected: int
) -> None:
    assert interpret_response(response(429, body, **headers)).retry_after_ms == expected


@pytest.mark.parametrize("status", [400, 404, 500, 503, 301])
def test_other_statuses_are_server_errors(status: int) -> None:
    result = interpret_response(response(status, {"detail": "x"}))

    assert result.outcome == "server-error"
    assert str(status) in result.detail


def test_non_json_bodies_do_not_raise() -> None:
    assert interpret_response(HttpResponse(409, b"\xff\xfe", {})).outcome == "wrong-scene"


def test_an_unreachable_server_is_unavailable_not_an_exception() -> None:
    client = EventServerClient(RecordingTransport(TransportError("refused")), "simulation")

    result = client.submit_action("roadside.send-bus")

    assert result.outcome == "unavailable"
    assert result.detail == "refused"


def _closed_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_the_real_transport_reports_a_closed_port_as_unavailable() -> None:
    transport = UrllibTransport(f"http://127.0.0.1:{_closed_port()}", timeout_s=1.0)

    result = EventServerClient(transport, "simulation").submit_action("roadside.send-bus")

    assert result.outcome == "unavailable"


def test_the_real_transport_ignores_proxy_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    # urllib's default opener reads http_proxy from the environment; loopback
    # traffic to the event server must never be routed through a proxy.
    monkeypatch.setenv("http_proxy", "http://proxy.invalid:3128")
    transport = UrllibTransport("http://127.0.0.1:8765")

    assert not any(
        isinstance(handler, urllib.request.ProxyHandler) and handler.proxies  # type: ignore[attr-defined]
        for handler in transport._opener.handlers
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8765",
        "http://127.0.0.1:8765/",
        "http://localhost:8765",
        "http://[::1]:8765",
        "http://127.0.0.2:9000",
    ],
)
def test_loopback_urls_are_allowed(url: str) -> None:
    assert not require_loopback_url(url).endswith("/")


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1:8765",
        "http://0.0.0.0:8765",
        "http://192.168.1.10:8765",
        "http://example.com",
        "http://localhost.example.com:8765",
        "http://127.0.0.1:8765/api/events",
        "http://127.0.0.1:8765?x=1",
        "http://user:pass@127.0.0.1:8765",
        "file:///etc/passwd",
        "127.0.0.1:8765",
    ],
)
def test_non_loopback_or_decorated_urls_are_refused(url: str) -> None:
    with pytest.raises(ValueError):
        require_loopback_url(url)
