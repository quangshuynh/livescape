# Scenes and Effects

A **scene** is the environment the renderer draws around the subject. An
**effect** is an overlay triggered by an event. Both are enumerated in the
registry, and only ids that appear there can ever be rendered.

## Scenes

| Id | Label | Description |
| --- | --- | --- |
| `city` | City | Night skyline with drifting traffic light and window glow. |
| `forest` | Forest | Layered treeline with slow parallax drift and soft daylight. |
| `space` | Space | Deep field starscape with a slow nebula gradient. |
| `roadside-workshop` | Roadside Workshop | Open workshop at golden hour with traffic and passers-by on the street outside. |

`city` is the default. A renderer that connects before any event has been sent
shows whatever `LIVESCAPE_DEFAULT_SCENE` is set to; see
[Configuration](configuration.md).

## Composition

The renderer composites a fixed stack of planes, back to front:

```text
backdrop            scene: the far world (sky, street) and its actors
environment         scene: the near set around the subject and its actors
vignette            scene framing
background effects  effects that belong behind the subject
camera subject      the local camera feed, raw or segmented
foreground          scene: artwork and actors in front of the subject
foreground effects  effects in front of everything in the scene
debug / setup       local only, never in the OBS output
```

The camera subject is the boundary. A scene decides what it puts on each of its
three planes, `backdrop`, `environment` and `foreground`, and that decides what
passes behind or in front of a person. The order is defined once, in
`apps/renderer/src/compositor/layers.ts`, and every layer takes its z-index
from it.

With the camera off the subject plane is empty and the stack reads as one
picture, so a scene looks the same with or without a camera.

### Scene definitions

Each scene is a `SceneDefinition` in `apps/renderer/src/scenes/index.ts`:

* **Artwork per plane.** Plain components with no props, drawn in CSS and SVG.
  Slow ambient motion (a swaying lamp, drifting clouds) is CSS animation inside
  the artwork.
* **Actor spawners.** Everything that moves across the scene on its own
  schedule is declared as data and run by the shared actor engine.
* **A seed and an actor cap.**

Every scene is authored on a 960x540 canvas scaled to cover the stage and
anchored bottom-centre. Artwork and actors share that coordinate system, so a
car drawn on a road stays on the road at any output size or aspect ratio.

### Actors

An actor spawner is a small typed record, not code:

| Field | Meaning |
| --- | --- |
| `sprites` | One or more ids from the sprite allowlist (`actors/sprites.ts`) |
| `layer` | `backdrop`, `environment` or `foreground` |
| `behavior` | `traverse` (cross the scene left, right or either way, on a baseline, at a speed) or `path` (a straight line from a start region over a duration) |
| `scale`, `opacity`, `tints` | Ranges and colour choices, picked per actor |
| `spawn` | Initial delay, interval, optional burst size, and a per-spawner cap |
| `lane` | Optional. Spawners sharing a lane never overlap on screen |

There are exactly two behaviours, and a scene cannot supply its own. Every
random choice comes from a generator seeded per scene showing, so the same
sequence of scene changes produces the same traffic. The tests inject their own
generator and clock.

Within a plane, actors stack by the depth of their ground line: lower on screen
reads as nearer, so a car in the near lane always passes in front of a bus in
the far lane.

Bounds hold whatever a definition asks for:

* no scene keeps more than 24 actors alive, and each scene sets a lower cap;
* each spawner has its own cap, and fires no more often than every 500 ms;
* an actor is removed as soon as its path ends;
* a spawner that wakes late (a throttled background tab) spawns once, and never
  bursts to catch up;
* a definition that fails validation has the offending spawner dropped, with a
  console warning, rather than breaking the renderer.

The engine exposes an internal `trigger(spawnerId)` that spawns one actor within
the same caps. The setup panel uses it for development. It is also the hook a
future event-driven action ("send a bus past") would use, but no event reaches
it today and the protocol is unchanged.

### Scene changes

A `scene.change` event carries a `transitionMs` hint, `0` to `10000`, with a
default of `900`. The renderer crossfades every plane of the outgoing scene
into the incoming one over that duration.

When a scene starts to fade out it stops spawning, its actors on screen keep
moving, and when the crossfade ends the scene is removed along with every actor
it owned. At most two scenes exist at once, even when changes arrive faster
than the transition. Changing to the scene that is already showing does
nothing.

Scene changes never touch the camera. The scene system and the camera share no
state, so switching scenes neither reopens the camera nor restarts
segmentation.

### Performance

Composition is designed to add as little as possible to a renderer that is
already running segmentation:

