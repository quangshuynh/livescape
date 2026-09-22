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

CI runs exactly these commands on every push and pull request. Build the
documentation locally when you change it:

```bash
mkdocs build --strict
```

## Suite composition

| Suite | Tests | Focus |
| --- | --- | --- |
| `services/event-server/tests` | 51 | Protocol validation, state folding and expiry, broadcast and client dropping, WebSocket handshake and `state.sync`, health, registry drift |
| `packages/protocol` | 23 | Envelope parsing, bounds, defaults, request builders |
| `apps/renderer` | 35 | Reducer transitions, reconnect backoff, effect particle budgets, rendering and the debug overlay |
| `apps/control-panel` | 20 | Request building, rejection handling, simulated-action mapping, UI behaviour |

Python tests use pytest with `filterwarnings = ["error"]`, so a new warning
from our own code fails the suite.

TypeScript tests use Vitest with jsdom. WebSocket behaviour is tested against a
fake socket (`src/test/fakeWebSocket.ts` in each app) rather than a live
server, which keeps reconnect timing deterministic.

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
