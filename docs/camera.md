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

Background removal is a canvas composite, not a per-pixel loop. The camera
frame is drawn, then the mask is drawn over it with `destination-in`, which
keeps only the covered pixels. The mask is much smaller than the stage, so the
browser's bilinear upscale softens the edge for free.

### Mask shaping

| Control | Default | Effect |
| --- | --- | --- |
| Edge threshold | 0.50 | Confidence at which a pixel is half opaque. |
| Edge softness | 0.18 | Width of the ramp around the threshold. A hard cut makes the edge crawl frame to frame. |
| Edge feather | 2 px | Blur applied to the mask while compositing. |
| Temporal smoothing | 0.25 | How much of the previous mask is kept. |

Temporal smoothing is deliberately low. It steadies a flickering edge, but it
also trails behind a moving arm, and a ghost following you around is worse than
a slightly noisy outline.

## The segmentation scheduler

The renderer draws far more often than it can segment. The scheduler never
queues: a frame offered while inference is running is dropped and counted, and
the next frame offered after inference finishes is by definition the current
one. The mask can be a frame or two old; it can never fall further behind than
one inference, however slow the backend is.

A separate minimum interval keeps inference from running on every animation
frame. Those two counters are reported separately in the diagnostics: **Skipped**
is backlog pressure, **Throttled** is the rate limit doing its job.

An isolated inference failure is counted and ignored. Five consecutive failures
mark the backend as unusable, and the panel says so; the renderer keeps drawing
the scene throughout.

## Performance

Diagnostics are in the setup panel and in the `?debug=1` overlay. They report
the camera resolution, the segmentation input size, render FPS, segmentation
FPS, inference time, masks produced, and skipped and throttled frames.

The figures below were measured on one machine (Windows 11, 8 logical cores,
WebGL GPU delegate). They are evidence that the design works, not a promise
about your hardware.

**Inference cost is almost flat across input sizes**, because the model
resamples whatever it is given to 256×256 internally:

| Segmentation input | Inference (median) | Mask shaping | Total per mask |
| --- | --- | --- | --- |
| 192×108 | 3.2 ms | 0.4 ms | ~3.6 ms |
| 256×144 | 3.0 ms | 0.8 ms | ~3.8 ms |
| 384×216 | 3.0 ms | 1.9 ms | ~4.9 ms |
| 640×360 | 3.7 ms | 5.2 ms | ~8.9 ms |
| 1280×720 | 5.0 ms | 21.2 ms | ~26 ms |

The real cost of a larger input is not inference; it is shaping the returned
mask, which scales with its area. That is why the presets stay well below
640×360.

### Quality presets

| Preset | Segmentation input | Minimum inference interval |
| --- | --- | --- |
| Performance | longest side 192 | 66 ms |
| Balanced (default) | longest side 256 | 40 ms |
| Quality | longest side 384 | 25 ms |

The segmentation input is the camera's aspect ratio with its longest side
clamped, so a 1280×720 camera on Balanced is segmented at 256×144.

### Measured in an OBS Browser Source

Running in OBS 32.2.1 with a 1280×720 source, the Balanced preset, a scene
change and two effects active:

```text
Camera:        1280x720
Backend:       mediapipe-selfie/GPU
Render:        60 FPS
Segmentation:  256x144 at 20 FPS
Inference:     6.2 ms
Skipped:       0
Throttled:     203
Errors:        0
```

Render frame rate held at 60 while segmenting. Skipped stayed at zero, which is
expected: MediaPipe's `segmentForVideo` is synchronous, so inference completes
within the animation frame that submitted it and no backlog can form. The
scheduler's guard matters for asynchronous backends, and it is tested as such.

The flip side of that synchronicity is that inference runs **on the main
thread**. At roughly 6 ms, twenty times a second, that was not enough to drop
frames here, but it is the first thing to move if it ever is. See
[Limitations](#limitations).

## Hardware considerations

* A GPU helps a lot. The WebGL delegate measured about 4 ms per inference in
  OBS against about 11 ms for the CPU delegate.
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

## Using the camera inside OBS

This is the part that needs care.

**By default, an OBS Browser Source refuses `getUserMedia`.** It returns
`NotAllowedError: Permission denied`, because a Browser Source has no UI to
show a permission prompt. Device *enumeration* works and returns full labels;
only capture is refused.

LiveScape handles that cleanly — the scene, effects and event stream all keep
working, and the panel says permission is blocked — but the camera cannot be
composited in OBS until permission is granted.

To grant it, OBS must be started with a Chromium flag:

```text
obs64.exe --use-fake-ui-for-media-stream
```

With that flag, `getUserMedia` succeeds inside the Browser Source and the whole
pipeline runs. There is no equivalent setting in the OBS interface.

!!! danger "What that flag actually does"

    `--use-fake-ui-for-media-stream` auto-accepts camera and microphone
    requests for **every** Browser Source in that OBS instance, with no prompt.
    If your scene collection contains a browser source pointing at a
    third-party overlay or alert service, that page can open your camera
    silently.

    Only use it if you trust every Browser Source URL in your collection.

### Verified in OBS

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

If LiveScape holds a webcam for segmentation, **do not also add an OBS Video
Capture Device source for the same physical webcam.** Many UVC webcams allow
only one consumer; the second one to ask gets `NotReadableError`, which
LiveScape reports as "Camera in use elsewhere". Which application wins depends
on the driver and on start order, so it is not something to rely on either way.

!!! note "What was and was not tested here"

    The two-consumer case was exercised against the **OBS Virtual Camera**,
    which is a software DirectShow filter and does permit several simultaneous
    readers. It is not evidence about physical webcams, which commonly do not.
    No physical webcam was available on the machine this was verified on.

## Troubleshooting

**"Permission blocked" in a normal browser.** Allow the camera for the
renderer's origin in site settings, then press **Try again**.

**"Permission blocked" in OBS.** Expected without
`--use-fake-ui-for-media-stream`. See [above](#using-the-camera-inside-obs).

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

**The edge crawls or flickers.** Raise Edge softness or Edge feather before
reaching for Temporal smoothing.

**A ghost trails behind you.** Temporal smoothing is too high.

**Device names are blank.** The camera has not been allowed yet on this origin.

## Limitations

These are real and worth knowing before you rely on this.

* **Inference runs on the main thread.** MediaPipe's video API is synchronous.
  It measured about 6 ms per inference in OBS and did not drop frames there,
  but on slower hardware, at higher segmentation rates, or alongside heavy
  encoding, it will compete with rendering. Moving inference to a Web Worker is
  the clearest next improvement, and the `SubjectSegmenter` interface exists so
  that it can be done without touching the compositor.
* **Segmentation is not perfect and is not meant to be.** The model card is
  explicit that it is optimised for real-time performance and may not produce
  pixel-perfect masks, that thin features such as fingers can be missed, and
  that low light, noise, fast motion and large occluders all degrade it. Hair,
  glasses and chair edges are the usual places you will see that.
* **Mask quality has not been validated against a real person.** The pipeline
  was verified with synthetic and virtual-camera input; no physical camera was
  available. Nothing here should be read as a claim about how good you will
  look on camera.
* **The model finds people, not you specifically.** It may include other people
  in the frame, and it is not intended for subjects more than about four metres
  away.
* **OBS needs a command-line flag** to allow capture at all, with the security
  consequence described above.
* **No frame rate is guaranteed.** The numbers on this page came from one
  machine.

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
