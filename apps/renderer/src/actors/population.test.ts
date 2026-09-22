import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../scenes/random.js';
import { ActorPopulation, createActor, positionAt, REDUCED_MOTION_SPEED } from './population.js';
import { SPRITE_SIZES } from './sprites.js';
import { SCENE_WIDTH, type ActorSpawnerDefinition } from './types.js';
import { MAX_ACTORS_PER_SCENE } from './validate.js';

function spawner(overrides: Partial<ActorSpawnerDefinition> = {}): ActorSpawnerDefinition {
  return {
    id: 'car',
    label: 'Car',
    sprites: ['sedan'],
    layer: 'backdrop',
    behavior: { kind: 'traverse', direction: 'right', baseline: [400, 400], speed: [100, 100] },
    scale: [1, 1],
    spawn: { initialDelayMs: [1000, 1000], intervalMs: [5000, 5000], maxAlive: 4 },
    ...overrides,
  };
}

function population(
  spawners: readonly ActorSpawnerDefinition[],
  { maxActors = 16, reducedMotion = false, seed = 1 } = {},
): ActorPopulation {
  return new ActorPopulation(spawners, { random: mulberry32(seed), maxActors, reducedMotion });
}

const SEDAN = SPRITE_SIZES.sedan;

describe('actor traversal', () => {
  it('crosses the scene from fully off one edge to fully off the other', () => {
    const actor = createActor(spawner(), 1, 0, mulberry32(1));

    expect(actor.from.x).toBe(-SEDAN.width);
    expect(actor.to.x).toBe(SCENE_WIDTH);
    expect(actor.facing).toBe('right');
    // The bottom edge sits on the baseline.
    expect(actor.from.y + actor.height).toBe(400);
  });

  it('moves the other way and faces the other way for a left traverse', () => {
    const behavior = { kind: 'traverse', direction: 'left', baseline: [400, 400], speed: [100, 100] } as const;
    const actor = createActor(spawner({ behavior }), 1, 0, mulberry32(1));

    expect(actor.from.x).toBe(SCENE_WIDTH);
    expect(actor.to.x).toBe(-SEDAN.width);
    expect(actor.facing).toBe('left');
  });

  it('derives its lifetime from speed, and moves linearly within it', () => {
    const actor = createActor(spawner(), 1, 2000, mulberry32(1));
    const distance = SCENE_WIDTH + SEDAN.width;

    expect(actor.lifetimeMs).toBeCloseTo((distance / 100) * 1000);
    expect(positionAt(actor, 2000).x).toBe(-SEDAN.width);
    expect(positionAt(actor, 2000 + actor.lifetimeMs / 2).x).toBeCloseTo(-SEDAN.width + distance / 2);
    // Clamped at both ends.
    expect(positionAt(actor, 0).x).toBe(-SEDAN.width);
    expect(positionAt(actor, 1e9).x).toBe(SCENE_WIDTH);
  });

  it('applies scale to size, and uses the baseline as depth', () => {
    const near = createActor(spawner({ scale: [2, 2] }), 1, 0, mulberry32(1));
    const farBehavior = { kind: 'traverse', direction: 'right', baseline: [340, 340], speed: [100, 100] } as const;
    const far = createActor(spawner({ behavior: farBehavior }), 2, 0, mulberry32(1));

    expect(near.width).toBe(SEDAN.width * 2);
    expect(near.depth).toBeGreaterThan(far.depth);
  });

  it('follows a path behaviour for its configured duration', () => {
    const actor = createActor(
      spawner({
        behavior: {
          kind: 'path',
          from: { x: [10, 10], y: [20, 20] },
          travel: { x: [-300, -300], y: [100, 100] },
          durationMs: [4000, 4000],
        },
      }),
      1,
      0,
      mulberry32(1),
    );

    expect(actor.from).toEqual({ x: 10, y: 20 });
    expect(actor.to).toEqual({ x: -290, y: 120 });
    expect(actor.lifetimeMs).toBe(4000);
    expect(actor.facing).toBe('left');
  });
});

