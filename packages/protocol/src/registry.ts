import registryJson from '../registry.json';

/**
 * The registry is the explicit allowlist of everything the renderer knows how
 * to display. Nothing outside of it can ever reach the renderer: the event
 * server rejects unknown ids and the renderer ignores them defensively.
 */

export const SCENE_IDS = ['city', 'forest', 'space', 'roadside-workshop'] as const;
export const EFFECT_IDS = ['rain', 'snow', 'fireworks'] as const;
export const EVENT_SOURCES = ['manual', 'simulation', 'system'] as const;

export type SceneId = (typeof SCENE_IDS)[number];
export type EffectId = (typeof EFFECT_IDS)[number];
export type EventSource = (typeof EVENT_SOURCES)[number];

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

export interface Registry {
  readonly protocolVersion: number;
  readonly scenes: readonly SceneEntry[];
  readonly effects: readonly EffectEntry[];
  readonly sources: readonly EventSource[];
}

export const REGISTRY = registryJson as Registry;

export const PROTOCOL_VERSION = REGISTRY.protocolVersion;

export const DEFAULT_SCENE_ID: SceneId = 'city';

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
assertIdsMatch(EVENT_SOURCES, REGISTRY.sources, 'event source');

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && (SCENE_IDS as readonly string[]).includes(value);
}

export function isEffectId(value: unknown): value is EffectId {
  return typeof value === 'string' && (EFFECT_IDS as readonly string[]).includes(value);
}

export function isEventSource(value: unknown): value is EventSource {
  return typeof value === 'string' && (EVENT_SOURCES as readonly string[]).includes(value);
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
