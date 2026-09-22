import type { SceneId } from '@livescape/protocol';

import type { ActorSpawnerDefinition } from '../actors/types.js';
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
 * of the subject.
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
  'roadside-workshop': {
    id: 'roadside-workshop',
    seed: 6021,
    art: {
      backdrop: RoadsideBackdrop,
      environment: RoadsideEnvironment,
      foreground: RoadsideForeground,
    },
    actors: ROADSIDE_ACTORS,
    maxActors: 16,
  },
};
