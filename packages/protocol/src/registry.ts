import registryJson from '../registry.json';

/**
 * The registry is the explicit allowlist of everything the renderer knows how
 * to display. Nothing outside of it can ever reach the renderer: the event
 * server rejects unknown ids and the renderer ignores them defensively.
 */

export const SCENE_IDS = ['city', 'forest', 'space', 'roadside-workshop'] as const;
export const EFFECT_IDS = ['rain', 'snow', 'fireworks'] as const;
export const EVENT_SOURCES = ['manual', 'simulation', 'system'] as const;
/**
 * Scene actions: named, predefined things a scene can be asked to do once,
 * such as sending a bus down the street. An action id selects a capability the
 * renderer already has; it never describes behaviour.
 */
export const SCENE_ACTION_IDS = [
  'roadside.send-car',
  'roadside.send-bus',
  'roadside.pedestrians',
  'roadside.blow-leaves',
  'roadside.rush-hour',
  'forest.bird-flock',
  'space.shooting-star',
] as const;

export type SceneId = (typeof SCENE_IDS)[number];
export type EffectId = (typeof EFFECT_IDS)[number];
export type EventSource = (typeof EVENT_SOURCES)[number];
export type SceneActionId = (typeof SCENE_ACTION_IDS)[number];

export interface RegistryEntry<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly description: string;
}

export type SceneEntry = RegistryEntry<SceneId>;

export interface EffectEntry extends RegistryEntry<EffectId> {
  /** `null` means the effect runs until it is explicitly cleared. */
  readonly defaultDurationMs: number | null;
}

export interface SceneActionEntry extends RegistryEntry<SceneActionId> {
  /** The only scene this action applies to. */
  readonly sceneId: SceneId;
  /** Minimum time between two accepted requests for this action. */
  readonly cooldownMs: number;
}

export interface Registry {
  readonly protocolVersion: number;
  readonly scenes: readonly SceneEntry[];
  readonly effects: readonly EffectEntry[];
  readonly actions: readonly SceneActionEntry[];
  readonly sources: readonly EventSource[];
}

export const REGISTRY = registryJson as Registry;

export const PROTOCOL_VERSION = REGISTRY.protocolVersion;

export const DEFAULT_SCENE_ID: SceneId = 'city';

/** Bounds on a registry action cooldown, shared with the event server. */
export const MIN_ACTION_COOLDOWN_MS = 250;
export const MAX_ACTION_COOLDOWN_MS = 60_000;

function assertIdsMatch(declared: readonly string[], fromJson: readonly string[], what: string): void {
  const a = [...declared].sort().join(',');
  const b = [...fromJson].sort().join(',');
  if (a !== b) {
    throw new Error(`registry.json drifted from the declared ${what} union: [${b}] vs [${a}]`);
  }
}

// Fail loudly at import time rather than silently serving ids the types deny.
assertIdsMatch(
  SCENE_IDS,
  REGISTRY.scenes.map((scene) => scene.id),
  'scene id',
);
assertIdsMatch(
  EFFECT_IDS,
  REGISTRY.effects.map((effect) => effect.id),
  'effect id',
);
assertIdsMatch(
  SCENE_ACTION_IDS,
  REGISTRY.actions.map((action) => action.id),
  'scene action id',
);
assertIdsMatch(EVENT_SOURCES, REGISTRY.sources, 'event source');
for (const action of REGISTRY.actions) {
  if (!(SCENE_IDS as readonly string[]).includes(action.sceneId)) {
    throw new Error(`registry.json action ${action.id} names an unknown scene: ${action.sceneId}`);
  }
  if (
    !Number.isInteger(action.cooldownMs) ||
    action.cooldownMs < MIN_ACTION_COOLDOWN_MS ||
    action.cooldownMs > MAX_ACTION_COOLDOWN_MS
  ) {
    throw new Error(`registry.json action ${action.id} has an out-of-range cooldownMs`);
  }
}

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && (SCENE_IDS as readonly string[]).includes(value);
}

export function isEffectId(value: unknown): value is EffectId {
  return typeof value === 'string' && (EFFECT_IDS as readonly string[]).includes(value);
}

export function isEventSource(value: unknown): value is EventSource {
  return typeof value === 'string' && (EVENT_SOURCES as readonly string[]).includes(value);
}

export function isSceneActionId(value: unknown): value is SceneActionId {
  return typeof value === 'string' && (SCENE_ACTION_IDS as readonly string[]).includes(value);
}

export function sceneEntry(id: SceneId): SceneEntry {
  const entry = REGISTRY.scenes.find((scene) => scene.id === id);
  if (!entry) throw new Error(`unknown scene id: ${id}`);
  return entry;
}

export function effectEntry(id: EffectId): EffectEntry {
  const entry = REGISTRY.effects.find((effect) => effect.id === id);
  if (!entry) throw new Error(`unknown effect id: ${id}`);
  return entry;
}

export function sceneActionEntry(id: SceneActionId): SceneActionEntry {
  const entry = REGISTRY.actions.find((action) => action.id === id);
  if (!entry) throw new Error(`unknown scene action id: ${id}`);
  return entry;
}

/** The actions a scene owns, in registry order. */
export function actionsForScene(sceneId: SceneId): readonly SceneActionEntry[] {
  return REGISTRY.actions.filter((action) => action.sceneId === sceneId);
}
