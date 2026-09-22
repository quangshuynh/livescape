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
  src/scenes/            Scene art per plane, SCENES definitions, SceneDirector
  src/actors/            Actor vocabulary, validation, population model, engine,
                         sprite art, ActorPlane
  src/camera/            Camera lifecycle (pure reducer, media access, hook)
  src/segmentation/      SubjectSegmenter boundary, MediaPipe backend, scheduler
  src/compositor/        Stage order, framing maths, draw routine, camera layer
  src/setup/             The `?setup=1` camera setup panel
  public/models/         Committed `.tflite` model plus its NOTICE
  vite/mediapipeAssets.ts  Publishes the MediaPipe WASM runtime locally
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
* Resolves scene ids through `SCENES`, a fixed map of scene definitions, and
  effect ids through a fixed particle-system factory.
* Crossfades scenes, expires timed effects on a 250 ms tick, and honors
  `prefers-reduced-motion` by holding scenes still (no CSS ambience, no ambient
  actors) and cutting particle budgets.
* Owns the camera, segmentation and compositing. None of it touches the
  protocol or the event server.
* Renders no chrome by default. `?debug=1` enables a status overlay and
  `?setup=1` mounts the camera setup panel, both of which show live actor
  counts; setup can spawn a scene actor locally.

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

Scenes: `city`, `forest`, `space`, `roadside-workshop`. Drawn with inline CSS
and SVG original to the repository; no image, font or external asset.

Effects: `rain`, `snow`, `fireworks`. Canvas particle systems with per-effect
budgets scaled by intensity. `fireworks` defaults to 8000 ms; `rain` and `snow`
run until cleared.

Each effect is assigned to exactly one composition plane by `EFFECT_PLANE` in
`compositor/layers.ts`: `rain` and `snow` are foreground, `fireworks` is
background. Two `EffectsLayer` canvases filter by plane, so with the camera off
the visual result is unchanged. Effects are not scene-aware.

## Scene composition

**Stage order** is `STAGE_LAYERS` in `compositor/layers.ts`, the single source
of z-index (applied inline, not in CSS): backdrop 1, environment 2, vignette 3,
background effects 4, subject 5, foreground 6, foreground effects 7, debug 8,
setup 9. `backdrop`, `environment` and `foreground` are scene planes
(`SceneLayer`); only `foreground` is in front of the subject.

**Scene definitions** (`scenes/definition.ts`, `scenes/index.ts`): artwork
components per plane, actor spawners as data, a seed, and `maxActors`. All art
uses a 960x540 scene space mapped like `xMidYMax slice`; `.scene-frame` gives
actors the same mapping in CSS. `validateSceneDefinition` is run over every
shipped scene by the tests; `createSceneEngine` drops invalid spawners with a
warning instead of throwing.

**Actors** (`actors/`). Two behaviours only, `traverse` and `path`. Sprites
come from the `SPRITE_SIZES` allowlist. `ActorPopulation` is pure (caller
passes `now`, asks `nextDueAt()`); `ActorEngine` wraps it with one timer per
scene showing and a subscription per plane. Caps: 24 actors per scene hard
limit, per-scene `maxActors`, per-spawner `maxAlive`, min interval 500 ms,
burst up to 8. Lanes are exclusive; late wake-ups never burst. Depth within a
plane is the ground-line y, applied as z-index. `trigger(spawnerId)` spawns on
demand within caps; only the setup panel calls it. Reduced motion removes
ambient actors and stops spawning; triggered actors run at half speed.

**Rendering.** `ActorPlane` renders one element per actor and hands its whole
path to one linear Web Animation (compositor thread). Positions are
percentages of the actor's own box, so nothing is measured. React re-renders a
plane only on add/remove; there is no per-frame JavaScript for actors.

**Lifecycle.** `SceneDirector` (`scenes/director.ts`, bound by
`useSceneDirector`) owns showings. A change retires the outgoing engine (no new
spawns), keeps it for `transitionMs`, then stops it, which removes its actors.
At most two showings exist; re-showing the current scene is a no-op. Wrappers
are keyed per showing so an outgoing scene keeps its DOM. The director shares
nothing with the camera. It is started and stopped by an effect, so React
StrictMode's double mount is safe.

## Camera compositing

Renderer-local, optional, and independent of the event system in both
directions.

**Layer order**: see Scene composition. The camera canvas is the `subject`
stage layer.

**Camera lifecycle.** `camera/cameraState.ts` is a pure reducer with no browser
API; `camera/media.ts` wraps `getUserMedia`, enumeration and track shutdown;
`camera/useCamera.ts` owns the single `MediaStream`. `status`, not `mode`,
drives acquisition: the hook only calls `getUserMedia` while status is
`starting`, so a failure never becomes a retry loop. Failures classify to
`denied`, `unavailable`, `busy` (`NotReadableError`, typically another app
holding the device) or `failed`. The stream is released on stop, on device
switch, on failure and on unmount. Initial state is always `off`, so a reload
never reopens the camera.

