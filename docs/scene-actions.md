# Scene Actions

A **scene action** asks the scene that is showing to do one predefined thing,
once: send a bus down the street, blow a gust of leaves past the camera. It is
how an explicit event interacts with an environment, as opposed to the
ambient actors a scene runs on its own schedule.

```text
operator presses "Send Bus"
  → scene.action { actionId: "roadside.send-bus" }
  → event server: allowlisted? owned by the current scene? outside its cooldown?
  → WebSocket broadcast
  → renderer: re-validated, routed to the scene showing now
  → bus enters off screen, passes behind the subject, leaves, is removed
```

An action id selects a capability the renderer already has. It cannot carry
parameters, code, URLs, paths, prompts, CSS, selectors, HTML or actor
definitions, and there is no generic "execute" event.

## Actions

| Id | Scene | Label | Cooldown | What happens | Plane |
| --- | --- | --- | --- | --- | --- |
| `roadside.send-car` | Roadside Workshop | Send Car | 1.5 s | A car drives past in whichever lane is free, near lane first | backdrop |
| `roadside.send-bus` | Roadside Workshop | Send Bus | 8 s | A bus drives slowly past, far lane first, near lane if that one is busy | backdrop |
| `roadside.pedestrians` | Roadside Workshop | Pedestrians | 5 s | Two or three people walk along the near sidewalk, strung out | backdrop |
| `roadside.blow-leaves` | Roadside Workshop | Blow Leaves | 3 s | A gust of six to eight large leaves crosses in front of everything | foreground |
| `roadside.rush-hour` | Roadside Workshop | Rush Hour | 30 s | Traffic and foot traffic spawn every 0.9 to 1.8 s for 20 s, then ambient behaviour carries on as before | backdrop |
| `forest.bird-flock` | Forest | Bird Flock | 5 s | Five to eight birds cross above the treeline | backdrop |
| `space.shooting-star` | Space | Shooting Star | 3 s | A meteor streaks across the starfield | backdrop |

City has no actions.

