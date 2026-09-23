import { REGISTRY, SCENE_IDS } from '@livescape/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { ActorSpawnerDefinition } from '../actors/types.js';
import { createSceneEngine, validateSceneDefinition, type SceneDefinition } from './definition.js';
import { SCENES } from './index.js';

const VALID: ActorSpawnerDefinition = {
  id: 'car',
  label: 'Car',
  sprites: ['sedan'],
  layer: 'backdrop',
  behavior: { kind: 'traverse', direction: 'right', baseline: [380, 390], speed: [100, 150] },
  scale: [1, 1],
  spawn: { initialDelayMs: [0, 1000], intervalMs: [5000, 9000], maxAlive: 1 },
};

function scene(actors: readonly ActorSpawnerDefinition[], extra: Partial<SceneDefinition> = {}): SceneDefinition {
  return { id: 'city', seed: 1, art: {}, actors, maxActors: 8, ...extra };
}

describe('shipped scene definitions', () => {
  it('defines every scene in the protocol registry, and nothing else', () => {
    expect(Object.keys(SCENES).sort()).toEqual([...SCENE_IDS].sort());
    for (const id of SCENE_IDS) expect(SCENES[id].id).toBe(id);
  });

  it.each(SCENE_IDS)('%s is valid', (id) => {
    expect(validateSceneDefinition(SCENES[id])).toEqual([]);
  });

  it('keeps the existing scenes recognisable', () => {
    // City, Forest and Space keep their artwork on the planes behind the
    // subject; nothing of theirs moves in front of a person.
    for (const id of ['city', 'forest', 'space'] as const) {
      expect(SCENES[id].art.backdrop).toBeDefined();
      expect(SCENES[id].art.foreground).toBeUndefined();
      expect(SCENES[id].actors.every((actor) => actor.layer !== 'foreground')).toBe(true);
    }
  });

  it('reproduces the city traffic cycle as actors', () => {
    const streaks = SCENES.city.actors;
    expect(streaks.map((actor) => actor.spawn.intervalMs)).toEqual([
      [9000, 9000],
      [13000, 13000],
    ]);
    expect(streaks.map((actor) => actor.behavior.kind === 'traverse' && actor.behavior.direction)).toEqual([
      'right',
      'left',
    ]);
  });

  it('gives Roadside Workshop actors behind the environment, beside the subject and in front of it', () => {
    const layers = new Set(SCENES['roadside-workshop'].actors.map((actor) => actor.layer));
    expect(layers).toEqual(new Set(['backdrop', 'environment', 'foreground']));
    expect(SCENES['roadside-workshop'].art).toHaveProperty('foreground');
  });
});

describe('validateSceneDefinition', () => {
  it('rejects an unsupported layer', () => {
    const errors = validateSceneDefinition(
      scene([{ ...VALID, layer: 'overlay' as ActorSpawnerDefinition['layer'] }]),
    );
    expect(errors.join()).toContain('unsupported layer "overlay"');
  });

  it('rejects artwork for an unsupported layer', () => {
    const errors = validateSceneDefinition(scene([], { art: { ceiling: () => null } as SceneDefinition['art'] }));
    expect(errors.join()).toContain('unsupported layer "ceiling"');
  });

  it('rejects an unknown sprite', () => {
    const errors = validateSceneDefinition(
      scene([{ ...VALID, sprites: ['dragon' as ActorSpawnerDefinition['sprites'][number]] }]),
    );
    expect(errors.join()).toContain('unknown sprite "dragon"');
  });

  it('rejects inverted, non-finite and non-positive ranges', () => {
    const errors = validateSceneDefinition(
      scene([
        {
          ...VALID,
          scale: [2, 1],
          behavior: { kind: 'traverse', direction: 'right', baseline: [0, Infinity], speed: [0, 10] },
        },
      ]),
    ).join('\n');
    expect(errors).toContain('car.scale is inverted');
    expect(errors).toContain('car.behavior.baseline must be finite');
    expect(errors).toContain('car.behavior.speed must be positive');
  });

  it('rejects spawn rules that could run away', () => {
    const errors = validateSceneDefinition(
      scene([
        {
          ...VALID,
          spawn: { initialDelayMs: [0, 0], intervalMs: [10, 10], burst: [1.5, 20], maxAlive: 0 },
        },
      ]),
    ).join('\n');
    expect(errors).toContain('intervalMs must be at least 500');
    expect(errors).toContain('burst must be whole numbers');
    expect(errors).toContain('burst must not exceed');
    expect(errors).toContain('maxAlive must be a whole number');
  });

  it('rejects duplicate spawner ids, bad tints and an oversized scene cap', () => {
    const errors = validateSceneDefinition(
      scene([VALID, { ...VALID, tints: ['red'] }], { maxActors: 500 }),
    ).join('\n');
    expect(errors).toContain('duplicate spawner id "car"');
    expect(errors).toContain('"red" is not #rrggbb');
    expect(errors).toContain('maxActors must be a whole number');
  });
});

