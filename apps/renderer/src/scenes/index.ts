import type { SceneId } from '@livescape/protocol';

import type { ActorSpawnerDefinition } from '../actors/types.js';
import { CityBackdrop } from './CityScene.js';
import type { SceneDefinition } from './definition.js';
import { ForestBackdrop, ForestEnvironment } from './ForestScene.js';
import { SpaceBackdrop } from './SpaceScene.js';

/**
 * City traffic: two light streaks on the street, each crossing on a fixed
 * cycle. The timings reproduce the original looping CSS streaks (a 9 s and a
 * 13 s cycle, of which about 2 s is spent off screen).
 */
const CITY_ACTORS: readonly ActorSpawnerDefinition[] = [
  {
    id: 'headlights',
    label: 'Headlight streak',
    sprites: ['light-streak'],
    layer: 'backdrop',
    behavior: { kind: 'traverse', direction: 'right', baseline: [526, 526], speed: [171, 171] },
    scale: [1, 1],
    opacity: [0.85, 0.85],
    tints: ['#ffc480'],
    spawn: { initialDelayMs: [0, 0], intervalMs: [9000, 9000], maxAlive: 1 },
  },
  {
    id: 'taillights',
    label: 'Taillight streak',
    sprites: ['light-streak'],
    layer: 'backdrop',
    behavior: { kind: 'traverse', direction: 'left', baseline: [509, 509], speed: [118, 118] },
    scale: [1, 1],
    opacity: [0.7, 0.7],
    tints: ['#ff6a6a'],
    spawn: { initialDelayMs: [0, 0], intervalMs: [13000, 13000], maxAlive: 1 },
  },
];

/** Scene ids resolve only through this map -- nothing else can be rendered. */
export const SCENES: Record<SceneId, SceneDefinition> = {
  city: {
    id: 'city',
    seed: 20260101,
    art: { backdrop: CityBackdrop },
    actors: CITY_ACTORS,
    maxActors: 2,
  },
  forest: {
    id: 'forest',
    seed: 4212,
    art: { backdrop: ForestBackdrop, environment: ForestEnvironment },
    actors: [],
    maxActors: 0,
  },
  space: {
    id: 'space',
    seed: 31337,
    art: { backdrop: SpaceBackdrop },
    actors: [],
    maxActors: 0,
  },
};
