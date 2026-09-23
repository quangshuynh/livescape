import { describe, expect, it } from 'vitest';

import { mulberry32 } from '../scenes/random.js';
import { FakeClock } from '../test/fakeClock.js';
import { ActorEngine } from './engine.js';
import {
  ACTION_PENDING_MS,
  ActorPopulation,
  COOLDOWN_TOLERANCE_MS,
  expiresAt,
  REDUCED_MOTION_ACTION_BURST,
  REDUCED_MOTION_SPEED,
  type PopulationAction,
} from './population.js';
import type { ActorSpawnerDefinition } from './types.js';
import { validateActionEffect, validateSpawner } from './validate.js';

/** A small street: one ambient lane, an on-demand bus, a gust in front. */
const SPAWNERS: readonly ActorSpawnerDefinition[] = [
  {
    id: 'traffic',
    label: 'Car',
    sprites: ['sedan'],
    layer: 'backdrop',
    lane: 'street',
    behavior: { kind: 'traverse', direction: 'right', baseline: [380, 380], speed: [200, 200] },
    scale: [1, 1],
    spawn: { initialDelayMs: [60_000, 60_000], intervalMs: [60_000, 60_000], maxAlive: 1 },
  },
  {
    id: 'bus',
    label: 'Bus',
    sprites: ['bus'],
    layer: 'backdrop',
    lane: 'street',
    behavior: { kind: 'traverse', direction: 'right', baseline: [380, 380], speed: [100, 100] },
    scale: [1, 1],
    spawn: { maxAlive: 1 },
  },
  {
    id: 'gust',
    label: 'Gust',
    sprites: ['leaf'],
    layer: 'foreground',
    behavior: {
      kind: 'path',
      from: { x: [-40, -40], y: [100, 200] },
      travel: { x: [1100, 1100], y: [100, 100] },
      durationMs: [4000, 4000],
    },
    scale: [2, 2],
    spawn: { burst: [6, 6], maxAlive: 8 },
  },
  {
    id: 'walkers',
    label: 'Walker',
    sprites: ['pedestrian'],
    layer: 'backdrop',
    behavior: { kind: 'traverse', direction: 'right', baseline: [400, 400], speed: [40, 40] },
    scale: [1, 1],
    spawn: { maxAlive: 3 },
  },
];

const ACTIONS: readonly PopulationAction[] = [
  { id: 'send-car', cooldownMs: 1500, effect: { kind: 'spawn', spawners: ['traffic'] } },
  { id: 'send-bus', cooldownMs: 8000, effect: { kind: 'spawn', spawners: ['bus'] } },
  { id: 'blow-leaves', cooldownMs: 3000, effect: { kind: 'spawn', spawners: ['gust'] } },
  {
    id: 'rush-hour',
    cooldownMs: 30_000,
    effect: { kind: 'surge', spawners: ['walkers'], durationMs: 20_000, intervalMs: [1000, 1000] },
  },
];

function population({ reducedMotion = false, maxActors = 24 } = {}): ActorPopulation {
  const actors = new ActorPopulation(SPAWNERS, {
    random: mulberry32(3),
    maxActors,
    reducedMotion,
    actions: ACTIONS,
  });
  actors.start(0);
  return actors;
}

function engine(clock: FakeClock, reducedMotion = false): ActorEngine {
  const actors = new ActorEngine({
    spawners: SPAWNERS,
    actions: ACTIONS,
    maxActors: 24,
    random: mulberry32(3),
    reducedMotion,
    clock,
  });
  actors.start();
  return actors;
}

