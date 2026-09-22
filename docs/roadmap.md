# Roadmap

Everything on this page is future work. Nothing here is implemented. For what
exists today, see the [home page](index.md) and
[Scenes and Effects](scenes-and-effects.md).

## Current limitations

| Limitation | Detail |
| --- | --- |
| No persistence | Scene state lives in memory. Restart the event server and it comes back on the default scene. |
| No authentication | The control API is unauthenticated and intended for loopback use only. |
| No platform integration | The control panel and its simulation section are the only event sources. |
| No camera compositing | The renderer draws a background environment. It does not yet composite a camera feed or separate a subject from it. |
| No audio, no 3D, no AI | Effects are lightweight 2D Canvas particle systems. |
| Single process, single machine | No multi-operator coordination, no remote control, no deployment story. |

## Planned

**Camera compositing and subject segmentation**, so a scene can render behind
and in front of the person on camera. This extends the renderer. Frames stay in
the renderer process and never touch the event server; see
[Architecture](architecture.md#the-camera-boundary).

**Platform adapters** that translate real livestream events into the existing
protocol, using official and compliant APIs only. They run as separate optional
processes. The renderer will not learn anything about them.

**Viewer gift and event integrations** where they are officially available.

**More scenes and effects**, and a richer effect-composition model.

**Three.js environments** for scenes that genuinely need 3D.

**Optional AI-assisted scene generation** as an enhancement, never a
dependency. The renderer must keep working with no AI provider configured.

**Remote video ingest** and connection-quality handling.

**Persistence and multi-operator support** if a real deployment needs them.

## Constraints that will not change

Whatever gets built, these hold:

* Local-first operation, with no required internet connection.
* A platform-independent internal event protocol.
* A renderer that knows nothing about any livestream platform.
* Optional integrations and optional AI. Core rendering works without both.
* External failures that never break the renderer.
* Camera frames that never travel over HTTP or the WebSocket.
* Explicit registries instead of free-form identifiers, and payloads that can
  never become code execution.
* Clean OBS output, with diagnostics kept opt-in.
