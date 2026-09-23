import type { ComponentType } from 'react';
import { actionsForScene, sceneActionEntry, type SceneActionId, type SceneId } from '@livescape/protocol';

import { ActorEngine, type EngineClock } from '../actors/engine.js';
import type { PopulationAction } from '../actors/population.js';
import {
  SCENE_LAYERS,
  type ActorSpawnerDefinition,
  type SceneActionEffect,
  type SceneLayer,
} from '../actors/types.js';
import { MAX_ACTORS_PER_SCENE, validateActionEffect, validateSpawner } from '../actors/validate.js';
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
  /**
   * How this scene performs the registry actions it owns. Keys must be
   * actions the protocol registry assigns to this scene; label and cooldown
   * come from the registry, never from here.
   */
  readonly actions?: Partial<Record<SceneActionId, SceneActionEffect>>;
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
  const spawnerIds = definition.actors.map((spawner) => spawner.id);
  const owned = actionsForScene(definition.id).map((action) => action.id);
  for (const [actionId, effect] of Object.entries(definition.actions ?? {})) {
    if (!(owned as readonly string[]).includes(actionId)) {
      errors.push(`${definition.id}: action "${actionId}" is not one of this scene's registry actions`);
      continue;
    }
    errors.push(
      ...validateActionEffect(actionId, effect, spawnerIds).map((error) => `${definition.id}: ${error}`),
    );
  }
  for (const actionId of owned) {
    if (!definition.actions?.[actionId]) {
      errors.push(`${definition.id}: registry action "${actionId}" is not implemented`);
    }
  }
  return errors;
}

/**
 * The actions a scene can run: registry actions it owns and implements with
 * spawners that passed validation, each with its registry cooldown.
 */
export function sceneActions(
  definition: SceneDefinition,
  spawners: readonly ActorSpawnerDefinition[],
): PopulationAction[] {
  const spawnerIds = spawners.map((spawner) => spawner.id);
  const actions: PopulationAction[] = [];
  for (const entry of actionsForScene(definition.id)) {
    const effect = definition.actions?.[entry.id];
    if (!effect) continue;
    const errors = validateActionEffect(entry.id, effect, spawnerIds);
    if (errors.length > 0) {
      console.warn(`LiveScape: ignoring scene action in ${definition.id}`, errors);
      continue;
    }
    actions.push({ id: entry.id, cooldownMs: sceneActionEntry(entry.id).cooldownMs, effect });
  }
  return actions;
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
    actions: sceneActions(definition, spawners),
    maxActors: definition.maxActors,
    random: options.random ?? mulberry32(definition.seed),
    reducedMotion: options.reducedMotion,
    ...(options.clock ? { clock: options.clock } : {}),
  });
}