describe('scene action definitions', () => {
  it('accepts a spawner with no ambient schedule, and rejects half of one', () => {
    expect(validateSpawner(SPAWNERS[1] as ActorSpawnerDefinition)).toEqual([]);
    const half = { ...SPAWNERS[0], spawn: { intervalMs: [1000, 1000], maxAlive: 1 } } as ActorSpawnerDefinition;
    expect(validateSpawner(half).join()).toContain('needs both initialDelayMs and intervalMs');
  });

  it('only lets an action name spawners the scene declares, and bounds surges', () => {
    const ids = SPAWNERS.map((spawner) => spawner.id);
    expect(validateActionEffect('ok', { kind: 'spawn', spawners: ['bus'] }, ids)).toEqual([]);
    expect(validateActionEffect('x', { kind: 'spawn', spawners: ['dragon'] }, ids).join()).toContain('unknown spawner');
    expect(validateActionEffect('x', { kind: 'spawn', spawners: [] }, ids).join()).toContain('names no spawner');
    const endless = { kind: 'surge', spawners: ['walkers'], durationMs: 3_600_000, intervalMs: [1000, 1000] } as const;
    expect(validateActionEffect('x', endless, ids).join()).toContain('durationMs');
    const frantic = { kind: 'surge', spawners: ['walkers'], durationMs: 1000, intervalMs: [10, 10] } as const;
    expect(validateActionEffect('x', frantic, ids).join()).toContain('intervalMs');
  });

  it('never spawns an on-demand spawner on its own', () => {
    const actors = population();
    for (let now = 0; now <= 50_000; now += 500) actors.advance(now);
    expect(actors.actors.filter((actor) => actor.spawnerId !== 'traffic')).toEqual([]);
  });
});

describe('spawn actions', () => {
  it('spawns immediately, off screen, marked as triggered', () => {
    const actors = population();

    expect(actors.act('send-bus', 100)).toBe('started');

    const [bus] = actors.actors;
    expect(bus?.spawnerId).toBe('bus');
    expect(bus?.triggered).toBe(true);
    expect(bus?.layer).toBe('backdrop');
    expect(bus?.spawnedAt).toBe(100);
    // Enters fully off the left edge and leaves fully off the right.
    expect(bus?.from.x).toBe(-(bus?.width ?? 0));
    expect(bus?.to.x).toBe(960);
  });

  it('puts a foreground action on the foreground plane', () => {
    const actors = population();

    actors.act('blow-leaves', 0);

    expect(actors.actors).toHaveLength(6);
    expect(actors.actors.every((actor) => actor.layer === 'foreground' && actor.triggered)).toBe(true);
  });

  it('removes triggered actors once they have left', () => {
    const actors = population();
    actors.act('send-bus', 0);
    const end = expiresAt(actors.actors[0]!);

    actors.advance(end - 1);
    expect(actors.actors).toHaveLength(1);
    actors.advance(end);
    expect(actors.actors).toHaveLength(0);
    expect(actors.nextDueAt()).toBe(60_000); // only the ambient schedule is left
  });

  it('refuses an id the scene does not implement', () => {
    const actors = population();
    expect(actors.act('roadside.send-tank', 0)).toBe('unsupported');
    expect(actors.actors).toHaveLength(0);
  });

  it('does nothing in a scene that is fading out or stopped', () => {
    const actors = population();
    actors.retire();
    expect(actors.act('send-bus', 0)).toBe('inactive');
    actors.stop();
    expect(actors.act('send-bus', 0)).toBe('inactive');
    expect(actors.actors).toHaveLength(0);
  });
});

describe('cooldowns', () => {
  it('drops a repeat inside the cooldown and accepts it once the cooldown ends', () => {
    const actors = population();

    expect(actors.act('send-car', 0)).toBe('started');
    expect(actors.act('send-car', 500)).toBe('cooldown');
    // The renderer allows a little delivery jitter on top of the server's check.
    expect(actors.act('send-car', 1500 - COOLDOWN_TOLERANCE_MS - 1)).toBe('cooldown');
    // The first car is still in the lane, so this one waits for it.
    expect(actors.act('send-car', 1500 - COOLDOWN_TOLERANCE_MS)).toBe('queued');
  });

  it('keeps cooldowns per action', () => {
    const actors = population();
    expect(actors.act('blow-leaves', 0)).toBe('started');
    expect(actors.act('send-bus', 1)).toBe('started');
    expect(actors.act('blow-leaves', 2)).toBe('cooldown');
  });
});

