# Scenes and Effects

A **scene** is the environment the renderer draws. An **effect** is an overlay
that runs on top of it. Both are enumerated in the registry, and only ids that
appear there can ever be rendered.

## Scenes

| Id | Label | Description |
| --- | --- | --- |
| `city` | City | Night skyline with drifting traffic light and window glow. |
| `forest` | Forest | Layered treeline with slow parallax drift and soft daylight. |
| `space` | Space | Deep field starscape with a slow nebula gradient. |

Scenes are drawn with CSS and SVG. There is no third-party artwork and no
external asset fetch, so the renderer works offline and nothing unexpected can
appear on stream.

`city` is the default. A renderer that connects before any event has been sent
shows whatever `LIVESCAPE_DEFAULT_SCENE` is set to; see
[Configuration](configuration.md).

## Scene changes

A `scene.change` event carries a `transitionMs` hint, `0` to `10000`, with a
default of `900`. The renderer crossfades the outgoing scene over the incoming
one for that duration. Changing to the scene that is already showing still
counts as a change and still crossfades.

## Effects

| Id | Label | Default duration |
| --- | --- | --- |
| `rain` | Rain | until cleared |
| `snow` | Snow | until cleared |
| `fireworks` | Fireworks | 8000 ms |

Effects are Canvas particle systems. Each has a particle budget that scales
linearly with the event's normalized `intensity`:

| Effect | Particles at minimum intensity | At full intensity |
| --- | --- | --- |
| `rain` | 90 | 520 |
| `snow` | 60 | 340 |
| `fireworks` | 1 concurrent burst | 4 concurrent bursts |

Re-triggering an effect that is already running restarts it rather than
stacking a second copy, so a burst of events produces a burst, not a leak.

Timed effects expire on a 250 ms tick in the renderer. The event server tracks
the same deadlines so that a `state.sync` sent to a late client carries the
remaining time rather than the original duration.

`effect.clear` with an `effectId` removes that one effect. With `null`, or with
no payload at all, it clears everything.

## Reduced motion

When the browser reports `prefers-reduced-motion`, the renderer cuts particle
counts to roughly a third of the normal budget. The effect still reads as rain
or snow; it just moves less.

## Adding a scene or effect

The registry is an allowlist, so a new id has to be declared in every place
that guards it:

1. `packages/protocol/registry.json`, which is canonical.
2. The `SCENE_IDS` or `EFFECT_IDS` union in `packages/protocol/src/registry.ts`.
   It throws at import time if the declared union and the JSON disagree.
3. `services/event-server/src/livescape_event_server/registry.json`, the server
   copy. `tests/test_registry.py` fails if the two copies drift.
4. The renderer's `SCENE_COMPONENTS` map (`apps/renderer/src/scenes/index.ts`)
   or `createEffectSystem` (`apps/renderer/src/effects/particles.ts`), with the
   component or particle system itself.

The control panel needs no change: it renders its buttons from the registry.

## Composition planes

Each effect is drawn on one side of the camera subject:

| Effect | Plane |
| --- | --- |
| `rain` | foreground |
| `snow` | foreground |
| `fireworks` | background |

Weather falling between the camera and the subject is what makes a person look
like they are standing inside the scene; fireworks read as distant sky, so they
stay behind. Every effect belongs to exactly one plane, so the two planes
together still draw each active effect exactly once, and with the camera off
the result is unchanged. See [Camera and Compositing](camera.md).
