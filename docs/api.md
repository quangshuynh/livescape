# Event Server API

The event server is a FastAPI application. It binds to `127.0.0.1:8765` by
default and is **unauthenticated**: it is designed for loopback use only. See
[Security and Privacy](security.md).

FastAPI's own interactive documentation is served at `/docs` while the server
is running.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/healthz` | GET | Liveness and a snapshot of current state |
| `/api/registry` | GET | The allowlist of scenes and effects |
| `/api/events` | POST | Validate, apply and broadcast an event |
| `/ws` | WebSocket | Read-only subscription channel |

## `GET /healthz`

Used by the control panel's connection indicator.

```json
{
  "status": "ok",
  "version": "0.1.0",
  "protocolVersion": 1,
  "uptimeSeconds": 42.317,
  "connectedClients": 2,
  "currentScene": "forest",
  "activeEffects": ["rain"]
}
```

## `GET /api/registry`

Returns the allowlist this deployment can render: scenes, effects with their
default durations, and the valid event sources. The control panel builds its UI
from this response rather than hard-coding a list.

See [Scenes and Effects](scenes-and-effects.md) for the current contents.

## `POST /api/events`

The only way to inject an event. The body is the protocol envelope minus `id`
and `timestamp`, which the server owns.

```bash
curl -X POST http://127.0.0.1:8765/api/events \
  -H "Content-Type: application/json" \
  -d '{"version":1,"type":"effect.trigger","source":"simulation","payload":{"effectId":"fireworks","intensity":0.5}}'
```

`202 Accepted` on success:

```json
{
  "event": {
    "version": 1,
    "id": "0f1c9b9e-2b7a-4a3f-9f3b-6d0f5f0d4a11",
    "type": "effect.trigger",
    "source": "simulation",
    "timestamp": "2026-09-22T11:07:34.512Z",
    "payload": { "effectId": "fireworks", "intensity": 0.5, "durationMs": 8000 }
  },
  "deliveredTo": 2
}
```

`deliveredTo` is the number of clients that actually received the broadcast.
Zero is normal when no renderer is open; it is not an error.

`422 Unprocessable Entity` on rejection, with FastAPI's validation detail. An
unknown scene or effect id, an out-of-range value, an unknown field, a wrong
protocol version, or an attempt to send the server-only `state.sync` are all
rejected here, before anything reaches a renderer.

## `WS /ws`

Renderer and control-panel subscription channel.

On connect, the server immediately sends a `state.sync` envelope describing the
current scene and the effects that still have time left on them. After that it
sends every accepted event, in the order it accepted them.

The socket is **read-only from the client's perspective**. Inbound frames are
drained so that disconnects are noticed promptly, but they are never
interpreted as commands. Events are only accepted over HTTP.

Clients are expected to reconnect on their own. The renderer uses exponential
backoff with jitter, from 500 ms up to 8 s, and keeps its current scene on
screen the whole time.

## CORS

`LIVESCAPE_ALLOWED_ORIGINS` lists the origins permitted to call the HTTP
endpoints from a browser. It defaults to the four loopback dev-server origins.
Credentials are not allowed, and only `GET`, `POST` and `OPTIONS` are.
