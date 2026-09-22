# Using the LiveScape renderer as an OBS Browser Source

The renderer is an ordinary web page. OBS does not need to know anything about
LiveScape, and LiveScape does not need OBS — nothing in the test suite requires
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
| Control audio via OBS | not needed; the renderer produces no audio in this interval |

Leave "Custom CSS" empty. The renderer already fills its viewport, hides
scrollbars, and shows no UI chrome of any kind.

## 3. Check it

With the Browser Source selected, open the control panel at
http://127.0.0.1:5174 and press **Forest**. The OBS source should crossfade
within a second. Press **Rain**, then **Clear effects**.

## Production build instead of the dev server

The dev server is convenient but not required. `npm run build` writes a static
bundle to `apps/renderer/dist`, which you can serve with anything — including
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
  default so nothing unexpected appears on stream — do not add `?debug=1` to
  the OBS URL.
* **Server restarts.** If the event server restarts, the renderer reconnects on
  its own (exponential backoff, capped at 8s) and adopts whatever the fresh
  server reports. Because there is no persistence yet, a restarted server comes
  back on the default scene.
* **Background throttling.** Browsers freeze `requestAnimationFrame` in hidden
  tabs, so effects pause if you background a normal browser tab. OBS drives its
  Browser Source itself and is not affected.
