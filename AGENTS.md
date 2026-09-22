# AGENTS.md

Engineering contract for agents working in LiveScape. These rules are durable:
they should still hold several features from now. Read this file at the start
of every task, then read [CONTEXT.md](CONTEXT.md) for the current state of the
repository.

## Project identity

LiveScape is a local-first interactive scene engine for livestreams. It draws a
dynamic environment that reacts to events in real time and is designed to be
dropped into OBS as a Browser Source.

Core architecture:

```text
event source
  → normalized LiveScape event
  → FastAPI event server
  → WebSocket
  → renderer
  → OBS Browser Source
```

Camera and video processing belong in the renderer. They must not pass through
the FastAPI event server.

## Architectural boundaries

Preserve these principles unless there is concrete evidence that one of them is
wrong:

* Local-first operation. Everything runs on the operator's machine and needs no
  internet connection.
* The internal event protocol is platform-independent.
* The renderer does not know about TikTok, YouTube, or any other platform.
* External integrations translate their own events into LiveScape events.
* Optional integrations must not be required for core rendering.
* AI must remain optional. The renderer works with no AI provider configured.
* External failures must not break the renderer. It keeps showing the current
  scene when the server, the network, or an integration disappears.
* Camera frames must never be sent through the event server or the WebSocket.
  The event channel carries small control messages only.
* Scene and effect identifiers resolve through explicit registries or
  allowlists, on both the Python and the TypeScript side.
* Event payloads must never become arbitrary code execution. No shell commands,
  file paths, URLs, prompts, or generic "execute action" events.
* Clean OBS output stays separate from development diagnostics. The renderer
  shows no chrome by default; diagnostics are opt-in.

## Current stack

* TypeScript (strict), React, Vite for the renderer and the control panel.
* Vitest for TypeScript tests, ESLint for linting.
* Python 3.13+, FastAPI, Pydantic v2, uvicorn, and websockets for the event
  server.
* pytest for Python tests, Ruff for linting and formatting.
* npm workspaces for the monorepo. Do not introduce pnpm or yarn.
* MkDocs with Material for MkDocs for the documentation site.

Add a dependency only when it earns its place. Prefer the standard library and
what is already here.

## Testing rules

* Existing tests must stay green. Run the relevant suites before committing.
* New behavior needs meaningful tests, not tests that restate the
  implementation.
* CI must remain hardware-independent. It runs on GitHub-hosted Linux runners
  with no camera, no GPU, and no OBS.
* Mock camera and media APIs in tests. `getUserMedia`, canvas capture, and
  segmentation backends are all faked in CI.
* Claim that something works on real hardware only if real hardware was
  actually tested.
* Claim OBS compatibility only if OBS was actually tested.

## Security and privacy

* The event server binds to loopback by default and is unauthenticated. It is
  not designed for exposure to an untrusted network.
* No arbitrary execution from events, ever.
* No secrets in the repository. Configuration comes from the environment, and
  `.env.example` files hold defaults only.
* No camera uploads. Camera frames stay in the renderer process.
* No analytics or telemetry unless it is explicitly approved later.
* No hidden recording, screenshots, or frame persistence. Anything that writes
  a frame to disk must be an explicit, visible user action.

## Git rules

You may:

* inspect the repository and its history, and fetch remote state;
* create and switch feature branches;
* commit changes;
* push feature branches;
* run tests, linting, formatting, builds, and other verification.

Never do any of the following automatically:

* push to `main`;
* merge anything, including pull requests;
* force-push;
* rewrite published history;
* create tags or releases;
* delete remote branches;
* modify repository secrets.

Branch naming follows `feat/<feature>`, `fix/<bug>`, `docs/<topic>`, or
`chore/<task>`. Commit messages use Conventional Commits, for example
`feat(renderer): composite the camera feed`.

## Repository prose

Write concise, professional prose. Prefer ordinary sentence structure using
commas, periods, colons, parentheses, and semicolons. An occasional em dash is
fine when it genuinely improves a sentence, but it should be uncommon. Do not
run repository-wide punctuation rewrites that are unrelated to the task at
hand.

## Documentation philosophy

Documentation describes the system as it is now. It is not a development
journal.

Do not write sections such as "Interval 3 changes", "What Interval 4 added", or
"Interval 5 implementation". The history of how the repository was built
belongs in Git history, pull requests, and releases. Document the resulting
capability instead: camera compositing, the event protocol, OBS setup,
architecture, platform adapters.

* `README.md` is an approachable landing page: what LiveScape is, what it does
  today, how to run it, and where the details live.
* `docs/` holds the detailed technical documentation and is published with
  MkDocs.
* `CONTEXT.md` is the compact technical handoff for agents.
* Keep roadmap items clearly marked as future work. Never present planned
  functionality as if it already exists.
