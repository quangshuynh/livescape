# Camera and Compositing

LiveScape can put you inside one of its scenes. The renderer opens your camera,
separates you from your physical background locally, and composites the result
between the parts of the scene behind you and the parts in front of you.

```text
Camera
  → getUserMedia
  → local subject segmentation
  → compositor
      ├─ LiveScape scene
      ├─ camera subject
      └─ LiveScape effects
  → renderer
  → OBS Browser Source
```

Everything on that path happens inside the renderer tab. Camera frames are
never sent to the event server, over the WebSocket, or to any network service.

Camera support is entirely optional. With the camera off, the renderer behaves
exactly as it does without this feature, and costs nothing extra.

## Opening the setup panel

Camera controls must never appear in your OBS output, but the camera
permission belongs to the renderer's own origin. So the controls live in the
renderer, behind a query parameter:

```text
http://127.0.0.1:5173/?setup=1
```

Add `&debug=1` as well if you want the diagnostics overlay.

Your OBS Browser Source stays on the bare URL, with no `?setup=1`.

!!! note "Each tab owns its own camera"

    A browser tab, and an OBS Browser Source, are separate pages. Opening
    `?setup=1` in a second tab configures *that* tab's camera, not the one OBS
    has open. To composite the camera into your stream, the camera has to be
    started in the page OBS is showing. See
    [Using the camera inside OBS](#using-the-camera-inside-obs).

## Camera modes

| Mode | What it does |
| --- | --- |
| **Off** | No camera is opened and no camera work runs. This is the state on every load. |
| **Raw** | The camera is shown as the device sends it, with your real background. |
| **Segmented** | Only the locally extracted subject is drawn, over the LiveScape scene. |

The camera is never opened until you choose Raw or Segmented, and that choice
is not remembered. Reloading the renderer, or refreshing the OBS Browser
Source, always comes back with the camera off.

Switching between Raw and Segmented reuses the open stream, so it does not
re-prompt or re-acquire the device.

!!! warning "Segmented mode does not fall back to Raw on its own"

    If segmentation has not produced a mask yet, or has failed, Segmented mode
    draws **nothing** rather than showing the unmasked camera. Quietly falling
    back to Raw would put your real room on stream at exactly the moment you
    asked for it to be removed. Switch to Raw yourself if that is what you
    want.

## Permission behaviour

The renderer reports what actually happened, because the fixes are different:

| State | Meaning | What to do |
| --- | --- | --- |
| **Permission blocked** | The browser or OS refused. | Allow the camera for this origin, then use **Try again**. |
| **No camera available** | Nothing matched, or the selected device is gone. | Reconnect the camera, refresh the list, pick a device. |
| **Camera in use elsewhere** | The device exists but something else holds it open. | Close the other application. On a streaming machine this is usually an OBS **Video Capture Device** source on the same webcam. |
| **Camera failed** | Anything else. | The reported message is the browser's. |

A failure never retries on a loop, and never disturbs the scene: the event
stream, the current scene and any running effects carry on untouched.

## Device selection

Device names are only available after the camera has been allowed at least
once. Before that, browsers report cameras with empty labels, and the panel
says so rather than showing blanks.

Picking a different camera stops the previous stream's tracks before opening
the new one, so two streams are never live at the same time. The same applies
when you stop the camera, when acquisition fails, and when the renderer
unmounts.

## Framing

| Control | Default | Notes |
| --- | --- | --- |
| Mirror | on | Self-view convention. Mirrors around the frame's own centre, so it never shifts your framing. |
| Cover / contain | cover | Cover fills the stage and crops; contain fits the whole frame inside it. |
| Subject scale | 100% | 25% to 250% of the fitted size. |
| Horizontal position | centre | Offset as a fraction of the stage width. |
| Vertical position | centre | Offset as a fraction of the stage height. |

Framing is applied when the frame is drawn, not when it is segmented. The mask
covers the whole camera frame and is drawn into the same rectangle, so moving
or scaling yourself never needs another inference and never misaligns the edge.

## Segmentation technology

LiveScape uses **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`) running
Google's **SelfieSegmenter** model.

It was chosen over the alternatives on these grounds:

| | MediaPipe Tasks Vision | ONNX Runtime Web | TensorFlow.js body-segmentation | Browser-native |
| --- | --- | --- | --- | --- |
| Runtime licence | Apache-2.0 | MIT | Apache-2.0 | n/a |
| Model licence | Apache-2.0, redistributable | depends on the model you pick | Apache-2.0 | n/a |
| Portrait model included | yes | **no** | yes, but via a deprecated package | n/a |
| Maintenance | actively published | actively published | last published 2023 | n/a |
| Runtime download | 12 MB WASM, self-hostable | 145 MB package, self-hostable | 147 MB package | n/a |
| Model size | 244 KB | 4 MB to 100 MB+ | varies | n/a |

The deciding factors:

* **Model licensing.** ONNX Runtime Web is an excellent runtime but ships no
  portrait model. The usual candidates are awkward to redistribute:
  RobustVideoMatting is GPL-3.0 and MODNet is research-restricted. MediaPipe's
  SelfieSegmenter model card states it is licensed under Apache 2.0, so it can
  simply be committed to this repository.
* **Maintenance.** `@tensorflow-models/body-segmentation` was last published in
  2023, and its MediaPipe runtime wraps the deprecated
  `@mediapipe/selfie_segmentation` package, which defaults to a CDN.
* **Fit.** The SelfieSegmenter model card names its intended application as
  human segmentation from video in interactive applications, which is exactly
  this.
* **No browser-native option exists.** Chromium's `backgroundBlur`
  `MediaStreamTrack` constraint blurs a background on supported hardware but
  exposes no mask, so it cannot composite a subject onto a scene.

Popularity was not a factor; licence, maintenance and self-hostability were.

### Which MediaPipe model

MediaPipe publishes several segmentation models for the same runtime. The
figures below are Google's published latencies (Pixel 6); the sizes are the
published `.tflite` files.

| Model | Input | Size | Latency, CPU / GPU | Fit for LiveScape |
| --- | --- | --- | --- | --- |
| **SelfieSegmenter, square** (used) | 256×256 | 244 KB | 33 ms / 35 ms | Person/background confidence, built for real-time video |
| SelfieSegmenter, landscape | 144×256 | 250 KB | 34 ms / 34 ms | Same family; lower vertical resolution for a 16:9 camera |
| SelfieMulticlass | 256×256 | 16.4 MB | 218 ms / 71 ms | Hair, skin and clothing classes, but about twice the GPU cost and 67 times the download |
| HairSegmenter | 512×512 | not checked | 58 ms / 52 ms | Hair only, not a person matte |
| DeepLab-v3 | 257×257 | not checked | 124 ms / 103 ms | General-purpose, not tuned for people |

The square SelfieSegmenter stays. The background flashing around moving
hands seen in real-camera testing has a cause in the pipeline rather than the
model (see [The matte pipeline](#the-matte-pipeline)), and the multiclass
model's cost would land on the renderer's main thread. It is the natural candidate to
revisit once inference runs in a worker.

Outside MediaPipe, the better video-matting models remain difficult to
redistribute (RobustVideoMatting is GPL-3.0, MODNet's weights are
research-restricted) and would add ONNX Runtime Web, a much larger runtime,
without a model that fixes the problems above.

### The segmenter boundary

The renderer talks to a small local interface, not to MediaPipe:

```ts
interface SubjectSegmenter {
  readonly name: string;
  initialize(): Promise<void>;
  segment(frame: FrameSource, timestampMs: number): Promise<SegmentationMask | null>;
  dispose(): Promise<void>;
}
```

Everything above it — the scheduler, the compositor, the camera lifecycle —
depends only on that. Replacing the backend, or moving inference into a worker,
does not touch them. The test suite substitutes a fake segmenter through the
same interface, which is why no CI machine needs a GPU.

## Model and runtime assets

Both the runtime and the model are served by whatever serves the renderer.
Nothing is fetched from a CDN.

| Asset | Size | Where it comes from | Licence |
| --- | --- | --- | --- |
| `models/selfie_segmenter.tflite` | 244 KB | Committed to the repository | Apache-2.0 |
| `vendor/mediapipe/wasm/vision_wasm_internal.{js,wasm}` | 12 MB | Copied from `node_modules` at build time | Apache-2.0 |
| `vendor/mediapipe/wasm/vision_wasm_nosimd_internal.{js,wasm}` | 11 MB | Copied from `node_modules` at build time | Apache-2.0 |

The model is small and redistributable, so it is committed; provenance and
attribution are in `apps/renderer/public/models/NOTICE.txt`.

The WASM fileset is 23 MB of generated dependency output, so it is **not**
committed. A Vite plugin publishes it from `node_modules`: it is served from
memory by the dev server, and emitted into `dist/` by the production build.
That means `apps/renderer/dist` is about 23 MB, essentially all WASM. Only one
of the two filesets is ever downloaded — the runtime probes for WASM SIMD
support and requests the matching pair.

The MediaPipe runtime is loaded with a dynamic import, so the 154 KB of runtime
glue is a separate chunk. A LiveScape instance that never enables segmentation
never downloads it.

## The compositor

The renderer composites back to front:

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

A scene puts its artwork and moving actors on its own three planes, so in
Roadside Workshop a car passes behind you and leaves blow past in front of you.
Raw and segmented modes use the same plane: in raw mode the camera frame is
opaque, so only the scene's foreground and the foreground effects show over it.
See [Scenes and Effects](scenes-and-effects.md#composition).

Each effect belongs to exactly one plane:

| Effect | Plane | Why |
| --- | --- | --- |
| `rain` | foreground | Weather falls between the camera and you. |
| `snow` | foreground | Same. |
| `fireworks` | background | They read as distant sky. |

That split is what makes a person look like they are standing *inside* the
scene rather than pasted on top of it. With the camera off the subject plane is
empty and the result is unchanged.

Background removal is a canvas composite, not a per-pixel loop over the
stage. The camera frame is drawn, then the matte is drawn over it with
`destination-in`, which keeps only the covered pixels. The matte is much
smaller than the stage; the browser's bilinear upscale softens its edge.

## The matte pipeline

```text
camera frame
  → held (a VideoFrame, or a canvas copy) and scaled to the segmentation input
  → MediaPipe SelfieSegmenter (256×256 inside the model)
  → confidence mask at the segmentation input size
  → temporal filter (motion-gated)
  → edge refinement against the same frame (guided filter)
  → threshold ramp with hysteresis
  → matte canvas
  → drawn over the *held* frame, not the live video
```

### Frame and mask synchronisation

A mask describes the frame it was computed from. Drawing the live video under
whichever mask finished last means the matte describes where a moving hand
*was* while the frame shows where it *is*: the room shows through on one side
of the hand and the hand is clipped on the other, until the next mask catches
up.

So in Segmented mode the subject layer never draws the live video. The frame
handed to the segmenter is held, and drawn only once its own mask arrives; the
previous frame/mask pair stays on screen meanwhile. With MediaPipe's
synchronous backend the mask arrives within the same animation frame, so the
subject is late by roughly one inference (about 20 ms on the machine measured
below). The diagnostics report that delay as **Mask age**.

Where WebCodecs is available the held frame is a `VideoFrame`, a reference to
the camera's own buffer, so holding it copies nothing. At most two frames are
held at any time (one waiting for its mask, one on screen) and each is closed
as soon as it is replaced.

The subject therefore moves at the segmentation rate, not the camera rate.
Balanced and Quality segment every frame of a 30 FPS camera on the machine
measured below; Performance deliberately does not.

### Temporal filter

A fixed-weight moving average trades flicker for a ghost: the pixels a hand
has just left keep saying "person" for several frames. LiveScape's filter
weighs each pixel by how much it changed:

* a small change (under 0.08 in confidence) is treated as noise and smoothed
  with the full **Temporal smoothing** weight;
* a large change (over 0.35) is treated as motion and passes through in a
  single frame, in either direction;
* in between, the weight falls off smoothly.

A still hair edge is steadied; a hand arriving or leaving is not delayed. The
filter holds one frame of history and resets on a camera switch or preset
change.

### Edge refinement

The model sees the frame at 256×256, so its edge is a smooth curve a few
pixels away from where hair, a sleeve or a finger actually ends. Edge
refinement is a guided filter using the frame's own luminance: where the
matte's soft edge straddles a real edge in the image, the matte is pulled onto
that edge and sharpened; where the image is flat, the matte is only smoothed,
which the threshold ramp re-sharpens into a cleaner contour. It cannot create
foreground far from where the model placed it.

It runs on the CPU at the mask's resolution, fitted at half resolution and
applied at full resolution, which costs about 2 ms at 320×180. It works on
brightness only, so an edge between two different colours of the same
brightness is not refined.

### Threshold, softness and hysteresis

Confidence becomes coverage through a smoothstep ramp centred on the
threshold. The threshold also leans slightly (by 0.04) towards each pixel's
previous state, so a still edge whose confidence wobbles around the threshold
does not flip every frame. A confident change still crosses it immediately.

### Controls

| Control | Default | Effect |
| --- | --- | --- |
| Quality | Balanced | See [Quality presets](#quality-presets). |
| Edge refinement | on | Guided-filter refinement against the camera frame. Not available in Performance. |
| Edge threshold | 0.50 | Confidence at which a pixel is half opaque. |
| Edge softness | 0.18 | Width of the ramp around the threshold. A hard cut makes the edge crawl frame to frame. |
| Edge feather | 2 px | Blur applied to the matte while compositing. |
| Temporal smoothing | 0.50 | How much of the previous matte a *still* pixel keeps. Motion bypasses it. |
| Show matte | off | Setup panel only: draws the matte, white subject on black, instead of the subject. |

**Show matte** is an inspection aid. It exists only in the page that has
`?setup=1`, so a Browser Source on the bare renderer URL cannot show it.

## The segmentation scheduler

The scheduler never queues. At most one inference runs at a time, and a new
one starts only when the camera has delivered a frame that has not been
segmented yet (reported by `requestVideoFrameCallback`; browsers without it
fall back to the animation frame and the rate limit). If the camera delivers
a frame while inference is running, or before the rate limit allows another
start, that frame is not stored. The next animation frame simply offers
whatever frame is current by then. Latency is bounded by one inference and
stale frames never accumulate.

Two limits apply:

* a **minimum interval** between inference starts, per preset;
* a **duty cycle**: if a mask costs more (inference plus matte processing)
  than the preset's share of wall-clock time allows, the interval stretches.
  On a slow machine or under heavy GPU load, the subject then updates less
  often instead of dragging the whole page's frame rate down.

**Skipped** counts offers declined because inference was running, and
**Throttled** counts offers declined by the rate limit. Both are expected to
rise steadily; they are not errors. **Stale** counts masks thrown away because
their frame was no longer the one waiting, which should stay at zero with the
MediaPipe backend.

An isolated inference failure is counted and ignored. Five consecutive
failures mark the backend as unusable, and the panel says so; the renderer
keeps drawing the scene throughout.

## Performance

Diagnostics are in the setup panel (and a subset in the `?debug=1` overlay):
camera resolution and delivery rate, render FPS, quality preset, segmentation
input and mask size, whether edges were refined, backend, segmentation FPS,
inference time, matte processing time, mask age, and the skipped, throttled,
stale and error counters.

### Quality presets

| | Performance | Balanced (default) | Quality |
| --- | --- | --- | --- |
| Segmentation input (longest side) | 256 | 320 | 384 |
| Mask on a 1280×720 camera | 256×144 | 320×180 | 384×216 |
| Minimum interval | 45 ms | 20 ms | 16 ms |
| Duty cycle cap | 50% | 80% | 90% |
| Edge refinement radius | off | 1 | 2 |
| Typical subject rate, 30 FPS camera | about 20 FPS | 30 FPS | 30 FPS |

The model always runs at 256×256, and MediaPipe returns the mask at the input
size, so the input size sets the resolution the matte is processed and refined
at, not what the model sees. Inference cost is nearly flat across these sizes;
matte processing grows with the mask's area.

Balanced is the default. Quality refines over a wider window at a higher
matte resolution, for a still desk setup on a machine with headroom.
Performance is for machines where inference itself is slow; its subject moves
at about 20 FPS.

### Measured

Apple M1, macOS 26, Brave 1.95 (Chromium 153) headless with the Metal (ANGLE)
GPU, Chromium's synthetic 1280×720 camera at 30 FPS, 1920×1080 page, Roadside
Workshop, setup panel open, averaged over ten seconds per row. The synthetic
camera shows no person, but inference and matte processing costs do not depend
on image content.

| Balanced | Render | Segmentation | Inference | Matte processing | Mask age | Browser CPU |
| --- | --- | --- | --- | --- | --- | --- |
| Roadside Workshop | 60 FPS | 27 FPS | 22 ms | 3.8 ms | 20 ms | 63% |
| + rain | 60 FPS | 30 FPS | 17 ms | 3.0 ms | 20 ms | 76% |
| + rain + fireworks | 60 FPS | 30 FPS | 17 ms | 3.0 ms | 20 ms | 83% |

| All three effects | Render | Segmentation | Inference | Matte processing | Mask age |
| --- | --- | --- | --- | --- | --- |
| Performance | 60 FPS | 20 FPS | 13 ms | 0.5 ms | 14 ms |
| Balanced | 60 FPS | 30 FPS | 17 ms | 3.0 ms | 20 ms |
| Quality | 60 FPS | 30 FPS | 17 ms | 4.4 ms | 21 ms |

"Inference" includes MediaPipe reading the mask back from the GPU, which is
where most of its time goes. "Browser CPU" is the sum over the browser's
processes as reported by `ps`, where 100% is one core. These are figures
from one machine and a synthetic camera; they are not a promise about yours,
and OBS was not benchmarked with this configuration.

Two approaches were measured and rejected because they cost frame rate on
this machine: upscaling the matte with `imageSmoothingQuality = "high"`
(render fell to about 12 FPS), and redrawing the subject on every animation
frame when nothing had changed (it is now redrawn only when a new frame/mask
pair arrives or a setting changes).

## Hardware considerations

* A GPU helps. On Windows in OBS the WebGL delegate measured about 4 ms per
  inference against about 11 ms for the CPU delegate. On the Apple M1 above
  the two were within measurement noise of each other, because both pay for a
  GPU readback.
* The renderer asks for 1280×720 at 30 FPS and uses whatever the device
  actually gives it, which the diagnostics report.
* If the GPU delegate cannot be created, LiveScape falls back to the CPU
  delegate automatically. The panel shows which one is running.

## Browser findings

Tested in Chromium 127 (the engine OBS 32.2.1 embeds) and in a current
Chromium-based browser:

* `http://127.0.0.1` is a secure context, so `getUserMedia` is available
  without TLS.
* WASM SIMD is supported, so the SIMD fileset is the one that loads.
* The MediaPipe runtime and model load from the renderer's own origin in about
  160 ms to 200 ms, cold.
* `segmentForVideo` rejects a timestamp that does not increase. The scheduler
  forces monotonicity, which is why device switches and clock resets are safe.
* `requestVideoFrameCallback` and WebCodecs `VideoFrame` are both available in
  current Chromium, so frames are segmented once each and held without a copy.
  Where either is missing the renderer falls back to the animation frame and a
  canvas copy.

## Using the camera inside OBS

This is the part that needs care.

**By default, an OBS Browser Source refuses `getUserMedia`.** It returns
`NotAllowedError: Permission denied`, because a Browser Source has no UI to
show a permission prompt. Device *enumeration* works and returns full labels;
only capture is refused.

LiveScape handles that cleanly (the scene, effects and event stream keep
working and the panel says permission is blocked), but the camera cannot be
composited in OBS until capture is allowed. There is no setting for this in
the OBS interface; OBS has to be started with Chromium command-line flags.

**macOS.** The configuration validated with a real camera is:

```bash
/Applications/OBS.app/Contents/MacOS/OBS --enable-media-stream --use-fake-ui-for-media-stream
```

`--use-fake-ui-for-media-stream` answers the embedded browser's (CEF's) media
permission request automatically, which is what a Browser Source cannot do on
its own. It does not grant anything at the operating-system level: OBS must
still be allowed to use the camera in **System Settings → Privacy & Security →
Camera**. `--enable-media-stream` was part of the validated command line; it
has not been tested whether a given OBS version needs it.

