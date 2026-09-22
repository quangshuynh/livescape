# CONTEXT.md

Compact technical handoff for coding agents. It describes what exists on the
current branch, not what is planned. User-facing documentation lives in
`README.md` and `docs/`; the durable rules live in `AGENTS.md`.

## Purpose

Local-first interactive scene engine for livestreams. A renderer draws a
dynamic environment, reacts to normalized events in real time, and is consumed
by OBS as a Browser Source.

## Architecture

```text
Control Panel
    ↓ POST /api/events
Event Server
    ↓ WebSocket /ws
Renderer
    ↓
OBS Browser Source
```

Platform adapters do not exist yet. When they do, they sit upstream of the
event server and translate external events into the same envelopes the control
panel already sends.

## Repository structure

```text
apps/renderer/         React + Vite renderer; the OBS Browser Source
apps/control-panel/    React + Vite operator UI
services/event-server/ FastAPI event server (Python 3.13+)
packages/protocol/     Shared TypeScript protocol types, guards, registry
docs/                  MkDocs documentation site sources
mkdocs.yml             Documentation site configuration
requirements-docs.txt  Documentation tooling (MkDocs + Material)
.github/workflows/ci.yml  Python and TypeScript verification
```

npm workspaces: `packages/*` and `apps/*`. The event server is a separate
Python package installed with `pip install -e "services/event-server[dev]"`.

## Event flow

1. The control panel builds a request with a `@livescape/protocol` builder and
   POSTs it to `/api/events`.
2. FastAPI validates it against the Pydantic models in `models.py`. A rejection
   is a `422` and never reaches a renderer.
3. `envelope_from_request` stamps a server-owned `id` and `timestamp`.
4. `SceneState.apply` folds the envelope into in-memory state.
5. `ConnectionHub.broadcast` fans the envelope out to every WebSocket client
   concurrently. A failing client is dropped without affecting the others.
6. Each renderer re-validates the frame with `parseEventJson` and folds it into
   `rendererState` with a pure reducer.

A client that connects to `/ws` is sent a `state.sync` envelope immediately, so
a late or reconnecting renderer adopts the current scene instead of snapping
back to the default.

## Event protocol (v1)

Envelope: `{ version, id, type, source, timestamp, payload }`, camelCase on the
wire.

| Type | Direction | Payload |
| --- | --- | --- |
| `scene.change` | client → server → renderer | `{ sceneId, transitionMs }` |
| `effect.trigger` | client → server → renderer | `{ effectId, intensity, durationMs }` |
| `effect.clear` | client → server → renderer | `{ effectId \| null }` |
| `state.sync` | server → renderer only | `{ sceneId, effects[] }` |

Sources: `manual`, `simulation`, `system`. Bounds: `transitionMs` 0 to 10000
(default 900), `intensity` 0.01 to 1 (default 1), `durationMs` 100 to 600000 or
`null` for "run until cleared". Unknown fields are rejected (`extra: "forbid"`).

The protocol is defined twice, once per runtime, and both are validated against
the same allowlist. `packages/protocol/registry.json` is canonical;
`services/event-server/src/livescape_event_server/registry.json` is a copy and
`tests/test_registry.py` fails if the two drift. `registry.ts` throws at import
time if the JSON disagrees with the declared TypeScript unions.

Full reference: [docs/protocol.md](docs/protocol.md).

## Component responsibilities

**Renderer** (`apps/renderer`)

* Subscribes to `/ws`, re-validates every frame, and ignores anything invalid.
* Reconnects with exponential backoff and jitter, 500 ms up to 8 s, forever.
* Keeps the current scene on screen when the server disappears.
* Resolves scene ids through `SCENE_COMPONENTS`, a fixed component map, and
  effect ids through a fixed particle-system factory.
* Crossfades scenes, expires timed effects on a 250 ms tick, and honors
  `prefers-reduced-motion` by cutting particle budgets.
* Renders no chrome by default. `?debug=1` enables a small status overlay.

**Event server** (`services/event-server`)