describe('ambient spawning', () => {
  it('spawns nothing before the initial delay, then spawns on schedule', () => {
    const actors = population([spawner()]);
    actors.start(0);

    actors.advance(999);
    expect(actors.actors).toHaveLength(0);
    expect(actors.nextDueAt()).toBe(1000);

    actors.advance(1000);
    expect(actors.actors).toHaveLength(1);
    expect(actors.nextDueAt()).toBe(6000);

    actors.advance(6000);
    expect(actors.actors).toHaveLength(2);
  });

  it('removes an actor once it has left the scene', () => {
    const actors = population([spawner({ spawn: { initialDelayMs: [0, 0], intervalMs: [60000, 60000], maxAlive: 1 } })]);
    actors.start(0);
    actors.advance(0);
    const [actor] = actors.actors;
    if (!actor) throw new Error('expected an actor');

    expect(actors.nextDueAt()).toBeCloseTo(actor.lifetimeMs);
    actors.advance(actor.lifetimeMs - 1);
    expect(actors.actors).toHaveLength(1);

    expect(actors.advance(actor.lifetimeMs)).toBe(true);
    expect(actors.actors).toHaveLength(0);
  });

  it('never exceeds a spawner cap', () => {
    const actors = population([
      spawner({ spawn: { initialDelayMs: [0, 0], intervalMs: [500, 500], maxAlive: 2 } }),
    ]);
    actors.start(0);

    for (let time = 0; time <= 5000; time += 500) actors.advance(time);

    expect(actors.actors).toHaveLength(2);
  });

  it('never exceeds the scene cap, whatever the spawners ask for', () => {
    const many = spawner({
      spawn: { initialDelayMs: [0, 0], intervalMs: [500, 500], burst: [8, 8], maxAlive: MAX_ACTORS_PER_SCENE },
    });
    const capped = population([many], { maxActors: 5 });
    const clamped = population([many, { ...many, id: 'more' }], { maxActors: 1000 });
    capped.start(0);
    clamped.start(0);

    for (let time = 0; time <= 5000; time += 500) {
      capped.advance(time);
      clamped.advance(time);
    }

    expect(capped.actors).toHaveLength(5);
    expect(clamped.actors).toHaveLength(MAX_ACTORS_PER_SCENE);
  });

  it('spawns a burst at once', () => {
    const actors = population([
      spawner({ spawn: { initialDelayMs: [0, 0], intervalMs: [5000, 5000], burst: [3, 3], maxAlive: 6 } }),
    ]);
    actors.start(0);

    actors.advance(0);

    expect(actors.actors).toHaveLength(3);
  });

  it('keeps a lane to one actor, and retries until the lane is clear', () => {
    const car = spawner({ lane: 'near', spawn: { initialDelayMs: [0, 0], intervalMs: [500, 500], maxAlive: 3 } });
    const bus = spawner({ id: 'bus', sprites: ['bus'], lane: 'near', spawn: { initialDelayMs: [100, 100], intervalMs: [500, 500], maxAlive: 1 } });
    const actors = population([car, bus]);
    actors.start(0);
    actors.advance(0);
    const [first] = actors.actors;
    if (!first) throw new Error('expected an actor');

    for (let time = 100; time < first.lifetimeMs; time += 100) actors.advance(time);
    expect(actors.actors).toEqual([first]);

    // The lane frees up when the first actor leaves, and the next one enters.
    for (let time = first.lifetimeMs; time < first.lifetimeMs + 3000; time += 100) actors.advance(time);
    expect(actors.actors).toHaveLength(1);
    expect(actors.actors[0]).not.toBe(first);
  });

  it('does not burst to catch up after a late wake-up', () => {
    const actors = population([
      spawner({ spawn: { initialDelayMs: [0, 0], intervalMs: [1000, 1000], maxAlive: 10 } }),
    ]);
    actors.start(0);

    // A throttled background tab might not wake for a minute.
    actors.advance(60_000);

    expect(actors.actors).toHaveLength(1);
    expect(actors.nextDueAt()).toBe(61_000);
  });

  it('is fully reproducible from a seed', () => {
    const run = (seed: number) => {
      const actors = population(
        [
          spawner({
            behavior: { kind: 'traverse', direction: 'either', baseline: [300, 420], speed: [40, 200] },
            scale: [0.5, 1.5],
            tints: ['#112233', '#445566', '#778899'],
            spawn: { initialDelayMs: [0, 3000], intervalMs: [500, 4000], maxAlive: 8 },
          }),
        ],
        { seed },
      );
      actors.start(0);
      for (let time = 0; time <= 20_000; time += 250) actors.advance(time);
      return actors.actors.map(({ spawnedAt, from, to, facing, tint, width }) => ({
        spawnedAt,
        from,
        to,
        facing,
        tint,
        width,
      }));
    };

    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
    expect(run(42).length).toBeGreaterThan(0);
  });
});