describe('scene actions in definitions', () => {
  it('implements every registry action in its owning scene, and no others', () => {
    for (const action of REGISTRY.actions) {
      expect(SCENES[action.sceneId].actions?.[action.id], action.id).toBeDefined();
    }
    const implemented = SCENE_IDS.flatMap((id) => Object.keys(SCENES[id].actions ?? {}));
    expect(implemented.sort()).toEqual(REGISTRY.actions.map((action) => action.id).sort());
  });

  it('keeps Roadside street actions behind the subject and the gust in front', () => {
    const roadside = SCENES['roadside-workshop'];
    const layerOf = (id: string) => roadside.actors.find((spawner) => spawner.id === id)?.layer;
    const spawnersOf = (actionId: keyof NonNullable<SceneDefinition['actions']>) =>
      roadside.actions?.[actionId]?.spawners ?? [];

    for (const actionId of ['roadside.send-car', 'roadside.send-bus', 'roadside.pedestrians', 'roadside.rush-hour'] as const) {
      for (const id of spawnersOf(actionId)) expect(layerOf(id), `${actionId} ${id}`).toBe('backdrop');
    }
    expect(spawnersOf('roadside.blow-leaves').map(layerOf)).toEqual(['foreground']);
  });

  it('rejects an action the scene does not own, one it leaves out, and one naming an unknown spawner', () => {
    const errors = validateSceneDefinition({
      ...SCENES.space,
      actions: {
        'roadside.send-bus': { kind: 'spawn', spawners: ['meteor'] },
      },
    }).join('\n');
    expect(errors).toContain('"roadside.send-bus" is not one of this scene\'s registry actions');
    expect(errors).toContain('registry action "space.shooting-star" is not implemented');

    const unknown = validateSceneDefinition({
      ...SCENES.space,
      actions: { 'space.shooting-star': { kind: 'spawn', spawners: ['comet'] } },
    }).join('\n');
    expect(unknown).toContain('unknown spawner "comet"');
  });

  it('leaves out an action whose spawner was dropped, instead of running it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = {
      ...SCENES.space,
      actors: SCENES.space.actors.map((spawner) => ({ ...spawner, sprites: ['ufo'] })),
    } as unknown as SceneDefinition;

    const engine = createSceneEngine(broken, { reducedMotion: false });
    engine.start();

    expect(engine.actionIds).toEqual([]);
    expect(engine.act('space.shooting-star')).toBe('unsupported');
    warn.mockRestore();
  });

  it('takes each action\'s cooldown from the registry', () => {
    const engine = createSceneEngine(SCENES.space, { reducedMotion: false });
    engine.start();
    expect(engine.actionIds).toEqual(['space.shooting-star']);
    expect(engine.act('space.shooting-star')).toBe('started');
    expect(engine.act('space.shooting-star')).toBe('cooldown');
  });
});

describe('createSceneEngine', () => {
  it('drops an invalid spawner instead of running it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = createSceneEngine(
      scene([VALID, { ...VALID, id: 'broken', speed: undefined, behavior: { kind: 'teleport' } } as unknown as ActorSpawnerDefinition]),
      { reducedMotion: false },
    );

    expect(engine.spawners.map((spawner) => spawner.id)).toEqual(['car']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
