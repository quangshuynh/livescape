import type { SceneActionId, SceneId } from '@livescape/protocol';

import type { ActorSpawnerDefinition, SceneActionEffect } from '../actors/types.js';
import { CityBackdrop } from './CityScene.js';
import type { SceneDefinition } from './definition.js';
import { ForestBackdrop, ForestEnvironment } from './ForestScene.js';
import { RoadsideBackdrop, RoadsideEnvironment, RoadsideForeground } from './RoadsideWorkshop.js';
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

const CAR_PAINT = ['#b8503b', '#2f6690', '#e0b64f', '#7f9f6d', '#ece6d6', '#3b3d46', '#8c5a7a'];
const CLOTHES = ['#c8553d', '#3d6e8f', '#e0b84c', '#6d8f5a', '#e9e2d0', '#7a4f6d', '#2f3542'];

/**
 * Roadside Workshop. Two traffic lanes (near lane left to right, far lane
 * right to left), two sidewalks, the occasional bus, cyclist and flock of
 * birds behind the door; a cat inside the workshop; leaves blowing in front
 * of the subject. The last three spawners only run for scene actions.
 */
const ROADSIDE_ACTORS: readonly ActorSpawnerDefinition[] = [
  {
    id: 'near-traffic',
    label: 'Car, near lane',
    sprites: ['sedan', 'hatchback', 'van'],
    layer: 'backdrop',
    lane: 'near',
    behavior: { kind: 'traverse', direction: 'right', baseline: [383, 385], speed: [150, 200] },
    scale: [0.96, 1.04],
    tints: CAR_PAINT,
    spawn: { initialDelayMs: [1500, 4000], intervalMs: [7000, 15000], maxAlive: 1 },
  },
  {
    id: 'far-traffic',
    label: 'Car, far lane',
    sprites: ['sedan', 'hatchback', 'van'],
    layer: 'backdrop',
    lane: 'far',
    behavior: { kind: 'traverse', direction: 'left', baseline: [344, 346], speed: [115, 150] },
    scale: [0.78, 0.84],
    tints: CAR_PAINT,
    spawn: { initialDelayMs: [5000, 9000], intervalMs: [9000, 18000], maxAlive: 1 },
  },
  {
    id: 'bus',
    label: 'Bus',
    sprites: ['bus'],
    layer: 'backdrop',
    lane: 'far',
    behavior: { kind: 'traverse', direction: 'left', baseline: [346, 346], speed: [80, 95] },
    scale: [0.8, 0.8],
    tints: ['#e7dcc2', '#d9a441', '#5f8f8a'],
    spawn: { initialDelayMs: [20000, 30000], intervalMs: [55000, 95000], maxAlive: 1 },
  },
  {
    id: 'cyclist',
    label: 'Cyclist',
    sprites: ['cyclist'],
    layer: 'backdrop',
    lane: 'near',
    behavior: { kind: 'traverse', direction: 'right', baseline: [386, 386], speed: [60, 75] },
    scale: [1, 1],
    tints: CLOTHES,
    spawn: { initialDelayMs: [15000, 30000], intervalMs: [40000, 80000], maxAlive: 1 },
  },
  {
    id: 'far-walkers',
    label: 'Pedestrian, far sidewalk',
    sprites: ['pedestrian'],
    layer: 'backdrop',
    behavior: { kind: 'traverse', direction: 'either', baseline: [306, 309], speed: [16, 22] },
    scale: [0.62, 0.68],
    tints: CLOTHES,
    spawn: { initialDelayMs: [3000, 8000], intervalMs: [12000, 26000], maxAlive: 2 },
  },
  {
    id: 'near-walkers',
    label: 'Pedestrian, near sidewalk',
    sprites: ['pedestrian'],
    layer: 'backdrop',
    behavior: { kind: 'traverse', direction: 'either', baseline: [400, 402], speed: [34, 44] },
    scale: [0.95, 1.02],
    tints: CLOTHES,
    spawn: { initialDelayMs: [12000, 22000], intervalMs: [28000, 55000], maxAlive: 1 },
  },
  {
    id: 'birds',
    label: 'Birds',
    sprites: ['bird'],
    layer: 'backdrop',
    behavior: { kind: 'traverse', direction: 'left', baseline: [100, 160], speed: [70, 100] },
    scale: [0.9, 1.3],
    tints: ['#3b3230'],
    spawn: { initialDelayMs: [8000, 18000], intervalMs: [30000, 60000], burst: [2, 4], maxAlive: 4 },
  },
  {
    id: 'cat',
    label: 'Workshop cat',
    sprites: ['cat'],
    layer: 'environment',
    behavior: { kind: 'traverse', direction: 'either', baseline: [506, 510], speed: [38, 48] },
    scale: [1, 1.1],
    tints: ['#2b2724', '#8a6a4e', '#d8cbb6'],
    spawn: { initialDelayMs: [30000, 50000], intervalMs: [80000, 150000], maxAlive: 1 },
  },
  {
    id: 'leaves',
    label: 'Blown leaves',
    sprites: ['leaf'],
    layer: 'foreground',
    behavior: {
      kind: 'path',
      from: { x: [-70, -20], y: [60, 260] },
      travel: { x: [1020, 1100], y: [120, 260] },
      durationMs: [5000, 8000],
    },
    scale: [1.8, 2.8],
    tints: ['#c8702e', '#d9a13b', '#9c4a2a', '#8a8f3a'],
    spawn: { initialDelayMs: [10000, 18000], intervalMs: [24000, 48000], burst: [2, 4], maxAlive: 6 },
  },
  // On request only: these have no ambient schedule and are spawned by the
  // scene actions below.
  {
    id: 'near-bus',
    label: 'Bus, near lane',
    sprites: ['bus'],
    layer: 'backdrop',
    lane: 'near',
    behavior: { kind: 'traverse', direction: 'right', baseline: [385, 385], speed: [85, 95] },
    scale: [0.94, 0.94],
    tints: ['#e7dcc2', '#d9a441', '#5f8f8a'],
    spawn: { maxAlive: 1 },
  },
  {
    id: 'walker-group',
    label: 'Group of pedestrians',
    sprites: ['pedestrian'],
    layer: 'backdrop',
    // Staggered starts off the left edge, slightly different paces, so the
    // group strings out along the near sidewalk instead of walking in step.
    behavior: {
      kind: 'path',
      from: { x: [-150, -30], y: [327, 330] },
      travel: { x: [1060, 1160], y: [0, 0] },
      durationMs: [24000, 30000],
    },
    scale: [0.95, 1.02],
    tints: CLOTHES,
    spawn: { burst: [2, 3], maxAlive: 3 },
  },
  {
    id: 'gust',
    label: 'Gust of leaves',
    sprites: ['leaf'],
    layer: 'foreground',
    behavior: {
      kind: 'path',
      from: { x: [-140, -30], y: [30, 300] },
      travel: { x: [1080, 1200], y: [80, 220] },
      durationMs: [3200, 4800],
    },
    scale: [2, 3.2],
    tints: ['#c8702e', '#d9a13b', '#9c4a2a', '#8a8f3a'],
    spawn: { burst: [6, 8], maxAlive: 10 },
  },
];

