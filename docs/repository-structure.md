# Repository Structure

LiveScape is an npm workspace monorepo with one Python package alongside it.

```text
apps/
  renderer/          React + Vite scene renderer (the OBS Browser Source)
  control-panel/     React + Vite operator UI
services/
  event-server/      FastAPI event server (Python 3.13+)
packages/
  protocol/          Shared TypeScript protocol types, guards and registry
docs/                Documentation site sources
.github/workflows/   CI
```

The npm workspaces are `packages/*` and `apps/*`. The event server is not part
of the JavaScript workspace; it is installed separately with pip.

## `packages/protocol`

The canonical TypeScript definition of the event protocol.

| File | Contents |
| --- | --- |
| `registry.json` | Canonical allowlist of scenes, effects and sources |
| `src/registry.ts` | Id unions, type guards, registry lookups. Throws at import time if the JSON and the unions disagree |
| `src/events.ts` | Envelope and payload types |
| `src/validate.ts` | Runtime validation, shared bounds, request builders |

It is consumed as source, not as a build artifact: the apps import
`@livescape/protocol` and Vite compiles it along with everything else.

## `apps/renderer`

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | The stage: scene planes, effect planes and the camera layer in stage order, plus the debug overlay |
| `src/useEventStream.ts` | WebSocket subscription and reconnect backoff |
| `src/rendererState.ts` | Pure reducer folding protocol events into renderer state |
| `src/scenes/` | Scene artwork per plane, the `SCENES` definitions, the scene director that runs showings and crossfades, and the plane component |
| `src/actors/` | The actor vocabulary and validation, the pure population model, the timer-driven engine, sprite artwork, and the plane that animates actors |
| `src/effects/` | Canvas particle systems and the layer that drives them |
| `src/camera/` | Camera lifecycle: pure state reducer, media access, and the hook that owns the `MediaStream` |
| `src/segmentation/` | The `SubjectSegmenter` boundary, the MediaPipe backend, the latest-frame scheduler, mask shaping and quality presets |
| `src/compositor/` | Stage order (`layers.ts`), framing maths, the draw routine and the camera layer |
| `src/setup/` | The `?setup=1` camera setup panel |
| `src/config.ts` | Environment and URL-parameter resolution |
| `public/models/` | The committed `.tflite` segmentation model and its notice |
| `vite/mediapipeAssets.ts` | Publishes the MediaPipe WASM runtime from `node_modules` under the renderer's own origin |

The camera modules are layered so the parts that need a browser are as small as
possible: `cameraState.ts`, `framing.ts`, `draw.ts`, `mask.ts` and
`scheduler.ts` are all free of DOM and media APIs, as are the actor model
(`population.ts`, `engine.ts`) and the scene director, which is what makes the
lifecycle and compositing rules testable without hardware.

## `apps/control-panel`

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | The operator UI |
| `src/api.ts` | HTTP client, health types, rejection formatting |
| `src/simulation.ts` | Maps simulated viewer actions onto normalized events |
| `src/useEventFeed.ts` | Live activity feed over the WebSocket |
| `src/useServerHealth.ts` | Health polling for the connection indicator |

## `services/event-server`

| File | Responsibility |
| --- | --- |
| `app.py` | FastAPI application, routes, CORS, WebSocket handler |
| `models.py` | Pydantic protocol models and shared bounds |
| `registry.py` / `registry.json` | Server copy of the allowlist |
| `state.py` | In-memory scene and effect state, with expiry tracking |
| `hub.py` | Connection registry and concurrent broadcast |
| `config.py` | Environment-driven settings |

`hub.py` deliberately knows nothing about FastAPI. It talks to anything with an
async `send_json`, which keeps broadcast and failure handling testable without
a real socket.

## Conventions

* TypeScript is strict, with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` on. Shared compiler options live in
  `tsconfig.base.json`.
* Python targets 3.13 and is linted and formatted with Ruff at a 100-character
  line length.
* Branches are `feat/<feature>`, `fix/<bug>`, `docs/<topic>` or
  `chore/<task>`, and commit messages follow Conventional Commits.
* `AGENTS.md`, `CLAUDE.md` and `CONTEXT.md` at the repository root hold the
  engineering contract and a compact technical handoff.
