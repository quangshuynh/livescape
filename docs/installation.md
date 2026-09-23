# Installation

LiveScape runs entirely on your own machine. Nothing here needs an internet
connection once the dependencies are installed.

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js 20.19+ | Developed on 24. npm workspaces are the only JavaScript package manager used here; do not mix in pnpm or yarn. |
| Python 3.13+ | Developed on 3.14. |
| OBS Studio | Optional. Only needed when you want the renderer on a stream. |

## Clone and install the JavaScript workspace

```bash
git clone https://github.com/quangshuynh/livescape.git
cd livescape
npm install
```

One `npm install` at the root covers the renderer, the control panel and the
shared protocol package.

## Install the event server

Create a virtual environment:

```bash
python -m venv .venv
```

Activate it (`.venv\Scripts\activate` on Windows, `source .venv/bin/activate`
elsewhere), then install the package in editable mode with its development
extras:

```bash
python -m pip install -e "services/event-server[dev]"
```

That pulls in FastAPI, Pydantic, uvicorn and websockets, plus pytest and Ruff.

## Optional: the platform adapter

The [platform adapter](platform-adapters.md) has no runtime dependencies beyond
the standard library:

```bash
python -m pip install -e "services/platform-adapter[dev]"
```

## Optional: documentation tooling

Only needed if you want to build this site locally:

```bash
python -m pip install -r requirements-docs.txt
```

## Verify the installation

```bash
python -m pytest services/event-server
python -m pytest services/platform-adapter
npm test
```

Both suites should pass without a camera, a GPU or OBS. See
[Testing](testing.md) for the full verification set.

Next: [Quick Start](quick-start.md).
