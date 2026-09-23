import { isSpriteId } from './sprites.js';
import { SCENE_LAYERS, type ActorSpawnerDefinition, type Range, type SceneActionEffect } from './types.js';

/** No scene may keep more actors than this alive, whatever it asks for. */
export const MAX_ACTORS_PER_SCENE = 24;
/** Spawners cannot fire faster than this, which bounds timer churn. */
export const MIN_SPAWN_INTERVAL_MS = 500;
export const MAX_BURST = 8;
/** A surge action can never keep a scene busier than this. */
export const MAX_SURGE_MS = 60_000;

const TINT = /^#[0-9a-f]{6}$/i;

function checkRange(
  errors: string[],
  where: string,
  range: Range,
  { min = -Infinity, positive = false, integer = false } = {},
): void {
  const [low, high] = range;
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    errors.push(`${where} must be finite`);
    return;
  }
  if (low > high) errors.push(`${where} is inverted: [${low}, ${high}]`);
  if (low < min) errors.push(`${where} must be at least ${min}`);
  if (positive && low <= 0) errors.push(`${where} must be positive`);
  if (integer && (!Number.isInteger(low) || !Number.isInteger(high))) {
    errors.push(`${where} must be whole numbers`);
  }
}

/**
 * Structural checks a TypeScript type cannot express. A spawner that fails
 * any of them is dropped by the engine instead of being run.
 */
export function validateSpawner(spawner: ActorSpawnerDefinition): string[] {
  const errors: string[] = [];
  const at = (field: string) => `${spawner.id || '<unnamed>'}.${field}`;

  if (!spawner.id) errors.push('spawner id is empty');
  if (!(SCENE_LAYERS as readonly string[]).includes(spawner.layer)) {
    errors.push(`${at('layer')}: unsupported layer "${String(spawner.layer)}"`);
  }
  if (spawner.sprites.length === 0) errors.push(`${at('sprites')} is empty`);
  for (const sprite of spawner.sprites) {
    if (!isSpriteId(sprite)) errors.push(`${at('sprites')}: unknown sprite "${String(sprite)}"`);
  }
  for (const tint of spawner.tints ?? []) {
    if (!TINT.test(tint)) errors.push(`${at('tints')}: "${tint}" is not #rrggbb`);
  }

  checkRange(errors, at('scale'), spawner.scale, { positive: true });
  if (spawner.scale[1] > 4) errors.push(`${at('scale')} must not exceed 4`);
  if (spawner.opacity) {
    checkRange(errors, at('opacity'), spawner.opacity, { min: 0 });
    if (spawner.opacity[1] > 1) errors.push(`${at('opacity')} must not exceed 1`);
  }

  const { behavior } = spawner;
  if (behavior.kind === 'traverse') {
    checkRange(errors, at('behavior.speed'), behavior.speed, { positive: true });
    checkRange(errors, at('behavior.baseline'), behavior.baseline);
    if (!['left', 'right', 'either'].includes(behavior.direction)) {
      errors.push(`${at('behavior.direction')}: unsupported "${String(behavior.direction)}"`);
    }
  } else if (behavior.kind === 'path') {
    checkRange(errors, at('behavior.from.x'), behavior.from.x);
    checkRange(errors, at('behavior.from.y'), behavior.from.y);
    checkRange(errors, at('behavior.travel.x'), behavior.travel.x);
    checkRange(errors, at('behavior.travel.y'), behavior.travel.y);
    checkRange(errors, at('behavior.durationMs'), behavior.durationMs, { positive: true });
  } else {
    errors.push(`${at('behavior')}: unsupported kind "${String((behavior as { kind: unknown }).kind)}"`);
  }

  const { spawn } = spawner;
  if (spawn.initialDelayMs && spawn.intervalMs) {
    checkRange(errors, at('spawn.initialDelayMs'), spawn.initialDelayMs, { min: 0 });
    checkRange(errors, at('spawn.intervalMs'), spawn.intervalMs, { min: MIN_SPAWN_INTERVAL_MS });
  } else if (spawn.initialDelayMs || spawn.intervalMs) {
    errors.push(`${at('spawn')}: an ambient spawner needs both initialDelayMs and intervalMs`);
  }
  if (spawn.burst) {
    checkRange(errors, at('spawn.burst'), spawn.burst, { min: 1, integer: true });
    if (spawn.burst[1] > MAX_BURST) errors.push(`${at('spawn.burst')} must not exceed ${MAX_BURST}`);
  }
  if (
    !Number.isInteger(spawn.maxAlive) ||
    spawn.maxAlive < 1 ||
    spawn.maxAlive > MAX_ACTORS_PER_SCENE
  ) {
    errors.push(`${at('spawn.maxAlive')} must be a whole number from 1 to ${MAX_ACTORS_PER_SCENE}`);
  }

  return errors;
}

/**
 * Checks a scene's implementation of one action against the spawners it can
 * actually use. An action that fails is left out; requesting it is then
 * answered as unsupported.
 */
export function validateActionEffect(
  actionId: string,
  effect: SceneActionEffect,
  spawnerIds: readonly string[],
): string[] {
  const errors: string[] = [];
  if (effect.spawners.length === 0) errors.push(`${actionId}: names no spawner`);
  for (const id of effect.spawners) {
    if (!spawnerIds.includes(id)) errors.push(`${actionId}: unknown spawner "${id}"`);
  }
  if (effect.kind === 'surge') {
    if (!Number.isFinite(effect.durationMs) || effect.durationMs <= 0 || effect.durationMs > MAX_SURGE_MS) {
      errors.push(`${actionId}.durationMs must be positive and at most ${MAX_SURGE_MS}`);
    }
    checkRange(errors, `${actionId}.intervalMs`, effect.intervalMs, { min: MIN_SPAWN_INTERVAL_MS });
  } else if (effect.kind !== 'spawn') {
    errors.push(`${actionId}: unsupported kind "${String((effect as { kind: unknown }).kind)}"`);
  }
  return errors;
}