Street actions use the backdrop plane, so the bus passes behind the workshop's
door frame and behind the camera subject. The gust uses the foreground plane,
so the leaves cross in front of the subject. The action system does not know
whether the camera is off, raw or segmented: it places actors on scene planes,
and the compositor decides what is in front of what. See
[Scenes and Effects](scenes-and-effects.md#composition).

## The registry

Every action is declared once, in the protocol registry
(`packages/protocol/registry.json`, mirrored for the server):

```json
{
  "id": "roadside.send-bus",
  "sceneId": "roadside-workshop",
  "label": "Send Bus",
  "description": "A bus drives slowly past on the street behind the subject.",
  "cooldownMs": 8000
}
```

That answers which actions exist, which scene owns each one, what the control
panel should call it, and how often it may run. The same parity protection as
scenes and effects applies: `registry.ts` throws at import time if the JSON and
the declared `SceneActionId` union disagree or an action names an unknown scene
or an out-of-range cooldown (250 ms to 60 s); `registry.py` does the same on the
server; and each Python package's `tests/test_registry.py` fails if its JSON
copy drifts from the canonical one.

How a scene performs an action is renderer data, next to the scene's spawners
in `apps/renderer/src/scenes/index.ts`:

```ts
const ROADSIDE_ACTIONS = {
  'roadside.send-bus': { kind: 'spawn', spawners: ['bus', 'near-bus'] },
  'roadside.rush-hour': {
    kind: 'surge',
    spawners: ['near-traffic', 'far-traffic', 'far-walkers', 'near-walkers', 'walker-group'],
    durationMs: 20_000,
    intervalMs: [900, 1800],
  },
  // ...
};
```

There are two kinds, and a scene cannot supply its own:

* **`spawn`** spawns once from the first listed spawner that has room.
* **`surge`** spawns from the listed spawners on a faster schedule for a fixed
  duration (at most 60 s, never faster than every 500 ms), then stops.

Both name spawners the scene already declares. Some spawners exist only for
actions: they have no ambient schedule and never spawn on their own. Label and
cooldown always come from the registry. The tests check that every registry
action is implemented by its owning scene, that no scene implements another
scene's action, and that an implementation naming an unknown spawner is
rejected.

## Transient, not state

Scene and effect events are **durable state**: the event server folds them
into its snapshot, and `state.sync` hands that snapshot to every client that
connects. A scene action is a **transient event**:

* the server broadcasts it but never records it, so it never appears in
  `state.sync`, in `/healthz`'s scene or effects, or anywhere else a later
  client could read it back;
* the renderer performs it once and does not put it in renderer state.

That is what makes reconnects behave:

* a renderer that is disconnected when an action is broadcast never sees it,
  and nothing replays it later;
* when it reconnects, `state.sync` restores the scene and the effects that
  still have time left;
* actions sent after the reconnect work normally.

A bus that went past twenty seconds ago is not part of what is on screen now,
so a new OBS source does not start with an old bus.

## Scene ownership

An action belongs to exactly one scene, and it is checked on both sides:

* **Event server.** An action for a scene that is not current is refused with
  `409 Conflict` and is not broadcast.
* **Renderer.** The scene director routes the action to the scene showing now,
  and refuses it there if the registry says another scene owns it. A scene that
  is fading out never receives actions, and one scene's action never touches
  another scene's actors.

The control panel only offers the current scene's actions, but it is a
convenience; the checks above do not depend on it.

When the scene changes, the outgoing scene is retired: waiting and surging
actions are cancelled at once, its actors finish the crossfade, and then they
are removed with the scene. Coming back to a scene starts a fresh showing, with
no leftover actors, cooldowns or surges.

## Cooldowns and bursts

Actions are designed for bursts, because a future platform adapter may receive
many viewer events at nearly the same moment. Every request is answered
immediately, and nothing is queued without bound.

**On the event server:**

* each action has its own cooldown from the registry. A repeat inside it is
  refused with `429 Too Many Requests`, a `Retry-After` header, and
  `retryAfterMs` in the body, and is not broadcast;
* a refused request (wrong scene, cooling down, invalid) does not start or
  extend a cooldown;
* the check and the update happen in one step, so concurrent requests cannot
  both be accepted. State is one timestamp per allowlisted action id.

So fifty requests for `roadside.send-bus` within a second produce one
broadcast and forty-nine `429`s. A mixed burst produces at most one broadcast
per action per cooldown window.

**In the renderer**, each action is checked again, so a misbehaving source
still cannot flood the stage:

| Outcome | Meaning |
| --- | --- |
| `started` | Actors spawned, or the surge began, immediately |
| `queued` | No room yet (lane occupied, spawner at its cap). It waits up to 5 s for room, then is dropped |
| `coalesced` | The same action is already waiting or surging; the request merges into it |
| `cooldown` | Inside the action's cooldown (less 250 ms for delivery jitter); dropped |
| `reduced-motion` | A surge requested under reduced motion; refused |
| `inactive` | The scene is fading out or stopped |
| `unsupported` | The scene does not implement the action |
| `wrong-scene` | The action belongs to another scene |

At most one request per action waits, and a waiting action takes a freed lane
ahead of the ambient spawner that shares it. A surge that is already running
absorbs a repeat rather than extending itself. Everything an action spawns
stays inside the usual caps: each spawner's `maxAlive`, lane exclusivity, and
the scene's `maxActors` (never more than 24). Waiting and surging add no
timers: each scene still runs one.

## Reduced motion

With `prefers-reduced-motion`, a scene holds still and no ambient actors spawn.
An action is an explicit request, so it still happens, in reduced form:

* a one-shot action runs at half speed with at most two actors (a gust is two
  leaves, a flock two birds);
* a surge (Rush Hour) is sustained ambient motion and is refused;
* turning reduced motion on removes every actor, including triggered ones, and
  cancels waiting and surging actions.

## Operator controls

The control panel's **Scene actions** card lists the current scene's actions
and sends exactly the request a platform adapter would send:

```json
{ "version": 1, "type": "scene.action", "source": "manual", "payload": { "actionId": "roadside.send-bus" } }
```

One status line under the buttons reports the latest result: sent, cooling
down (with the time left), not an action of the current scene, or rejected. It
is replaced on each press rather than stacking notifications. A button whose
action is cooling down is drawn dashed with a countdown, but stays pressable,
so the server's throttling can be exercised directly. Cooldowns started by
another source show up too, from the server's `/healthz`.

For local diagnostics, `?debug=1` and `?setup=1` show how many actors are
triggered rather than ambient, the latest action and its outcome, and any
action still waiting or surging. The clean OBS URL shows none of it.

## The adapter boundary

The [platform adapter](platform-adapters.md) sits upstream of the event server
and selects an existing capability:

```text
platform event (simulated today)
  → platform adapter (separate process): normalize, map, dedup, coalesce
  → scene.action { actionId }
  → the same validation, ownership and cooldown checks
  → the same renderer
```

An adapter cannot describe new behaviour, only choose among the actions in the
registry, and the renderer never learns where an action came from beyond its
`source`. Which platform event maps to which action is declared in the
adapter's mapping file, not in LiveScape's protocol or scenes. No real
livestream platform is connected; the adapter's only source is a simulator.

## Adding an action

1. Add the entry to `packages/protocol/registry.json` and copy the file to
   `services/event-server/src/livescape_event_server/registry.json` and
   `services/platform-adapter/src/livescape_platform_adapter/registry.json`.
2. Add the id to `SCENE_ACTION_IDS` in `packages/protocol/src/registry.ts` and
   to the `SceneActionId` literal in `registry.py`.
3. Implement it in the owning scene's `actions`, using spawners the scene
   declares (add an on-demand spawner if it needs new motion).

The control panel needs no change. The shipped definitions are validated by
the test suite.