describe('waiting for room', () => {
  it('holds a blocked spawn until its lane clears, ahead of the ambient spawner', () => {
    const actors = population();
    actors.act('send-bus', 0);
    const busGone = expiresAt(actors.actors[0]!);

    expect(actors.act('send-car', 100)).toBe('queued');
    expect(actors.actors).toHaveLength(1);
    expect(actors.nextDueAt()).toBe(100 + ACTION_PENDING_MS);

    // The bus is on screen longer than the wait, so this request gives up.
    actors.advance(100 + ACTION_PENDING_MS);
    expect(actors.actors.map((actor) => actor.spawnerId)).toEqual(['bus']);
    actors.advance(busGone);
    expect(actors.actors).toHaveLength(0);
  });

  it('spawns a waiting action the moment room appears', () => {
    const actors = population();
    actors.act('send-car', 0);
    const carGone = expiresAt(actors.actors[0]!);
    expect(carGone).toBeLessThan(ACTION_PENDING_MS + 2000);

    expect(actors.act('send-bus', 2000)).toBe('queued');
    actors.advance(carGone);

    expect(actors.actors.map((actor) => [actor.spawnerId, actor.spawnedAt])).toEqual([['bus', carGone]]);
    expect(actors.activeActions).toEqual([]);
  });

  it('merges further requests into the one waiting slot', () => {
    const actors = population();
    actors.act('send-bus', 0);
    expect(actors.act('send-car', 0)).toBe('queued');
    expect(actors.act('send-car', 1600)).toBe('coalesced');
    expect(actors.act('send-car', 3200)).toBe('coalesced');
    expect(actors.activeActions).toEqual(['send-car']);
  });
});

describe('surges', () => {
  it('runs for its duration inside the caps, then restores ambient behaviour', () => {
    const actors = population();

    expect(actors.act('rush-hour', 0)).toBe('started');
    expect(actors.activeActions).toEqual(['rush-hour']);
    let most = 0;
    for (let now = 0; now < 20_000; now += 250) {
      actors.advance(now);
      most = Math.max(most, actors.actors.filter((actor) => actor.spawnerId === 'walkers').length);
    }
    expect(most).toBe(3); // the spawner's maxAlive

    actors.advance(20_000);
    expect(actors.activeActions).toEqual([]);
    const count = actors.actors.length;
    actors.advance(25_000);
    expect(actors.actors.length).toBeLessThanOrEqual(count);
    expect(actors.nextDueAt()).not.toBeNull();
  });

  it('absorbs a repeat while it is running instead of extending it', () => {
    const actors = new ActorPopulation(SPAWNERS, {
      random: mulberry32(3),
      maxActors: 24,
      reducedMotion: false,
      actions: [{ ...ACTIONS[3]!, cooldownMs: 1000 }],
    });
    actors.start(0);
    actors.act('rush-hour', 0);

    expect(actors.act('rush-hour', 5000)).toBe('coalesced');
    actors.advance(20_000);
    expect(actors.activeActions).toEqual([]);
  });
});

describe('scene changes', () => {
  it('cancels waiting and surging actions when the scene retires', () => {
    const actors = population();
    actors.act('send-bus', 0);
    actors.act('send-car', 0);
    actors.act('rush-hour', 0);
    expect(actors.activeActions).toEqual(['rush-hour', 'send-car']);

    actors.retire();

    expect(actors.activeActions).toEqual([]);
    // Only the actors on screen remain to finish; nothing new is due.
    const lastExit = Math.max(...actors.actors.map(expiresAt));
    expect(actors.nextDueAt()).toBeLessThanOrEqual(lastExit);
    actors.advance(lastExit);
    expect(actors.actors).toHaveLength(0);
    expect(actors.nextDueAt()).toBeNull();
  });
});