describe('scene lifecycle', () => {
  it('stops spawning when retired but lets current actors finish', () => {
    const actors = population([spawner({ spawn: { initialDelayMs: [0, 0], intervalMs: [500, 500], maxAlive: 4 } })]);
    actors.start(0);
    actors.advance(0);

    actors.retire();
    actors.advance(2000);

    expect(actors.actors).toHaveLength(1);
    expect(actors.spawning).toBe(false);
    actors.advance(1e7);
    expect(actors.actors).toHaveLength(0);
    expect(actors.nextDueAt()).toBeNull();
  });

  it('removes every actor when stopped', () => {
    const actors = population([spawner({ spawn: { initialDelayMs: [0, 0], intervalMs: [500, 500], maxAlive: 4 } })]);
    actors.start(0);
    actors.advance(0);
    actors.advance(500);

    expect(actors.stop()).toBe(true);
    expect(actors.actors).toHaveLength(0);
    expect(actors.nextDueAt()).toBeNull();
  });

  it('refuses on-demand spawns unless the scene is running', () => {
    const actors = population([spawner()]);

    expect(actors.trigger('car', 0)).toHaveLength(0);
    actors.start(0);
    expect(actors.trigger('car', 0)).toHaveLength(1);
    expect(actors.trigger('no-such-spawner', 0)).toHaveLength(0);
    actors.retire();
    expect(actors.trigger('car', 0)).toHaveLength(0);
  });
});

describe('reduced motion', () => {
  it('holds the scene still: no ambient actors are ever spawned', () => {
    const actors = population([spawner()], { reducedMotion: true });
    actors.start(0);

    for (let time = 0; time <= 60_000; time += 1000) actors.advance(time);

    expect(actors.actors).toHaveLength(0);
    expect(actors.nextDueAt()).toBeNull();
  });

  it('removes ambient actors when it is switched on, and resumes when it is switched off', () => {
    const actors = population([spawner({ spawn: { initialDelayMs: [0, 0], intervalMs: [5000, 5000], maxAlive: 4 } })]);
    actors.start(0);
    actors.advance(0);

    expect(actors.setReducedMotion(true, 100)).toBe(true);
    expect(actors.actors).toHaveLength(0);
    expect(actors.spawning).toBe(false);

    actors.setReducedMotion(false, 200);
    actors.advance(200);
    expect(actors.actors).toHaveLength(1);
  });

  it('still allows an explicit spawn, at reduced speed', () => {
    const normal = population([spawner()]);
    const reduced = population([spawner()], { reducedMotion: true });
    normal.start(0);
    reduced.start(0);

    const [fast] = normal.trigger('car', 0);
    const [slow] = reduced.trigger('car', 0);

    expect(slow?.lifetimeMs).toBeCloseTo((fast?.lifetimeMs ?? 0) / REDUCED_MOTION_SPEED);
  });
});