**Windows.** Starting OBS with the fake-UI flag was sufficient on the
Windows machine where the pipeline was first verified:

```text
obs64.exe --use-fake-ui-for-media-stream
```

These are the configurations that have been tested. Other OBS versions and
platforms may behave differently.

!!! danger "What the fake-UI flag actually does"

    `--use-fake-ui-for-media-stream` auto-accepts camera and microphone
    requests for **every** Browser Source in that OBS instance, with no prompt.
    If your scene collection contains a browser source pointing at a
    third-party overlay or alert service, that page can open your camera
    silently.

    Only use it if you trust every Browser Source URL in your collection.

### Verified in OBS

With a physical camera and a real person, on macOS with OBS Studio 32.2.2
started as above: the camera opened inside the Browser Source; Raw and
Segmented modes both ran; scenes switched while the camera stayed active; and
Roadside Workshop composited around the subject. That validation predates the
current matte pipeline, which has been benchmarked in a Chromium browser but
not yet re-run in OBS.

Exercised in OBS Studio 32.2.1 (obs-browser 2.26.9, CEF 127.0.6533.120) with
the built renderer served over HTTP:

* the page loads, connects to the event server and renders scenes and effects;
* the local WASM fileset and model load from the renderer's origin;
* both the GPU and CPU MediaPipe delegates initialise and run;
* Raw and Segmented modes both run, at 60 FPS render and 20 FPS segmentation;
* scene changes and effects apply while segmentation is running;
* stopping and restarting the camera releases and reacquires it cleanly;
* refreshing the source brings the camera back **off**, and restores the scene
  and effects from the server's `state.sync`;