* Validates, stamps, stores, and broadcasts. It does nothing else.
* Endpoints: `GET /healthz`, `GET /api/registry`, `POST /api/events` (`202` on
  success), `WS /ws`.
* `/ws` is a read-only subscription. Inbound frames are drained so disconnects
  are noticed but are never interpreted as commands.
* Binds to `127.0.0.1` by default with a CORS allowlist for the two dev servers.
* State is in memory only. A restart returns to the default scene.

**Control panel** (`apps/control-panel`)

* Scene buttons, effect triggers with intensity, and clear controls.
* A clearly labelled "simulated viewer event" section that maps a pretend gift,
  follow, or chat command onto a normalized `effect.trigger` tagged
  `source: "simulation"`. It demonstrates the adapter boundary; it observes no
  real viewer.
* Health polling and a live activity feed over the same WebSocket.

## Scenes and effects

Scenes: `city`, `forest`, `space`. Drawn with CSS and SVG, no external assets.

Effects: `rain`, `snow`, `fireworks`. Canvas particle systems with per-effect
budgets scaled by intensity. `fireworks` defaults to 8000 ms; `rain` and `snow`
run until cleared.

## Configuration

| Variable | Default |
| --- | --- |
| `LIVESCAPE_HOST` | `127.0.0.1` |
| `LIVESCAPE_PORT` | `8765` |
| `LIVESCAPE_DEFAULT_SCENE` | `city` |
| `LIVESCAPE_LOG_LEVEL` | `info` |
| `LIVESCAPE_ALLOWED_ORIGINS` | the four loopback dev-server origins |
| `VITE_LIVESCAPE_WS_URL` | `ws://127.0.0.1:8765/ws` |
| `VITE_LIVESCAPE_API_URL` | `http://127.0.0.1:8765` (control panel only) |

Every value is also the built-in default, so no `.env` file is required.

## Tests

| Suite | Count |
| --- | --- |
| `services/event-server/tests` (pytest) | 51 |
| `packages/protocol` (Vitest) | 23 |
| `apps/control-panel` (Vitest) | 20 |
| `apps/renderer` (Vitest) | 35 |

Coverage is concentrated on protocol validation, the state reducer on both
sides, broadcast and disconnect behaviour, WebSocket handshake and `state.sync`,
and registry drift. No test needs a camera, a GPU, or OBS.

Verification commands:

```bash
python -m ruff check services/event-server
python -m ruff format --check services/event-server
python -m pytest services/event-server
npm run lint && npm run typecheck && npm test && npm run build
mkdocs build --strict
```

CI runs the Python and TypeScript commands on every push and pull request. The
documentation build is local only.

## Invariants

* The renderer never learns about a platform. Adapters normalize upstream.
* Scene and effect ids resolve through the registry allowlist on both sides.
* Payloads carry no code, paths, URLs, or prompts, and there is no generic
  "execute action" event.
* `id` and `timestamp` are server-owned.
* The WebSocket is read-only from the client's perspective.
* Both runtimes validate independently; the renderer re-validates every frame.
* Loopback binding by default; no authentication, so no untrusted exposure.
* The OBS output stays clean. Diagnostics are opt-in via `?debug=1`.
* Camera frames never travel over HTTP or the WebSocket.

## Limitations

* No persistence. Scene state is in memory and resets on restart.
* No authentication or authorization on the control API.
* No platform integration. The control panel and its simulation section are the
  only event sources.
* No camera compositing or subject segmentation.
* No audio, no 3D, no AI.
* Single process, single machine. No multi-operator coordination.

## Immediate direction

* Camera compositing in the renderer: capture, local segmentation, and a
  compositor that can draw scene layers behind and in front of the subject.
  Frames stay in the renderer process. The target flow is:

```text
Camera
    ↓
Local segmentation
    ↓
Renderer compositor
    ↑
LiveScape scene/effects
    ↓
OBS
```

* Platform adapters as separate processes that speak the existing protocol.
* Possible follow-ups for the documentation site: a `mkdocs build --strict` job
  in CI, and GitHub Pages deployment once that is in scope.
