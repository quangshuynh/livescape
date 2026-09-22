import { describe, expect, it, vi } from 'vitest';

import { mulberry32 } from '../scenes/random.js';
import { FakeClock } from '../test/fakeClock.js';
import { ActorEngine } from './engine.js';
import type { ActorSpawnerDefinition } from './types.js';

function spawner(id: string, layer: ActorSpawnerDefinition['layer']): ActorSpawnerDefinition {
  return {
    id,
    label: id,
    sprites: ['leaf'],
    layer,
    behavior: { kind: 'traverse', direction: 'right', baseline: [100, 100], speed: [100, 100] },
    scale: [1, 1],
    spawn: { initialDelayMs: [1000, 1000], intervalMs: [4000, 4000], maxAlive: 2 },
  };
}

function engine(clock: FakeClock, spawners = [spawner('back', 'backdrop'), spawner('front', 'foreground')]) {
  return new ActorEngine({ spawners, maxActors: 16, random: mulberry32(7), reducedMotion: false, clock });
}

describe('ActorEngine', () => {
  it('runs on a single timer that only wakes when something is due', () => {
    const clock = new FakeClock();
    const actors = engine(clock);

    actors.start();
    expect(clock.pending).toBe(1);

    clock.advance(999);
    expect(actors.actors).toHaveLength(0);
    clock.advance(1);
    expect(actors.actors).toHaveLength(2);
    expect(clock.pending).toBe(1);
  });

  it('files actors by plane and keeps an unchanged plane snapshot identical', () => {
    const clock = new FakeClock();
    const actors = engine(clock, [spawner('back', 'backdrop')]);
    actors.start();
    const emptyFront = actors.actorsIn('foreground');

    clock.advance(1000);

    expect(actors.actorsIn('backdrop')).toHaveLength(1);
    expect(actors.actorsIn('foreground')).toBe(emptyFront);
    expect(actors.counts()).toEqual({
      total: 1,
      byLayer: { backdrop: 1, environment: 0, foreground: 0 },
    });
  });

  it('notifies subscribers only when the population changes', () => {
    const clock = new FakeClock();
    const actors = engine(clock);
    const listener = vi.fn();
    actors.subscribe(listener);
    actors.start();

    clock.advance(500);
    expect(listener).not.toHaveBeenCalled();
    clock.advance(500);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('cleans up actors as they leave, and cancels its timer when stopped', () => {
    const clock = new FakeClock();
    const actors = engine(clock);
    actors.start();
    clock.advance(1000);
    const lifetime = actors.actors[0]?.lifetimeMs ?? 0;

    clock.advance(lifetime);
    // The first pair left; a second pair spawned at 5000 ms is still crossing.
    expect(actors.actors.every((actor) => actor.spawnedAt === 5000)).toBe(true);

    actors.stop();
    expect(actors.actors).toHaveLength(0);
    expect(clock.pending).toBe(0);
    clock.advance(60_000);
    expect(actors.actors).toHaveLength(0);
  });

  it('does not accumulate timers over a long run', () => {
    const clock = new FakeClock();
    const actors = engine(clock);
    actors.start();

    for (let minute = 0; minute < 60; minute += 1) {
      clock.advance(60_000);
      expect(clock.pending).toBe(1);
      expect(actors.actors.length).toBeLessThanOrEqual(4);
    }
  });

  it('spawns on demand and reports how many actors it added', () => {
    const clock = new FakeClock();
    const actors = engine(clock);
    actors.start();

    expect(actors.trigger('front')).toBe(1);
    expect(actors.actorsIn('foreground')).toHaveLength(1);
    expect(actors.trigger('unknown')).toBe(0);
  });

  it('clears actors when reduced motion is switched on', () => {
    const clock = new FakeClock();
    const actors = engine(clock);
    actors.start();
    clock.advance(1000);

    actors.setReducedMotion(true);

    expect(actors.actors).toHaveLength(0);
    expect(clock.pending).toBe(0);
  });
});
