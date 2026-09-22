# Testing

Every suite runs without a camera, a GPU or OBS. That is a hard requirement:
CI runs on GitHub-hosted Linux runners, and a test that needs hardware is a
test that cannot be trusted.

## Running everything

```bash
# Python: lint, format check, tests
python -m ruff check services/event-server
python -m ruff format --check services/event-server
python -m pytest services/event-server

# TypeScript: lint, typecheck, tests, production build
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs exactly these commands on every push and pull request.

## Documentation

```bash
python -m pip install -r requirements-docs.txt
mkdocs build --strict
```

The `Docs` workflow runs the same strict build on every pull request that
touches `docs/`, `mkdocs.yml` or `requirements-docs.txt`, and fails on any
warning, including a broken internal link. On `main` it also publishes the
result to GitHub Pages. See [Documentation Site](documentation-site.md).

## Suite composition

| Suite | Tests | Focus |
| --- | --- | --- |
| `services/event-server/tests` | 51 | Protocol validation, state folding and expiry, broadcast and client dropping, WebSocket handshake and `state.sync`, health, registry drift |
| `packages/protocol` | 23 | Envelope parsing, bounds, defaults, request builders |
| `apps/renderer` | 355 | Reducer transitions, reconnect backoff, effect particle budgets, camera lifecycle, segmentation scheduling, frame/mask synchronisation, temporal filtering and edge refinement, compositing, scene composition and actors, and rendering |
| `apps/control-panel` | 20 | Request building, rejection handling, simulated-action mapping, UI behaviour |

Python tests use pytest with `filterwarnings = ["error"]`, so a new warning
from our own code fails the suite.

TypeScript tests use Vitest with jsdom. WebSocket behaviour is tested against a
fake socket (`src/test/fakeWebSocket.ts` in each app) rather than a live
server, which keeps reconnect timing deterministic.

## Testing the camera without a camera

The renderer's camera and segmentation code is the largest part of the suite,
and none of it touches real hardware. Four fakes carry it:

| Fake | Stands in for |
| --- | --- |
| `src/test/fakeMedia.ts` | `navigator.mediaDevices`, `MediaStream` and `MediaStreamTrack`. Records every stream it hands out, so a leaked track is an assertion rather than a guess. |
| `src/test/fakeSegmenter.ts` | A `SubjectSegmenter` whose inference the test completes by hand, which is what makes the scheduler's concurrency rules observable. |
| `src/test/fakeCanvas.ts` | A recording 2D context and a manual animation clock, so the compositor's real loop runs and its draw calls can be asserted on. |
| `vi.mock('@mediapipe/tasks-vision')` | The ML runtime, for the delegate-fallback and mask-extraction tests. |

That covers the lifecycle (explicit acquisition, permission denial, unavailable
and busy devices, enumeration, switching, stopping, track shutdown, unmount
cleanup), the scheduler (single-flight inference, no unbounded queue, stale
frames dropped, failure tolerance, disposal), the compositor (each mode, layer
ordering, the segmentation-failure fallback, framing) and regressions (scenes,
effects, disconnect and reconnect, and invalid events, all while the camera is
running).

## What a good test looks like here

* It tests behaviour, not implementation shape. The reducer tests assert what
  ends up on screen, not which branch ran.
* It covers the rejection path. Most protocol bugs are about what should
  **not** be accepted.
* It stays deterministic. Particle systems take an injectable random source,
  and timing-sensitive code takes an explicit `now`.
* It does not need hardware. Camera and media APIs get mocked, not
  exercised.

## Claims

Two claims require actual verification before they are written down anywhere:

* **Real-device behaviour.** Only state that something works on real hardware
  if real hardware was tested.
* **OBS compatibility.** Only state that something works in OBS if OBS was
  tested. Nothing in the test suite exercises OBS.

Those are separate levels of evidence, and the documentation keeps them
separate. What has been verified for the camera pipeline, and what has not, is
recorded in [Camera and Compositing](camera.md). Matte quality is a visual
property and is not asserted by the test suite; the tests cover the
properties the matte pipeline guarantees (filter state, synchronisation,
bounded history, scheduling), and visual quality is judged manually.