* stopping the event server leaves the camera running and the scene on screen;
  restarting it resyncs without touching the camera.

### Camera ownership

A webcam is a shared resource, and not every driver allows two readers.

If LiveScape owns a webcam for segmentation, **do not also add an OBS Video
Capture Device source for the same physical webcam**, unless you know your
camera and driver support several simultaneous consumers. Many UVC webcams
allow only one; the second one to ask gets `NotReadableError`, which
LiveScape reports as "Camera in use elsewhere". Which application wins depends
on the driver and on start order, so it is not something to rely on either way.

!!! note "What was and was not tested here"

    The two-consumer case was exercised against the **OBS Virtual Camera**,
    which permits several simultaneous readers. Two consumers of one physical
    webcam have not been tested.

## Troubleshooting

**"Permission blocked" in a normal browser.** Allow the camera for the
renderer's origin in site settings, then press **Try again**.

**"Permission blocked" in OBS.** Expected without the launch flags. See
[above](#using-the-camera-inside-obs). On macOS, also check that OBS is allowed
to use the camera in System Settings.

**"Camera in use elsewhere".** Something else holds the device. Close it, or
remove the duplicate OBS Video Capture Device source.

**Segmentation says "failed".** The panel shows the underlying message. The
usual causes are the WASM fileset not being reachable (check that
`/vendor/mediapipe/wasm/vision_wasm_internal.wasm` returns 200) or the model
missing (`/models/selfie_segmenter.tflite`). The scene keeps rendering
regardless; switch to Raw if you want the camera visible meanwhile.

**Nothing appears in Segmented mode.** That is the intended behaviour before
the first mask arrives, and after segmentation fails. Check the Backend and
Masks figures in the diagnostics.

**Judging the edge.** Turn on **Show matte** in the setup panel to see the
matte itself, white subject on black. Flicker, holes and halos are much easier
to see there than in the composite.

**The edge crawls or flickers while you are still.** Raise Temporal smoothing
a little, then Edge softness.

**A ghost trails behind a fast movement.** Lower Temporal smoothing.

**The room shows around a moving hand.** Check that Stale stays at zero and
Mask age is around one inference. If Segmentation FPS is well below the camera
rate, the subject is updating less often than the camera; try Balanced rather
than Quality, or close other GPU-heavy applications.

**Fingers or hair are cut off.** Lower Edge threshold slightly, and keep Edge
refinement on. Very thin detail is below what the model resolves.

**A halo of the room around you.** Raise Edge threshold slightly, or lower
Edge feather.

**Device names are blank.** The camera has not been allowed yet on this origin.

## Limitations

These are real and worth knowing before you rely on this.

* **Inference runs on the main thread.** MediaPipe's video API is synchronous.
  About 17 ms per mask on an Apple M1 left the page at 60 FPS in the
  measurements above, and the duty-cycle cap protects the page on slower
  machines by lowering the subject's frame rate. Moving inference into a Web
  Worker is the clearest next improvement.
* **The subject moves at the segmentation rate.** Showing each frame with its
  own mask removes edge mismatch, but a machine that cannot segment every
  camera frame shows a subject that updates less often than the camera.
* **The subject is shown about one inference late.** Typically around 20 ms.
  If you mix LiveScape's output with separately captured audio, that is the
  offset to compensate for.
* **Segmentation is not perfect and is not meant to be.** The model card is
  explicit that it is optimised for real-time performance and may not produce
  pixel-perfect masks, that thin features such as fingers can be missed, and
  that low light, noise, fast motion and large occluders all degrade it. Edge
  refinement follows brightness edges only, so hair against a background of
  similar brightness is not improved.
* **The current matte pipeline has not been judged against a real person yet.**
  Its costs were measured with a synthetic camera; how it looks on camera is
  what the manual validation has to establish.
* **The model finds people, not you specifically.** It may include other people
  in the frame, and it is not intended for subjects more than about four metres
  away.
* **OBS needs command-line flags** to allow capture at all, with the security
  consequence described above.
* **No frame rate is guaranteed.** The numbers on this page came from specific
  machines.

## What LiveScape does not do with your camera

Stated precisely, because vague privacy claims are worse than none:

* Camera frames stay in the renderer tab. They are drawn to a canvas and
  handed to a segmentation runtime running locally in that same tab.
* No frame is sent to the FastAPI event server, over the WebSocket, to an AI
  provider, to an analytics service, or to any third-party inference API.
* There is no recording, no screenshot capture and no frame persistence.
  Nothing writes a frame to disk.
* The only camera-related network requests LiveScape makes are HTTP GETs to its
  own origin for the WASM runtime and the `.tflite` model. Those are static
  file downloads, not video transmission, and they happen whether or not a
  camera is present.
* Camera state is not part of the event protocol. The event server has no idea
  whether a camera exists.

This was verified by inspecting all network activity in both a browser and an
OBS Browser Source while segmentation was running: every request went to the
renderer's own origin, and none of them carried a frame.
