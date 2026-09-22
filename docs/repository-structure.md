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
| `src/App.tsx` | Composition: scene layers, crossfade, effects layer, debug overlay |
| `src/useEventStream.ts` | WebSocket subscription and reconnect backoff |
| `src/rendererState.ts` | Pure reducer folding protocol events into renderer state |
| `src/scenes/` | One component per scene, plus the `SCENE_COMPONENTS` map |
| `src/effects/` | Canvas particle systems and the layer that drives them |
| `src/config.ts` | Environment and URL-parameter resolution |

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
