import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SceneId } from '@livescape/protocol';

import type { EngineClock } from '../actors/engine.js';
import type { SceneDefinition } from './definition.js';
import { SceneDirector, type SceneInstance } from './director.js';
import { SCENES } from './index.js';

export interface SceneDirectorHookOptions {
  readonly scenes?: Readonly<Record<SceneId, SceneDefinition>>;
  readonly clock?: EngineClock | undefined;
}

/**
 * Binds a `SceneDirector` to React. Scene changes arrive as renderer state;
 * the director turns them into scene showings with their own actor engines.
 */
export function useSceneDirector(
  sceneId: SceneId,
  transitionMs: number,
  reducedMotion: boolean,
  options: SceneDirectorHookOptions = {},
): { director: SceneDirector; instances: readonly SceneInstance[] } {
  const [director] = useState(
    () =>
      new SceneDirector({
        scenes: options.scenes ?? SCENES,
        initialScene: sceneId,
        reducedMotion,
        ...(options.clock ? { clock: options.clock } : {}),
      }),
  );

  useEffect(() => {
    director.start();
    return () => director.stop();
  }, [director]);

  useEffect(() => {
    director.show(sceneId, transitionMs);
  }, [director, sceneId, transitionMs]);

  useEffect(() => {
    director.setReducedMotion(reducedMotion);
  }, [director, reducedMotion]);

  const instances = useSyncExternalStore(director.subscribe, director.getSnapshot, director.getSnapshot);
  return { director, instances };
}
