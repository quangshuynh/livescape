import type { ComponentType } from 'react';
import type { SceneId } from '@livescape/protocol';

import { ActorEngine, type EngineClock } from '../actors/engine.js';
import { SCENE_LAYERS, type ActorSpawnerDefinition, type SceneLayer } from '../actors/types.js';
import { MAX_ACTORS_PER_SCENE, validateSpawner } from '../actors/validate.js';
import { mulberry32 } from './random.js';

/** Static artwork per plane. Each is a plain component with no props. */
export type SceneArt = Partial<Record<SceneLayer, ComponentType>>;

/**
 * Everything the renderer needs to compose a scene.
 *
 * The artwork is ordinary repository-authored markup. Everything that moves on
 * its own schedule is declared in `actors` as data and run by the shared actor
 * engine, so a scene cannot introduce its own animation loop or timers.
 */
export interface SceneDefinition {
  readonly id: SceneId;
  /** Seeds the scene's actor randomness, so a scene behaves reproducibly. */
  readonly seed: number;
  readonly art: SceneArt;
  readonly actors: readonly ActorSpawnerDefinition[];
  /** Upper bound on live actors; clamped to `MAX_ACTORS_PER_SCENE`. */
  readonly maxActors: number;
}

export function validateSceneDefinition(definition: SceneDefinition): string[] {
  const errors: string[] = [];
  for (const layer of Object.keys(definition.art)) {
    if (!(SCENE_LAYERS as readonly string[]).includes(layer)) {
      errors.push(`${definition.id}: art for unsupported layer "${layer}"`);
    }
  }
  if (
    !Number.isInteger(definition.maxActors) ||
    definition.maxActors < 0 ||
    definition.maxActors > MAX_ACTORS_PER_SCENE
  ) {
    errors.push(`${definition.id}: maxActors must be a whole number from 0 to ${MAX_ACTORS_PER_SCENE}`);
  }
  const seen = new Set<string>();
  for (const spawner of definition.actors) {
    if (seen.has(spawner.id)) errors.push(`${definition.id}: duplicate spawner id "${spawner.id}"`);
    seen.add(spawner.id);
    errors.push(...validateSpawner(spawner).map((error) => `${definition.id}: ${error}`));
  }
  return errors;
}

export interface SceneEngineOptions {
  readonly reducedMotion: boolean;
  readonly random?: () => number;
  readonly clock?: EngineClock;
}

/**
 * Builds the actor engine for one showing of a scene. A spawner that fails
 * validation is left out rather than allowed to break the renderer.
 */
export function createSceneEngine(
  definition: SceneDefinition,
  options: SceneEngineOptions,
): ActorEngine {
  const spawners = definition.actors.filter((spawner) => {
    const errors = validateSpawner(spawner);
    if (errors.length > 0) {
      console.warn(`LiveScape: ignoring actor spawner in ${definition.id}`, errors);
    }
    return errors.length === 0;
  });
  return new ActorEngine({
    spawners,
    maxActors: definition.maxActors,
    random: options.random ?? mulberry32(definition.seed),
    reducedMotion: options.reducedMotion,
    ...(options.clock ? { clock: options.clock } : {}),
  });
}
