# Configuration

All configuration is environment-driven, and every value below is also the
built-in default. No `.env` file is required to run LiveScape locally.

Each component ships a `.env.example` documenting its own variables.

## Event server

Source: [`services/event-server/.env.example`](https://github.com/quangshuynh/livescape/blob/main/services/event-server/.env.example)

| Variable | Default | Notes |
| --- | --- | --- |
| `LIVESCAPE_HOST` | `127.0.0.1` | Bind address. Keep it loopback: the control API is unauthenticated. |
| `LIVESCAPE_PORT` | `8765` | Must parse as an integer, or startup fails. |
| `LIVESCAPE_DEFAULT_SCENE` | `city` | Must be a scene id in the registry, or startup fails. |
| `LIVESCAPE_LOG_LEVEL` | `info` | uvicorn level: `critical`, `error`, `warning`, `info`, `debug`, `trace`. |
| `LIVESCAPE_ALLOWED_ORIGINS` | the four loopback dev-server origins | Comma-separated CORS allowlist. |

The default origin allowlist is `http://127.0.0.1:5173`,
`http://localhost:5173`, `http://127.0.0.1:5174` and `http://localhost:5174`.

Invalid values fail loudly at startup rather than being silently coerced.

## Platform adapter

Source: [`services/platform-adapter/.env.example`](https://github.com/quangshuynh/livescape/blob/main/services/platform-adapter/.env.example)

| Variable | Default | Notes |
| --- | --- | --- |
| `LIVESCAPE_EVENT_SERVER_URL` | `http://127.0.0.1:8765` | Loopback only. Any other host, a path, query or credentials fail at startup. |
| `LIVESCAPE_ADAPTER_MAPPINGS` | the bundled demonstration mappings | Path to a [mapping file](platform-adapters.md#mappings). An invalid file fails at startup. |

Both can be overridden with `--server` and `--mappings`.

## Renderer

Source: [`apps/renderer/.env.example`](https://github.com/quangshuynh/livescape/blob/main/apps/renderer/.env.example)

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_LIVESCAPE_WS_URL` | `ws://127.0.0.1:8765/ws` | WebSocket endpoint of the event server. |

Copy the example to `.env.local` to override. Set this when you serve the
renderer from a different host or port than the event server, for example when
serving a production build to OBS.

The renderer also reads one URL parameter:

| Parameter | Effect |
| --- | --- |
| `?debug=1` | Shows the development status overlay. Any value except `0` and `false` enables it. |

Leave `debug` off for the URL you give OBS.

## Control panel

Source: [`apps/control-panel/.env.example`](https://github.com/quangshuynh/livescape/blob/main/apps/control-panel/.env.example)

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_LIVESCAPE_API_URL` | `http://127.0.0.1:8765` | HTTP base URL of the event server. Trailing slashes are stripped. |
| `VITE_LIVESCAPE_WS_URL` | `ws://127.0.0.1:8765/ws` | WebSocket endpoint used for the activity feed and connection indicator. |

If you change the dev-server ports, add the new origins to
`LIVESCAPE_ALLOWED_ORIGINS` as well, or the browser will block the requests.
