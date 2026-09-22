import { useSyncExternalStore } from 'react';

import type { ActorCounts } from '../actors/engine.js';
import { SCENE_LAYERS } from '../actors/types.js';
import type { SceneDirector } from './director.js';

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
  return `${counts.total} (${layers})`;
}
