# LiveScape

Local-first interactive scene engine for livestreams. LiveScape draws a dynamic
environment, reacts to events in real time, and is designed to be dropped into
OBS as a Browser Source.

Stream overlays are usually either static images or a pile of platform-specific
scripts glued to one service's API. LiveScape splits those two concerns apart:

* a **renderer** that knows how to draw scenes and effects, and nothing else;
* an **event protocol** that any source can speak, whether that is an operator
  pressing a button today or a platform adapter tomorrow.

The renderer has no idea what TikTok is, and never will. Platform adapters
translate external events into normalized LiveScape events, and everything
below that boundary stays the same.

## What it does today

```text
control panel → FastAPI event server → WebSocket → renderer → OBS
```

* Three scenes (city, forest, space) and three effects (rain, snow, fireworks),
  drawn with CSS, SVG and Canvas, with no third-party artwork.
* A versioned, typed, validated [event protocol](protocol.md) backed by an
  allowlist registry.
* A local FastAPI [event server](api.md) with health, registry and event
  endpoints, plus WebSocket broadcast.
* An operator control panel, including a clearly labelled simulated
  viewer-event section that demonstrates the adapter boundary.
* Reconnect handling: the renderer keeps rendering when the server goes away,
  and re-syncs when it comes back.

No livestream platform integration, AI, camera compositing, audio, persistence
or authentication exists yet. See the [roadmap](roadmap.md).

## Where to start

<div class="grid cards" markdown>

* :material-download: **[Installation](installation.md)** sets up Node, Python
  and the workspace.
* :material-play: **[Quick Start](quick-start.md)** gets the pipeline running
  and sends the first event.
* :material-video: **[OBS Setup](obs.md)** adds the renderer as a Browser
  Source.
* :material-sitemap: **[Architecture](architecture.md)** explains the
  boundaries and why they exist.

</div>

## License

MIT. See [LICENSE](https://github.com/quangshuynh/livescape/blob/main/LICENSE).
