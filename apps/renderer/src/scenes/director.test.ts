import { describe, expect, it, vi } from 'vitest';

import { FakeClock } from '../test/fakeClock.js';
import { SceneDirector } from './director.js';
import { SCENES } from './index.js';

function director(clock: FakeClock, initialScene: 'city' | 'roadside-workshop' = 'roadside-workshop', reducedMotion = false) {
  return new SceneDirector({ scenes: SCENES, initialScene, reducedMotion, clock });
}

describe('SceneDirector', () => {
  it('shows one scene and runs its actors once started', () => {
    const clock = new FakeClock();
    const scenes = director(clock);

    expect(scenes.getSnapshot()).toHaveLength(1);
    expect(scenes.current.role).toBe('in');
    clock.advance(60_000);
    expect(scenes.current.engine.actors).toHaveLength(0);

    scenes.start();
    clock.advance(60_000);
    expect(scenes.getActorCounts().total).toBeGreaterThan(0);
  });

  it('crossfades: the outgoing scene is retired, kept for the transition, then removed with its actors', () => {
    const clock = new FakeClock();
    const scenes = director(clock);
    scenes.start();
    clock.advance(30_000);
    const outgoing = scenes.current;
    expect(outgoing.engine.actors.length).toBeGreaterThan(0);

    scenes.show('forest', 900);

    const [out, incoming] = scenes.getSnapshot();
    expect(out?.role).toBe('out');
    expect(out?.key).toBe(outgoing.key);
    expect(out?.transitionMs).toBe(900);
    expect(incoming?.sceneId).toBe('forest');
    // Retired: whatever is on screen may finish, but nothing new appears.
    const before = outgoing.engine.actors.length;
    clock.advance(800);
    expect(outgoing.engine.actors.length).toBeLessThanOrEqual(before);

    clock.advance(100);
    expect(scenes.getSnapshot().map((instance) => instance.sceneId)).toEqual(['forest']);
    expect(outgoing.engine.actors).toHaveLength(0);
    expect(outgoing.engine.scheduled).toBe(false);
  });

  it('does nothing when asked for the scene already showing', () => {
    const clock = new FakeClock();
    const scenes = director(clock);
    const listener = vi.fn();
    scenes.subscribe(listener);

    scenes.show('roadside-workshop', 900);

    expect(listener).not.toHaveBeenCalled();
    expect(scenes.getSnapshot()).toHaveLength(1);
  });

  it('never keeps more than two scenes, even when changes arrive mid-transition', () => {
    const clock = new FakeClock();
    const scenes = director(clock, 'city');
    scenes.start();

    scenes.show('forest', 900);
    const forest = scenes.current;
    scenes.show('space', 900);
    scenes.show('roadside-workshop', 900);

    expect(scenes.getSnapshot().map((instance) => instance.sceneId)).toEqual(['space', 'roadside-workshop']);
    expect(forest.engine.scheduled).toBe(false);
  });

  it('gives a scene shown again a fresh showing', () => {
    const clock = new FakeClock();
    const scenes = director(clock, 'city');
    const first = scenes.current;

    scenes.show('forest', 0);
    scenes.show('city', 0);

    expect(scenes.current.sceneId).toBe('city');
    expect(scenes.current.key).not.toBe(first.key);
    expect(scenes.current.engine).not.toBe(first.engine);
  });

  it('cuts immediately for a zero-length transition', () => {
    const clock = new FakeClock();
    const scenes = director(clock);
    scenes.start();

    scenes.show('space', 0);

    expect(scenes.getSnapshot().map((instance) => instance.sceneId)).toEqual(['space']);
  });

  it('holds actors still under reduced motion and in new showings', () => {
    const clock = new FakeClock();
    const scenes = director(clock);
    scenes.start();
    clock.advance(30_000);

    scenes.setReducedMotion(true);
    expect(scenes.getActorCounts().total).toBe(0);
    clock.advance(120_000);
    expect(scenes.getActorCounts().total).toBe(0);

    scenes.show('city', 0);
    clock.advance(60_000);
    expect(scenes.getActorCounts().total).toBe(0);
  });

  it('stops every engine and drops the outgoing scene when stopped', () => {
    const clock = new FakeClock();
    const scenes = director(clock);
    scenes.start();
    clock.advance(30_000);
    scenes.show('city', 900);

    scenes.stop();

    expect(scenes.getSnapshot()).toHaveLength(1);
    expect(scenes.getActorCounts().total).toBe(0);
    expect(clock.pending).toBe(0);

    // A restart, as React's development double-mount does, resumes the scene.
    scenes.start();
    clock.advance(20_000);
    expect(scenes.getActorCounts().total).toBeGreaterThan(0);
  });
});