/**
 * Roadside Workshop's scene actions. Street actions stay on the backdrop
 * plane, behind the subject; the gust uses the foreground plane, in front.
 */
const ROADSIDE_ACTIONS = {
  'roadside.send-car': { kind: 'spawn', spawners: ['near-traffic', 'far-traffic'] },
  'roadside.send-bus': { kind: 'spawn', spawners: ['bus', 'near-bus'] },
  'roadside.pedestrians': { kind: 'spawn', spawners: ['walker-group'] },
  'roadside.blow-leaves': { kind: 'spawn', spawners: ['gust'] },
  'roadside.rush-hour': {
    kind: 'surge',
    spawners: ['near-traffic', 'far-traffic', 'far-walkers', 'near-walkers', 'walker-group'],
    durationMs: 20_000,
    intervalMs: [900, 1800],
  },
} as const satisfies Partial<Record<SceneActionId, SceneActionEffect>>;

/** Forest has no ambient actors; a flock crosses only when asked for. */
const FOREST_ACTORS: readonly ActorSpawnerDefinition[] = [
  {
    id: 'flock',
    label: 'Bird flock',
    sprites: ['bird'],
    layer: 'backdrop',
    behavior: { kind: 'traverse', direction: 'left', baseline: [70, 170], speed: [85, 115] },
    scale: [1.1, 1.6],
    tints: ['#2e2a26'],
    spawn: { burst: [5, 8], maxAlive: 8 },
  },
];

/** Space has no ambient actors; a meteor streaks past only when asked for. */
const SPACE_ACTORS: readonly ActorSpawnerDefinition[] = [
  {
    id: 'meteor',
    label: 'Shooting star',
    sprites: ['light-streak'],
    layer: 'backdrop',
    behavior: {
      kind: 'path',
      from: { x: [960, 1000], y: [30, 140] },
      travel: { x: [-1260, -1180], y: [70, 120] },
      durationMs: [1600, 2200],
    },
    scale: [0.8, 1.1],
    tints: ['#ffffff', '#d6e6ff'],
    spawn: { maxAlive: 2 },
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
    actors: FOREST_ACTORS,
    maxActors: 8,
    actions: { 'forest.bird-flock': { kind: 'spawn', spawners: ['flock'] } },
  },
  space: {
    id: 'space',
    seed: 31337,
    art: { backdrop: SpaceBackdrop },
    actors: SPACE_ACTORS,
    maxActors: 2,
    actions: { 'space.shooting-star': { kind: 'spawn', spawners: ['meteor'] } },
  },
  'roadside-workshop': {
    id: 'roadside-workshop',
    seed: 6021,
    art: {
      backdrop: RoadsideBackdrop,
      environment: RoadsideEnvironment,
      foreground: RoadsideForeground,
    },
    actors: ROADSIDE_ACTORS,
    maxActors: 24,
    actions: ROADSIDE_ACTIONS,
  },
};
