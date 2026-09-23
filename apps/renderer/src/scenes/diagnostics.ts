import { useSyncExternalStore } from 'react';

import type { ActorCounts } from '../actors/engine.js';
import { SCENE_LAYERS } from '../actors/types.js';
import type { SceneActionRecord, SceneDirector } from './director.js';

/** Live actor counts, subscribed to only by the local diagnostics surfaces. */
export function useActorCounts(director: SceneDirector): ActorCounts {
  return useSyncExternalStore(
    director.subscribeActivity,
    director.getActorCounts,
    director.getActorCounts,
  );
}

export function describeActorCounts(counts: ActorCounts): string {
  const layers = SCENE_LAYERS.map((layer) => `${layer} ${counts.byLayer[layer]}`).join(', ');
  return `${counts.total} (${layers}), ${counts.triggered} triggered`;
}

export interface SceneActionDiagnostics {
  readonly last: SceneActionRecord | null;
  /** Actions of the showing scene that are waiting for room or surging. */
  readonly active: readonly string[];
}

/** The latest scene action and any still in progress. Diagnostics only. */
export function useSceneActionDiagnostics(director: SceneDirector): SceneActionDiagnostics {
  const last = useSyncExternalStore(
    director.subscribeActivity,
    () => director.lastAction,
    () => director.lastAction,
  );
  const active = useSyncExternalStore(
    director.subscribeActivity,
    () => director.current.engine.activeActions,
    () => director.current.engine.activeActions,
  );
  return { last, active };
}

export function describeSceneAction(record: SceneActionRecord | null): string {
  return record ? `${record.actionId} (${record.result})` : 'none';
}
