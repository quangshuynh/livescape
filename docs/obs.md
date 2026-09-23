# Using the LiveScape renderer as an OBS Browser Source

The renderer is an ordinary web page. OBS does not need to know anything about
LiveScape, and LiveScape does not need OBS; nothing in the test suite requires
it.

## 1. Start LiveScape locally

In one terminal (with the Python environment active):

```bash
python -m livescape_event_server
```

In another:

```bash
npm run dev
```

That gives you:

| Service | URL |
| --- | --- |
| Event server | http://127.0.0.1:8765 |
| Renderer | http://127.0.0.1:5173 |
| Control panel | http://127.0.0.1:5174 |

Open the renderer in a normal browser first and confirm you see the city scene.

## 2. Add the Browser Source

In OBS: **Sources → + → Browser**.

| Setting | Value |
| --- | --- |
| URL | `http://127.0.0.1:5173` |
| Width | `1920` |
| Height | `1080` |
| Use custom frame rate | optional; 60 FPS if your scene has the headroom |
| Shutdown source when not visible | **off** — otherwise the page reloads and drops its WebSocket every time you switch scenes |
| Refresh browser when scene becomes active | **off** — the renderer restores its state from the server automatically |
| Control audio via OBS | not needed; the renderer produces no audio |

Leave "Custom CSS" empty. The renderer already fills its viewport, hides
scrollbars, and shows no UI chrome of any kind.

## 3. Check it

With the Browser Source selected, open the control panel at
http://127.0.0.1:5174 and press **Forest**. The OBS source should crossfade
within a second. Press **Rain**, then **Clear effects**.

## Production build instead of the dev server

The dev server is convenient but not required. `npm run build` writes a static
bundle to `apps/renderer/dist`, which you can serve with anything, including
`npm run preview -w @livescape/renderer` (http://127.0.0.1:4173). The renderer
is built with relative asset paths so it works from any static host.

If you serve the renderer from a different host or port than the default, point
it at the event server with `VITE_LIVESCAPE_WS_URL` (see
`apps/renderer/.env.example`).

## Notes and gotchas

* **Keep it local.** The event API is unauthenticated and binds to `127.0.0.1`
  by default. Do not expose it to a network you do not control.
* **Debug overlay.** Opening the renderer with `?debug=1` shows a small status
  box with the connection state, current scene and active effects. It is off by
  default so nothing unexpected appears on stream. Do not add `?debug=1` to
  the OBS URL.
* **Server restarts.** If the event server restarts, the renderer reconnects on
  its own (exponential backoff, capped at 8s) and adopts whatever the fresh
  server reports. Because there is no persistence yet, a restarted server comes
  back on the default scene.
* **Background throttling.** Browsers freeze `requestAnimationFrame` in hidden
  tabs, so effects pause if you background a normal browser tab. OBS drives its
  Browser Source itself and is not affected.

## Using the camera in OBS

An OBS Browser Source **refuses `getUserMedia` by default**, returning
`NotAllowedError`, because it has no way to show a permission prompt. Device
enumeration works and returns full labels; only capture is refused. LiveScape
reports this as "Permission blocked" and keeps rendering scenes and effects
normally.

Granting capture requires starting OBS with Chromium flags. On macOS, the
configuration validated with a real camera is:

```bash
/Applications/OBS.app/Contents/MacOS/OBS --enable-media-stream --use-fake-ui-for-media-stream
```

OBS must also be allowed to use the camera in **System Settings → Privacy &
Security → Camera**; the flags only answer the embedded browser's permission
request, not the operating system's. On Windows, starting OBS with
`--use-fake-ui-for-media-stream` was sufficient on the machine it was tested
on:

```text
obs64.exe --use-fake-ui-for-media-stream
```

!!! danger "That flag applies to every Browser Source"

    It auto-accepts camera and microphone requests for **all** Browser Sources
    in that OBS instance, with no prompt. Only use it if you trust every
    Browser Source URL in your scene collection.

On macOS, with that command line and the camera permission, the following has
been validated with a physical camera and a real person: the camera opens in
the Browser Source, segmentation runs locally, Roadside Workshop composites
around the subject, and scene actions sent through the event server play out
with Send Bus passing behind the subject and Blow Leaves crossing in front.
Treat the flags as the tested configuration for that setup rather than a
requirement of every OBS release. See
[Verified in OBS](camera.md#verified-in-obs).

Two more things worth knowing:

* Keep the OBS Browser Source on the bare renderer URL. The camera controls
  live behind `?setup=1`, and a source pointed at that URL would put the setup
  panel on stream.
* If LiveScape is using a webcam, do not also add an OBS **Video Capture
  Device** source for the same physical webcam, unless your camera and driver
  support several consumers at once. Many webcams allow only one, and the
  loser gets an error.

Full details, including what was measured and what was not, are in
[Camera and Compositing](camera.md).
