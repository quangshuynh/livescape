# LiveScape event protocol v1

Every message that crosses a LiveScape boundary is a **versioned, typed,
validated envelope**. The renderer never sees platform-specific data: a future
TikTok, YouTube or Twitch adapter's only job is to translate an external event
into one of the envelopes below.

The protocol is defined twice, once per runtime, and both definitions are
tested against a shared allowlist:

| Where | What |
| --- | --- |
| `packages/protocol/registry.json` | canonical scene/effect/action/source allowlist |
| `packages/protocol/src/` | TypeScript types, guards and request builders |
| `services/event-server/src/livescape_event_server/models.py` | Pydantic models |
| `services/event-server/src/livescape_event_server/registry.json` | server copy of the allowlist |

`tests/test_registry.py` fails if the two registry copies drift apart, and
`registry.ts` throws at import time if the JSON disagrees with the declared
TypeScript unions.

## Envelope

```jsonc
{
  "version": 1,
  "id": "0f1c9b9e-2b7a-4a3f-9f3b-6d0f5f0d4a11", // assigned by the server
  "type": "scene.change",
  "source": "manual",
  "timestamp": "2026-09-22T11:07:34.512Z",      // assigned by the server
  "payload": { "sceneId": "forest", "transitionMs": 900 }
}
```

* `version` — protocol version. The renderer rejects anything that is not `1`.
* `id` / `timestamp` — **server-owned**. Clients do not send them, so identity
  and ordering are decided in exactly one place.
* `source` — where the event came from: `manual` (an operator pressed a
  button), `simulation` (a development stand-in for a viewer action) or
  `system` (the server itself).
* `payload` — shape depends on `type`.

## Event types

| Type | Direction | Payload |
| --- | --- | --- |
| `scene.change` | client → server → renderer | `{ sceneId, transitionMs }` |
| `effect.trigger` | client → server → renderer | `{ effectId, intensity, durationMs }` |
| `effect.clear` | client → server → renderer | `{ effectId \| null }` |
| `scene.action` | client → server → renderer | `{ actionId }` |
| `state.sync` | server → renderer only | `{ sceneId, effects[] }` |

`state.sync` is sent to every client the moment it connects, so a renderer that
joins late — or reconnects after the server restarts — is told what is
currently on screen instead of snapping back to the default scene. Clients
cannot send it: `POST /api/events` rejects it with `422`.

### Durable state and transient events

`scene.change`, `effect.trigger` and `effect.clear` are **durable**: the server
folds them into the state that `state.sync` reports. `scene.action` is
**transient**: it asks the current scene to do one predefined thing once, is
broadcast to the clients connected at that moment, and is never recorded, so it
is never replayed to a client that connects later. See
[Scene Actions](scene-actions.md).

## Field bounds

Both runtimes validate these independently.

| Field | Rule |
| --- | --- |
| `sceneId` | must be in the registry: `city`, `forest`, `space`, `roadside-workshop` |
| `effectId` | must be in the registry: `rain`, `snow`, `fireworks` |
| `actionId` | must be in the registry, for example `roadside.send-bus`; see [Scene Actions](scene-actions.md#actions). It is the whole payload |
| `transitionMs` | integer, `0 … 10000`, default `900` |
| `intensity` | number, `0.01 … 1`, default `1` |
| `durationMs` | integer `100 … 600000`, or `null` for "run until cleared". If omitted, the registry default for that effect is used (`fireworks` → 8000, others → `null`) |
| unknown fields | rejected (`extra: forbid`) |

`intensity` is deliberately normalized to `0…1`. A platform adapter is
responsible for mapping whatever scale it receives — a gift count, a raid
size — onto that range. The control panel's simulation section does exactly
this, which is the whole point of the section: it demonstrates the adapter
boundary without pretending to be a real integration.

## Request shape

Clients `POST /api/events` with the envelope minus `id` and `timestamp`:

```jsonc
{
  "version": 1,
  "type": "effect.trigger",
  "source": "simulation",
  "payload": { "effectId": "fireworks", "intensity": 0.5, "durationMs": 8000 }
}
```

```jsonc
{
  "version": 1,
  "type": "scene.action",
  "source": "manual",
  "payload": { "actionId": "roadside.send-bus" }
}
```

The response is `202 Accepted`:

```jsonc
{
  "event": { /* the full envelope that was broadcast */ },
  "deliveredTo": 2
}
```

A `scene.action` that is valid but cannot run now is refused without being
broadcast: `409 Conflict` when the current scene does not own it, and
`429 Too Many Requests` while it is inside its cooldown. See
[Event Server API](api.md#post-apievents).

## Safety rules

These are properties of the design, not conventions:

* Scene, effect and action ids resolve through an **explicit allowlist
  registry** on both sides. The renderer looks scenes up in a fixed component
  map, effects up in a fixed factory, and actions up in the owning scene's
  definition; an unknown id cannot reach any of them.
* A scene action selects a predefined capability by id. It carries no
  parameters, so it cannot describe an actor, a sprite, an asset, a selector or
  any other renderer behaviour.
* Payloads never carry code, shell commands, file paths, URLs or prompts, and
  there is no generic "execute action" event.
* The WebSocket is a **read-only subscription**. Inbound frames are drained so
  disconnects are noticed, but they are never interpreted as commands; events
  are only accepted over HTTP.
* Anything that fails validation is dropped before it is broadcast, and the
  renderer independently re-validates every frame it receives.