**Modes.** `off` / `raw` / `segmented`. Raw and segmented share one stream.
Segmented deliberately draws *nothing* until a mask exists, rather than falling
back to the raw feed, which would put the operator's real background on stream
at the moment they asked for it to be removed.

**Segmentation.** `segmentation/types.ts` defines the `SubjectSegmenter`
boundary (`initialize` / `segment` / `dispose`). The only implementation is
`segmentation/mediapipe.ts`: MediaPipe Tasks Vision `ImageSegmenter` with the
SelfieSegmenter model, running mode `VIDEO`, confidence masks, GPU delegate
falling back to CPU. `segment()` returns a borrowed buffer that is reused per
call. Runtime and model are served from the renderer's own origin, never a CDN.

**Scheduler.** `segmentation/scheduler.ts` is latest-frame: a frame offered
while inference is running is dropped and counted as `skipped`, never queued. A
separate `minIntervalMs` rate limit counts `throttled`. Timestamps are forced
monotonic because MediaPipe rejects a timestamp that moves backwards. Five
consecutive failures latch the backend as failed.

**Compositing.** The mask is drawn over the camera frame with `destination-in`;
the browser's bilinear upscale feathers the edge. The mask covers the whole
frame and is drawn into the same rect as the frame, so framing changes never
invalidate a mask.

**Assets.** `public/models/selfie_segmenter.tflite` (244 KB, Apache-2.0) is
committed. The MediaPipe WASM fileset (~23 MB) is not: `vite/mediapipeAssets.ts`
serves it from `node_modules` in dev and emits it into `dist/` on build, so
`apps/renderer/dist` is ~23 MB. The MediaPipe runtime is a dynamic import, so
it is a separate 154 KB chunk that is never fetched unless segmentation runs.

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
| `apps/renderer` (Vitest) | 281 |

Coverage is concentrated on protocol validation, the state reducer on both
sides, broadcast and disconnect behaviour, WebSocket handshake and `state.sync`,
registry drift, and the camera pipeline: lifecycle, scheduler concurrency,
compositing and layer order, regressions with the camera active, and scene
composition: actor spawning, caps, lanes, cleanup, determinism, reduced motion,
director lifecycle and stage order around the subject in raw and segmented
modes. No test needs a camera, a GPU, or OBS. Media, segmentation, the canvas
and the scene clock (`FakeClock`) are faked in `apps/renderer/src/test/`.

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
* The OBS output stays clean. Diagnostics are opt-in via `?debug=1`, camera
  controls via `?setup=1`.
* Camera frames never travel over HTTP or the WebSocket. The only camera-related
  network requests are GETs to the renderer's own origin for the WASM runtime
  and the model.
* Camera state is renderer-local and is not in the event protocol.
* The camera is never opened without an explicit request, and that choice does
  not survive a reload.
* Stacking order comes only from `STAGE_LAYERS`. Scene definitions are data
  plus artwork; no event reaches them, and actors cannot run scene code.

## Limitations

* No persistence. Scene state is in memory and resets on restart.
* No authentication or authorization on the control API.
* No platform integration. The control panel and its simulation section are the
  only event sources.
* Segmentation runs on the main thread. `segmentForVideo` is synchronous, so
  inference competes with rendering. Measured ~6 ms per inference at 20/s in
  OBS without dropped frames, but a worker is the obvious next step.
* An OBS Browser Source refuses `getUserMedia` unless OBS is started with
  `--use-fake-ui-for-media-stream`, which auto-grants camera access to every
  browser source in that instance.
* Actors move linearly at constant speed; effects ignore a scene's framing
  (rain falls indoors in Roadside Workshop, fireworks draw over its walls).
* Scene composition has been exercised with synthetic camera input only; the
  built-in browser blocks camera capture and OBS was not run. A real person
  passing in front of Roadside Workshop traffic has not been seen yet.
* Mask quality has not been validated against a real person. Verified with synthetic and OBS Virtual Camera input.
* No audio, no 3D, no AI.
* Single process, single machine. No multi-operator coordination.

## Immediate direction

* Move segmentation inference into a Web Worker. The `SubjectSegmenter`
  interface already isolates the backend, so the compositor and camera
  lifecycle do not change.
* Validate Roadside Workshop and mask quality with a real camera and a real
  person, in OBS. The development machine has a camera and OBS 32; neither has
  been run against this renderer yet.
* Event-triggered scene actions through a registry-allowlisted action id that
  maps onto `ActorEngine.trigger`, without a free-form "execute" event.
* Platform adapters as separate processes that speak the existing protocol.
* Possible follow-ups for the documentation site: a `mkdocs build --strict` job
  in CI, and GitHub Pages deployment once that is in scope.
