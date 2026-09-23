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
Control Panel          Platform Adapter (separate process; simulated source)
    ↓ POST /api/events     ↓ POST /api/events (scene.action only)
Event Server
    ↓ WebSocket /ws
Renderer
    ↓
OBS Browser Source
```

The platform adapter sits upstream of the event server and sends the same
`scene.action` requests the control panel sends. No real platform is
connected.

## Repository structure

```text
apps/renderer/         React + Vite renderer; the OBS Browser Source
  src/scenes/            Scene art per plane, SCENES definitions, SceneDirector
  src/actors/            Actor vocabulary, validation, population model, engine,
                         sprite art, ActorPlane
  src/camera/            Camera lifecycle (pure reducer, media access, hook)
  src/segmentation/      SubjectSegmenter boundary, MediaPipe backend, scheduler,
                         frame/mask sync, temporal filter, edge refinement
  src/compositor/        Stage order, framing maths, draw routine, camera layer,
                         camera-frame watcher, held frames
  src/setup/             The `?setup=1` camera setup panel
  public/models/         Committed `.tflite` model plus its NOTICE
  vite/mediapipeAssets.ts  Publishes the MediaPipe WASM runtime locally
apps/control-panel/    React + Vite operator UI
services/event-server/ FastAPI event server (Python 3.13+)
services/platform-adapter/  Platform adapter (Python 3.13+, stdlib only)
packages/protocol/     Shared TypeScript protocol types, guards, registry
docs/                  MkDocs documentation site sources
mkdocs.yml             Documentation site configuration
requirements-docs.txt  Documentation tooling (MkDocs + Material)
.github/workflows/ci.yml    Python and TypeScript verification
.github/workflows/docs.yml  Strict MkDocs build; GitHub Pages deploy from main
```

npm workspaces: `packages/*` and `apps/*`. The event server and the adapter are
separate Python packages (`pip install -e "services/event-server[dev]"`,
`pip install -e "services/platform-adapter[dev]"`). The adapter's integration
tests import the event server; run the two pytest suites separately (both have
a `tests` package).

## Event flow

1. The control panel builds a request with a `@livescape/protocol` builder and
   POSTs it to `/api/events`.
2. FastAPI validates it against the Pydantic models in `models.py`. A rejection
   is a `422` and never reaches a renderer.
3. `envelope_from_request` stamps a server-owned `id` and `timestamp`.
4. `SceneState.apply` folds the envelope into in-memory state. A
   `scene.action` is transient and is not folded: before stamping it,
   `ActionGate.admit` (`actions.py`) refuses it with `409` if the current scene
   does not own it or `429` (`Retry-After`, `retryAfterMs`) inside its cooldown,
   and nothing is broadcast.
5. `ConnectionHub.broadcast` fans the envelope out to every WebSocket client
   concurrently. A failing client is dropped without affecting the others.
6. Each renderer re-validates the frame with `parseEventJson` and folds it into
   `rendererState` with a pure reducer. `scene.action` bypasses the reducer:
   `App` first brings the director up to the scene the stream last asked for
   (a scene change may not have rendered yet), then calls
   `SceneDirector.act(actionId)`.

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
| `scene.action` | client → server → renderer | `{ actionId }` (transient) |
| `state.sync` | server → renderer only | `{ sceneId, effects[] }` |

Sources: `manual`, `simulation`, `system`. Bounds: `transitionMs` 0 to 10000
(default 900), `intensity` 0.01 to 1 (default 1), `durationMs` 100 to 600000 or
`null` for "run until cleared". Unknown fields are rejected (`extra: "forbid"`)
on the server; the TypeScript parser drops them.

Durable vs transient: `scene.change` and `effect.*` are state and reach late
clients through `state.sync`. `scene.action` is never stored by the server or
the renderer, so it is never replayed; a renderer disconnected when it is
broadcast never sees it.

**Scene actions** are registry entries `{ id, sceneId, label, description,
cooldownMs }` (7 today: `roadside.send-car|send-bus|pedestrians|blow-leaves|
rush-hour`, `forest.bird-flock`, `space.shooting-star`). Parity: `SCENE_ACTION_IDS`
in `registry.ts` and the `SceneActionId` literal in `registry.py` are checked
against the JSON at import/load, including owner scene and cooldown bounds
(250 ms to 60 s).

The protocol is defined twice, once per runtime, and both are validated against
the same allowlist. `packages/protocol/registry.json` is canonical;
`services/event-server/src/livescape_event_server/registry.json` and
`services/platform-adapter/src/livescape_platform_adapter/registry.json` are
copies, and each package's `tests/test_registry.py` fails if its copy drifts. `registry.ts` throws at import
time if the JSON disagrees with the declared TypeScript unions.

Full reference: [docs/protocol.md](docs/protocol.md).

## Component responsibilities

**Renderer** (`apps/renderer`)

* Subscribes to `/ws`, re-validates every frame, and ignores anything invalid.
* Reconnects with exponential backoff and jitter, 500 ms up to 8 s, forever.
* Keeps the current scene on screen when the server disappears.
* Resolves scene ids through `SCENES`, a fixed map of scene definitions, and
  effect ids through a fixed particle-system factory. Action ids resolve
  through the owning scene definition's `actions`.
* Crossfades scenes, expires timed effects on a 250 ms tick, and honors
  `prefers-reduced-motion` by holding scenes still (no CSS ambience, no ambient
  actors) and cutting particle budgets.
* Owns the camera, segmentation and compositing. None of it touches the
  protocol or the event server.
* Renders no chrome by default. `?debug=1` enables a status overlay and
  `?setup=1` mounts the camera setup panel, both of which show live actor
  counts; setup can spawn a scene actor locally.

**Event server** (`services/event-server`)

* Validates, stamps, stores, and broadcasts. It does nothing else. For scene
  actions it also admits (scene ownership, per-action cooldown) and does not
  store. `/healthz` reports `actionCooldowns` (ms left per cooling action);
  cooldown time comes from `app.state.clock`, which tests replace.
* Endpoints: `GET /healthz`, `GET /api/registry`, `POST /api/events` (`202` on
  success), `WS /ws`.
* `/ws` is a read-only subscription. Inbound frames are drained so disconnects
  are noticed but are never interpreted as commands.
* Binds to `127.0.0.1` by default with a CORS allowlist for the two dev servers.
* State is in memory only. A restart returns to the default scene.

**Platform adapter** (`services/platform-adapter`, `python -m
livescape_platform_adapter`)

* Pipeline: `PlatformSource` (`source.py`: `connect` / `events()` /
  `disconnect` / `status`) yields `PlatformEvent | NormalizationError`
  (`events.py`) → `Adapter.offer` (`adapter.py`): malformed → duplicate
  (`dedup.py`, `(platform, event_id)`, TTL 600 s, cap 4096, remembered on
  first sight) → stale (`occurred_at` > 30 s old) → `MappingTable.resolve`
  (unmapped / below-minimum) → 429 hold for that action → server-unavailable
  back-off (1 s) → coalesce if pending or in flight → one pending slot per
  action → single worker (`asyncio.to_thread`) → `EventServerClient`.
* `PlatformEvent`: `platform`, `kind` (`gift` | `follow`), `event_id?`,
  `gift_id` (gifts), `quantity` 1..10000, `occurred_at?`. No viewer fields.
  Normalization drops everything else.
* Mappings (`mapping.py`, TOML, `default-mappings.toml` bundled): `version = 1`
  and `[[mapping]]` with exactly `platform`, `kind`, `gift`, `action`,
  `min_quantity`. Unknown keys, unknown actions (checked against the adapter's
  `registry.json` copy, drift-tested), duplicates and bad tokens fail startup
  with every problem listed.
* Client (`client.py`): loopback-only URL, no proxies, no redirects, 2 s
  timeout, 64 KiB response cap. One attempt, never retried. 202 accepted
  (validated shape), 409 wrong-scene, 422 rejected, 429 cooling-down
  (`retryAfterMs` or `Retry-After`, capped 60 s), unreachable → unavailable
  (drops everything pending), anything else server-error.
* Sends `source: "simulation"` (`AdapterEventSource`); a real platform needs a
  platform-neutral source added to the registry first.
* Status: per-decision log lines and a JSON snapshot (counters, pending,
  holds, server status, last error). In memory only; no viewer data or event
  ids.
* `SimulationSource`: own wire format (`type`/`id`/`sentAt`/`gift.count`/
  `viewer`), bounded inbox (256), deterministic scenarios (`SCENARIO_NAMES`).

**Control panel** (`apps/control-panel`)

* Scene buttons, effect triggers with intensity, and clear controls.
* A Scene actions card listing only the current scene's actions (from
  `/healthz` `currentScene` and the registry). One replaced status line for
  feedback (`sceneActions.ts`); cooling buttons stay clickable so server
  throttling can be exercised; server-reported cooldowns merge in using the
  health response's local `receivedAt`.
* A clearly labelled "simulated viewer event" section that maps a pretend gift,
  follow, or chat command onto a normalized `effect.trigger` tagged
  `source: "simulation"`. It predates the platform adapter and is a UI shortcut,
  not the adapter path; it observes no real viewer.
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
demand within caps; only the setup panel calls it. A spawner with no
`initialDelayMs`/`intervalMs` is on-demand only. Reduced motion removes
ambient actors and stops spawning; triggered actors run at half speed.
`ActorInstance.triggered` marks on-demand actors (`data-triggered` in the DOM,
counted in diagnostics).

**Scene actions** (`SceneDefinition.actions`, run by `ActorPopulation.act`):
`spawn` (first listed spawner with room) or `surge` (listed spawners on a
faster interval for `durationMs` ≤ 60 s, own schedule, ambient untouched).
Renderer outcomes: `started`, `queued` (no room; one waiting slot per action,
5 s, retried in `advance` before ambient spawns), `coalesced`, `cooldown`
(registry cooldown minus 250 ms jitter allowance), `reduced-motion` (surges
refused; spawns at half speed, burst ≤ 2), `inactive`, `unsupported`, plus
`wrong-scene` from the director. Waiting and surges are in `nextDueAt`, so
still one timer per scene; `retire`/`stop`/reduced motion cancel them. The
director only routes to the current showing, never to one fading out, and
records `lastAction` for diagnostics.

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

**Scheduler.** `segmentation/scheduler.ts`: one inference at a time, never a
queue. `submit` takes a capture callback that only runs when an inference
actually starts; each start gets a `sequence` returned with the mask
(`onMask(mask, {sequence,...})`, `onDrop(sequence)` for null/error). The
interval between starts is `max(minIntervalMs, costMs / maxDutyCycle)`, where
`costMs` is the smoothed inference-plus-`onMask` time, so a slow machine lowers
the subject rate instead of the page rate. Declines count as `skipped` (busy)
or `throttled`. Timestamps are forced monotonic. Five consecutive failures
latch the backend as failed.

**Frame/mask sync.** In segmented mode the subject layer never draws the live
video. `CameraLayer` submits only when `VideoFrameWatcher`
(`requestVideoFrameCallback`) reports an unsegmented camera frame; the frame
stays pending (not consumed) until an inference starts on it. The capture holds
the frame (`compositor/heldFrame.ts`: a `VideoFrame`, or a copy into one of two
spare canvases without WebCodecs), scales the segmenter input *from the held
frame*, and `FrameMaskSync` (`segmentation/sync.ts`) shows that frame only when
its own mask resolves. At most two frames are held; every one is released
(`VideoFrame.close()`) exactly once. Results for a frame no longer waiting are
counted `stale`. With the synchronous MediaPipe backend `onMask` draws
immediately, so the pair lands in the same animation frame. The subject
canvas is redrawn only when the pair, camera state, view or size changes.

**Matte** (`segmentation/mask.ts`, `MaskCanvas.update`): confidence →
`TemporalMatteFilter` (per-pixel weight falls from `smoothing` to 0 as the
change grows from 0.08 to 0.35, so motion passes in one frame) →
`GuidedMatteRefiner` (fast guided filter on luma of the segmenter input, read
with `getImageData`; coefficients at half resolution) → smoothstep ramp with
`HYSTERESIS` 0.04 towards each pixel's previous state → alpha canvas. History is
one frame deep and dropped on reset or size change.

**Quality presets** (`segmentation/quality.ts`): input 256/320/384, min
interval 45/20/16 ms, duty cycle 0.5/0.8/0.9, refine radius 0/1/2 for
Performance/Balanced/Quality. The model is 256×256 regardless; MediaPipe
returns the mask at the input size.

**Compositing.** The matte is drawn over the held frame with `destination-in`
(bilinear upscale; `imageSmoothingQuality = "high"` measured catastrophically
slow and is not used). The matte covers the whole frame and shares its rect,
so framing never invalidates a mask. `view: 'matte'` draws the matte on black;
`App` only passes it while `?setup=1` is mounted.

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
| `LIVESCAPE_EVENT_SERVER_URL` | `http://127.0.0.1:8765` (adapter; loopback only) |
| `LIVESCAPE_ADAPTER_MAPPINGS` | bundled demonstration mappings (adapter) |

Every value is also the built-in default, so no `.env` file is required.

## Tests

| Suite | Count |
| --- | --- |
| `services/event-server/tests` (pytest) | 78 |
| `services/platform-adapter/tests` (pytest) | 181 |
| `packages/protocol` (Vitest) | 45 |
| `apps/control-panel` (Vitest) | 31 |
| `apps/renderer` (Vitest) | 402 |

Coverage is concentrated on protocol validation, the state reducer on both
sides, broadcast and disconnect behaviour, WebSocket handshake and `state.sync`,
registry drift, and the camera pipeline: lifecycle, scheduler concurrency and
duty cycle, frame/mask synchronisation, temporal filter, edge refinement,
compositing and layer order, regressions with the camera active, and scene
composition: actor spawning, caps, lanes, cleanup, determinism, reduced motion,
director lifecycle and stage order around the subject in raw and segmented
modes, and scene actions: allowlist and parity, ownership, planes, cooldowns,
50-request bursts on the server and in the renderer, cleanup on scene change,
reduced motion, and no replay on reconnect. No test needs a camera, a GPU, or OBS. Media, segmentation, the canvas
and the scene clock (`FakeClock`) are faked in `apps/renderer/src/test/`.

Verification commands:

```bash
python -m ruff check services/event-server
python -m ruff format --check services/event-server
python -m pytest services/event-server
python -m ruff check services/platform-adapter
python -m ruff format --check services/platform-adapter
python -m pytest services/platform-adapter
npm run lint && npm run typecheck && npm test && npm run build
mkdocs build --strict
```

CI runs the Python and TypeScript commands on every push and pull request.

## Documentation site

`docs.yml` runs `mkdocs build --strict` on pull requests and pushes to `main`
that touch `docs/`, `mkdocs.yml`, `requirements-docs.txt` or the workflow. Only
`main` uploads a Pages artifact and deploys it (native Pages artifact flow, no
`gh-pages` branch); the deploy job alone holds `pages: write` and
`id-token: write`, and the `github-pages` environment only accepts `main`.
Published at `https://quangshuynh.github.io/livescape/` (`site_url`), so every
generated URL is under `/livescape/`. `validation:` in `mkdocs.yml` turns broken
anchors and pages missing from `nav` into strict-mode failures. The `privacy`
plugin self-hosts Google Fonts and Mermaid at build time; the site loads no
third-party scripts. Header logo and favicon are small derivatives of
`docs/images/livescape-logo.png`.

## Invariants

* The renderer never learns about a platform. Adapters normalize upstream.
* The adapter has no privileges beyond the control panel's: ordinary
  `scene.action` over loopback HTTP. Mappings can only name allowlisted
  actions; normalized events carry no viewer data; nothing is persisted,
  retried or replayed, and adapter memory is bounded regardless of event rate.
  Adapter counts are visual, never a ledger.
* Scene, effect and action ids resolve through the registry allowlist on both
  sides.
* Payloads carry no code, paths, URLs, or prompts, and there is no generic
  "execute action" event. A scene action is an id only; it selects a
  capability the scene already implements.
* Scene actions are transient: never in server state, `state.sync` or renderer
  state. Ownership and cooldown are enforced by the server and again by the
  renderer; everything an action spawns stays inside actor caps.
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
* No real platform integration. The adapter's only source is the simulator.
  Events without a platform id cannot be deduplicated. Dedup does not survive
  an adapter restart.
* Scene actions take no parameters and are one-shot or timed; City has none.
  The renderer's cooldown and waiting state is per showing, so returning to a
  scene resets it (the server's cooldown still applies).
* Segmentation runs on the main thread. `segmentForVideo` is synchronous, so
  inference competes with rendering. Measured ~17 ms per mask (mostly GPU
  readback) plus ~3 ms matte processing at 30/s on an Apple M1 in headless
  Brave with page render held at 60; a worker is the obvious next step.
* The subject is shown ~one inference late and moves at the segmentation rate.
* An OBS Browser Source refuses `getUserMedia` unless OBS is started with
  `--use-fake-ui-for-media-stream` (validated on macOS together with
  `--enable-media-stream`; OBS also needs the macOS Camera permission), which
  auto-grants camera access to every browser source in that instance.
* Actors move linearly at constant speed; effects ignore a scene's framing
  (rain falls indoors in Roadside Workshop, fireworks draw over its walls).
* Validated with a physical camera and a real person in Brave and in an OBS
  Browser Source on macOS (flags above plus the macOS Camera permission): Raw,
  Segmented, scene switching, Roadside Workshop, and scene actions through the
  event server (Send Bus behind, Blow Leaves in front of the subject).
  Frame/mask sync clearly reduced motion leakage; low light degrades the matte
  substantially; hair and thin fingers remain difficult (a finger can vanish
  or a gap fill). Performance was measured with Chromium's synthetic camera.
* Edge refinement is luminance-guided only.
* No audio, no 3D, no AI.
* Single process, single machine. No multi-operator coordination.

## Immediate direction

* Move segmentation inference into a Web Worker. The `SubjectSegmenter`
  interface already isolates the backend, so the compositor and camera
  lifecycle do not change.
* Re-measure segmentation cost inside OBS.
* A first real platform source, chosen by what official platform APIs actually
  expose in real time (TikTok's public developer docs list no LIVE event API),
  plus a platform-neutral protocol `source` for its traffic.
