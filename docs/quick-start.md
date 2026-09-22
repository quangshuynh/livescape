# Quick Start

This walks through starting the three local processes and sending the first
event. It assumes you have finished [Installation](installation.md).

## 1. Start the event server

With the virtual environment active:

```bash
python -m livescape_event_server
```

It listens on `http://127.0.0.1:8765`. Confirm it is up:

```bash
curl http://127.0.0.1:8765/healthz
```

The response reports the protocol version, uptime, connected clients, the
current scene and any active effects.

## 2. Start the renderer and control panel

In a second terminal:

```bash
npm run dev
```

| App | URL |
| --- | --- |
| Renderer | <http://127.0.0.1:5173> |
| Control panel | <http://127.0.0.1:5174> |

Run them individually with `npm run dev:renderer` and `npm run dev:panel`.

## 3. Send an event

Open the control panel and press **Forest**. The renderer crossfades within a
second. Press **Rain**, then **Clear effects**.

You can also drive the server directly:

```bash
curl -X POST http://127.0.0.1:8765/api/events \
  -H "Content-Type: application/json" \
  -d '{"version":1,"type":"scene.change","source":"manual","payload":{"sceneId":"forest"}}'
```

The server replies `202 Accepted` with the stamped envelope and the number of
clients it reached. An invalid event is rejected with `422` and never reaches a
renderer. See the [Event Server API](api.md) for the full surface.

## 4. Simulated viewer events

The control panel's **Simulated viewer event** section is development
functionality and is labelled as such in the UI. It maps a pretend viewer
action (gift, follow or chat command) onto a normalized `effect.trigger` tagged
`source: "simulation"`, which is exactly what a real platform adapter will do
later. It observes no real viewer, and no platform is connected.

## 5. Debug overlay

Open the renderer with `?debug=1` for a small overlay showing connection state,
the current scene and active effects:

<http://127.0.0.1:5173/?debug=1>

It is off by default so the OBS source stays clean. Do not add `?debug=1` to
the URL you give OBS.

Next: [OBS Setup](obs.md).