describe('reduced motion', () => {
  it('still performs a one-shot action, slower and smaller', () => {
    const actors = population({ reducedMotion: true });
    const normal = population();

    expect(actors.act('blow-leaves', 0)).toBe('started');
    normal.act('blow-leaves', 0);

    expect(actors.actors).toHaveLength(REDUCED_MOTION_ACTION_BURST);
    expect(actors.actors[0]?.lifetimeMs).toBeCloseTo((normal.actors[0]?.lifetimeMs ?? 0) / REDUCED_MOTION_SPEED);
  });

  it('refuses a sustained surge', () => {
    const actors = population({ reducedMotion: true });
    expect(actors.act('rush-hour', 0)).toBe('reduced-motion');
    expect(actors.activeActions).toEqual([]);
    expect(actors.actors).toHaveLength(0);
  });

  it('ends a running surge and drops triggered actors when switched on', () => {
    const actors = population();
    actors.act('rush-hour', 0);
    actors.act('send-bus', 0);

    actors.setReducedMotion(true, 100);

    expect(actors.actors).toHaveLength(0);
    expect(actors.activeActions).toEqual([]);
    expect(actors.nextDueAt()).toBeNull();
  });
});

describe('bursts', () => {
  it('turns fifty simultaneous requests for one action into one bus', () => {
    const clock = new FakeClock();
    const actors = engine(clock);

    const outcomes = Array.from({ length: 50 }, () => actors.act('send-bus'));

    expect(outcomes.filter((outcome) => outcome === 'started')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'cooldown')).toHaveLength(49);
    expect(actors.actors).toHaveLength(1);
    expect(clock.pending).toBe(1);
  });

  it('stays bounded under a long, mixed stream of requests', () => {
    const clock = new FakeClock();
    const actors = engine(clock);
    const ids = [...ACTIONS.map((action) => action.id), 'unknown'];
    let started = 0;
    let most = 0;

    // Five requests every 100 ms for two minutes: 6000 requests.
    for (let tick = 0; tick < 1200; tick += 1) {
      for (let index = 0; index < 5; index += 1) {
        if (actors.act(ids[(tick + index) % ids.length]!) === 'started') started += 1;
      }
      clock.advance(100);
      most = Math.max(most, actors.actors.length);
      expect(clock.pending).toBeLessThanOrEqual(1);
      expect(actors.activeActions.length).toBeLessThanOrEqual(ACTIONS.length);
    }

    // Cooldowns alone cap what can start: 120 s of each action at its rate.
    const ceiling = ACTIONS.reduce((sum, action) => sum + Math.ceil(120_000 / (action.cooldownMs - COOLDOWN_TOLERANCE_MS)), 0);
    expect(started).toBeLessThanOrEqual(ceiling);
    // Per-spawner caps bound what is on screen: 1 lane + 8 leaves + 3 walkers.
    expect(most).toBeLessThanOrEqual(12);

    // Once the stream stops, everything leaves and only the ambient timer remains.
    clock.advance(60_000);
    expect(actors.counts().triggered).toBe(0);
    expect(actors.activeActions).toEqual([]);
    expect(clock.pending).toBe(1);
  });

  it('respects the scene-wide actor cap', () => {
    const actors = population({ maxActors: 4 });
    actors.act('blow-leaves', 0);
    expect(actors.actors).toHaveLength(4);
    expect(actors.act('send-bus', 0)).toBe('queued');
    expect(actors.actors).toHaveLength(4);
  });
});

describe('ActorEngine.act', () => {
  it('publishes spawned actors to their plane and counts them as triggered', () => {
    const clock = new FakeClock();
    const actors = engine(clock);

    actors.act('blow-leaves');
    actors.act('send-bus');

    expect(actors.actorsIn('foreground')).toHaveLength(6);
    expect(actors.actorsIn('backdrop')).toHaveLength(1);
    expect(actors.counts()).toMatchObject({ total: 7, triggered: 7 });
  });

  it('runs a surge on its single timer and clears it when stopped', () => {
    const clock = new FakeClock();
    const actors = engine(clock);
    actors.act('rush-hour');
    expect(actors.activeActions).toEqual(['rush-hour']);
    expect(clock.pending).toBe(1);

    clock.advance(5000);
    expect(actors.actorsIn('backdrop').length).toBeGreaterThan(0);

    actors.stop();
    expect(actors.actors).toHaveLength(0);
    expect(actors.activeActions).toEqual([]);
    expect(clock.pending).toBe(0);
  });
});
