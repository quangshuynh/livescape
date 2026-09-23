# Security and Privacy

LiveScape sits between a camera, a livestream and an event source. The rules
below are properties of the design, not conventions, and they are meant to
survive every future feature.

## Local-first by default

The event server binds to `127.0.0.1` and requires no internet connection. The
control API is **unauthenticated**, which is acceptable precisely because it is
loopback-only.

!!! warning "Do not expose the event server"

    Anyone who can reach `POST /api/events` can change what is on your stream.
    Do not bind it to `0.0.0.0` or forward the port to a network you do not
    control. If remote control is ever needed, it needs authentication first.

## Events cannot execute anything

* Scene, effect and action ids resolve through an explicit allowlist registry
  on both the Python and the TypeScript side. The renderer looks scenes up in a
  fixed component map, effects up in a fixed factory and actions up in the
  owning scene's definition, so an unknown id cannot reach anything that draws.
* A scene action is only an id. It cannot carry JavaScript, URLs, file or asset
  paths, CSS, selectors, HTML, shell commands, prompts or actor definitions,
  and the event server refuses any extra field. An external source can select
  one of the renderer's existing capabilities, never add one.
* Actions are rate-bounded: each has a registry cooldown enforced by the event
  server and again by the renderer, and everything an action spawns stays
  inside the scene's actor caps. A burst of requests costs at most one
  broadcast per action per cooldown. See
  [Scene Actions](scene-actions.md#cooldowns-and-bursts).
* Payloads never carry code, shell commands, file paths, URLs or prompts, and
  there is no generic "execute action" event.
* Unknown fields are rejected outright (`extra: "forbid"`).
* The WebSocket is a read-only subscription. Inbound frames are drained so
  disconnects are noticed, but they are never interpreted as commands.
* Anything that fails validation is dropped before broadcast, and the renderer
  independently re-validates every frame it receives.

## Camera and media

* Camera frames never leave the renderer tab. They are not sent over HTTP or
  the WebSocket, and the event channel carries small control messages only.
* No camera uploads, to anywhere, for any reason. Segmentation runs locally, in
  the same tab, against a model served from the renderer's own origin.
* No hidden recording, screenshots or frame persistence. Anything that writes a
  frame to disk must be an explicit, visible user action.
* The camera is only ever opened by an explicit request, and that choice is not
  remembered. Reloading the renderer always comes back with the camera off.
* Camera state is renderer-local. It is not in the event protocol, so it never
  reaches the event server or the control panel.

The only camera-related network requests are HTTP GETs to the renderer's own
origin for the WASM runtime and the `.tflite` model. Those are static file
downloads, not video transmission. [Camera and Compositing](camera.md) states
the boundary precisely and records how it was verified.

!!! warning "Allowing the camera inside OBS has a cost"

    An OBS Browser Source refuses `getUserMedia` by default. The tested way to
    allow it is to start OBS with `--use-fake-ui-for-media-stream` (on macOS,
    together with `--enable-media-stream`), which auto-accepts camera and
    microphone requests for **every** Browser Source in that instance, with no
    prompt. Only do that if you trust every Browser
    Source URL in your scene collection.

## Data and telemetry

* No analytics and no telemetry. If that ever changes, it will be an explicit,
  documented, opt-in decision rather than a quiet addition.
* No secrets in the repository. Configuration comes from the environment, and
  the `.env.example` files contain defaults only, never credentials.
* No persistence. Scene state lives in memory and is lost on restart, so there
  is nothing on disk to leak.

## Third-party content

Scenes, actors and effects are drawn with CSS, SVG and Canvas. All artwork is
original to the repository and inline: there is no third-party artwork, no
image or font file, and no external asset fetch at runtime, so nothing
unexpected can appear on a live stream. Scene definitions are typed data: a
scene cannot run code per actor, and events cannot reach scene definitions at
all; a scene action can only select an action the definition already
implements.

## Platform integrations

No livestream platform is connected. The control panel's simulated viewer
events and the platform adapter's simulator are development stand-ins,
labelled as such, and they observe no real viewer.

The [platform adapter](platform-adapters.md) is the boundary real integrations
will use, and it is designed around these rules:

* It is a separate, optional process with no privileges the control panel
  lacks. It submits ordinary `scene.action` requests over loopback HTTP, and
  refuses to start if pointed at a non-loopback server. It ignores proxy
  settings and does not follow redirects.
* Its mapping file can only name allowlisted scene actions. It cannot contain
  code, commands, URLs, paths, prompts, markup or actor definitions; unknown
  keys stop the adapter at startup.
* Normalized platform events carry no viewer data. Names, profiles, avatars and
  every other identifying field are dropped at the edge, and nothing is
  persisted: no viewer database, no event log, no analytics.
* Bursts and outages cannot build a backlog. Memory is bounded, requests are
  never retried, and stale or redelivered events are dropped.
* Its counts describe visual behaviour and are not an accounting of gifts or
  money.

Real integrations will use official and documented platform APIs only, with no
scraping and no unofficial clients, and platform credentials will come from the
operator's environment, never the repository. An adapter failing never breaks
the renderer: the scene on screen is unaffected.

The adapter adds no new listener, so the local trust model is unchanged: any
local process could already POST to the loopback event server, and the adapter
is one such process.

## Reporting a problem

Open an issue at
[github.com/quangshuynh/livescape/issues](https://github.com/quangshuynh/livescape/issues).
For anything that looks exploitable, describe the impact without publishing a
working exploit.
