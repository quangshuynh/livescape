# Architecture

LiveScape is a pipeline with one narrow waist. Every event, whatever produced
it, is normalized into a versioned envelope before anything downstream sees it.

```text
event source
  → normalized LiveScape event
  → FastAPI event server
  → WebSocket
  → renderer
  → OBS Browser Source
```

```mermaid
flowchart LR
    subgraph future["Future: platform adapters (not implemented)"]
        platform["Livestream platform events"] --> adapter["Platform adapter"]
    end

    panel["Control panel<br/>(React + Vite)"] -->|POST /api/events| server
    adapter -.->|normalized event| server

    server["Event server<br/>(FastAPI + Pydantic)"] -->|WebSocket /ws| renderer
    server -->|WebSocket /ws| panel

    renderer["Renderer<br/>(React + Vite)"] --> obs["OBS Browser Source"]
    obs --> stream["Livestream"]
```

## Components

### Renderer

The renderer is the product. It subscribes to the event server, re-validates
every frame it receives, and folds valid events into state with a pure reducer.
It resolves scene ids through a fixed map of scene definitions and effect ids
through a fixed particle-system factory, so an id that is not in the registry
cannot reach anything that draws.

It renders no chrome by default, which is what makes it safe to point OBS at.
Diagnostics are opt-in through `?debug=1`.

### Event server

The event server validates, stamps, stores and broadcasts. That is the whole
job. It assigns `id` and `timestamp` so identity and ordering are decided in
exactly one place, keeps a small in-memory record of the current scene and
active effects, and fans each accepted envelope out to every connected client.

Scene actions are transient: the server checks that the current scene owns the
action and that it is outside its cooldown, then broadcasts it without storing
it. See [Scene Actions](scene-actions.md).

It never interprets a payload as code, a path, a URL or a prompt.

### Control panel

The operator UI. It is an event source like any other: it builds requests with
the shared protocol builders and POSTs them. It also subscribes to the same
WebSocket for a live activity feed, which means it sees exactly what the
renderer sees.

### Protocol package

`@livescape/protocol` holds the TypeScript types, type guards, request builders
and the canonical registry. The Python side defines the same protocol
independently with Pydantic. Both are validated against the same allowlist, and
a test fails if the two registry copies drift apart.

## Why it is shaped this way

**Local-first.** Everything binds to `127.0.0.1` and no internet connection is
required. A stream should not go dark because a remote service did.

**Platform independence.** The renderer knows nothing about any livestream
platform. An adapter's only job is to translate an external event into a
LiveScape envelope. That keeps platform churn at the edge, where it belongs.

**Resilience.** External failures must not break the renderer. When the event
server, the network or an optional integration disappears, whatever is on
screen stays on screen, and the renderer reconnects with exponential backoff
and jitter. When it reconnects, a `state.sync` envelope tells it what is
currently live instead of snapping back to the default scene.

**Explicitness.** Scene, effect and action ids resolve through an allowlist
registry on both sides. There is no generic "execute action" event, and
payloads never carry code. An event is a small, bounded, enumerated
instruction; a scene action selects a predefined capability and cannot
describe a new one.

**Optionality.** AI is an enhancement, never a dependency. Integrations are
optional. Core rendering must keep working with none of them configured.

## The camera boundary

Camera and video processing belong in the renderer. Camera frames never travel
over HTTP or the WebSocket: the event channel carries small control messages
only, and sending video through it would be both a privacy problem and a
latency problem.

Camera compositing extends the renderer rather than the pipeline above it:

```text
Camera
    ↓
Local segmentation
    ↓
Renderer compositor
    ↑
LiveScape scene/effects
    ↓
OBS
```

The camera system and the event system are independent in both directions.
Losing the event server does not disturb the camera; a camera or segmentation
failure does not disturb the scene. Camera state is renderer-local and is not
part of the event protocol, so the event server has no idea whether a camera
exists.

### Composition planes

The compositor draws back to front, with the camera subject as the boundary
between what a scene puts behind a person and what it puts in front:

```text
backdrop            scene: the far world and its actors
environment         scene: the near set around the subject and its actors
vignette            scene framing
background effects  effects that belong behind the subject
camera subject      the local camera feed, raw or segmented
foreground          scene: artwork and actors in front of the subject
foreground effects  effects in front of everything in the scene
debug / setup       local only, never in the OBS output
```

Scenes are declarative: artwork per plane, plus actor spawners described as
data and run by one shared engine. A scene director owns the scenes on stage
and their crossfades, and shares no state with the camera, so a scene change
never touches the camera. See [Scenes and Effects](scenes-and-effects.md#composition).

Segmentation sits behind a small renderer-local `SubjectSegmenter` interface,
so the compositor and the camera lifecycle do not depend on any particular ML
runtime.

See [Camera and Compositing](camera.md) for the full picture, and
[Security and Privacy](security.md) for the rules this boundary enforces.