* Each actor's whole path is known when it spawns, so it is handed to the
  browser as a single linear transform animation. The browser runs these on the
  compositor, so traffic keeps moving smoothly while segmentation occupies the
  main thread.
* There is no per-frame JavaScript for actors. Each scene's engine runs one
  timer that wakes only when a spawn or a removal is due.
* React re-renders a plane only when one of its actors is added or removed.
* Actor positions are percentages of the actor's own box, so nothing is ever
  measured.

Measured in the Claude desktop app's built-in Chromium at 1920x1080, with
segmentation running on synthetic input and MediaPipe on the GPU: Roadside
Workshop held 60 fps (99th-percentile frame 18.7 ms, no long tasks) with no
effects. With rain and fireworks both at full intensity it held 53 fps, and City
under the same load held 43 fps, so the cost at that point is the effects and
the scene artwork rather than the actors. OBS itself has not been measured.

## Roadside Workshop

The view from inside an open workshop, out through the roll-up door to a street
at golden hour.

| Plane | Artwork | Actors |
| --- | --- | --- |
| `backdrop` | Sky, the shops across the street, the road and sidewalks | Cars in two lanes, a bus, a cyclist, pedestrians on both sidewalks, birds |
| `environment` | Workshop walls, the door frame, floor, pegboard, shelves, a clock, a pendant lamp | A cat crossing the floor |
| `foreground` | Bench corner with a mug and vise, a toolbox, a hanging plant | Leaves blowing across in front of the subject |

The street is only ever seen through the doorway, so vehicles pass behind the
door frame and behind the subject. The cat crosses behind the subject and
behind the foreground toolbox; the leaves cross in front of everything but the
weather. Ambient motion is sparse on purpose: a car every few seconds, a bus
every minute or two, a gust of leaves every half minute.

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

### Effect planes

Each effect is drawn on one side of the subject:

| Effect | Plane |
| --- | --- |
| `rain` | foreground effects |
| `snow` | foreground effects |
| `fireworks` | background effects |

Weather falling between the camera and the subject is what makes a person look
like they are standing inside the scene. Fireworks read as distant sky, so they
stay behind. Effects are not scene-aware: fireworks are drawn over the whole of
a scene's backdrop and environment, including the walls of Roadside Workshop,
and rain falls indoors there too. See [Camera and Compositing](camera.md).

## Reduced motion

When the browser reports `prefers-reduced-motion`:

* scenes are held still: CSS ambience stops, and no ambient actors spawn. Any
  actors already moving are removed the moment the preference turns on, and
  ambient motion resumes when it turns off;
* particle effects keep running at roughly a third of their normal budget and
  a slower speed, because they were asked for by an event;
* an actor spawned on demand still appears, at half speed;
* scene crossfades are cut to a single frame.

## Assets

All scene and actor artwork is original to LiveScape, drawn inline in SVG and
CSS in this repository. There is no third-party artwork, no image file, no web
font and no network request for any of it. New artwork should follow the same
rule; anything else needs a licence compatible with the repository and an
attribution next to it.

## Adding a scene or effect

The registry is an allowlist, so a new id has to be declared in every place
that guards it:

1. `packages/protocol/registry.json`, which is canonical.
2. The `SCENE_IDS` or `EFFECT_IDS` union in `packages/protocol/src/registry.ts`.
   It throws at import time if the declared union and the JSON disagree.
3. `services/event-server/src/livescape_event_server/registry.json` and the
   matching `Literal` in `registry.py`. `tests/test_registry.py` fails if the
   copies drift.
4. The renderer: a `SceneDefinition` in `SCENES`
   (`apps/renderer/src/scenes/index.ts`), or a particle system in
   `createEffectSystem` (`apps/renderer/src/effects/particles.ts`) plus its
   entry in `EFFECT_PLANE`.

A new actor sprite is added to `SPRITE_SIZES` in `actors/sprites.ts` and drawn
in `actors/SpriteArt.tsx`. The shipped definitions are validated by the test
suite.

The control panel needs no change: it renders its buttons from the registry.

## Limitations

* Actors move in straight lines at constant speed. There is no easing, no
  stopping, no interaction between actors other than lane exclusivity, and no
  physics.
* Effects do not know about scenes, so weather and fireworks ignore a scene's
  indoor or outdoor framing.
* Scene planes are ordered around the subject, not around parts of it: nothing
  can pass between a person's arm and body.
* A scene's appearance depends on the subject's position. Roadside Workshop is
  composed for a subject roughly centred, with the street at shoulder height;
  the setup panel's framing controls move the subject, not the scene.
