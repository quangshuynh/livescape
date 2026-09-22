import { ActorPlane } from '../actors/ActorPlane.js';
import type { SceneLayer } from '../actors/types.js';
import { scenePlaneZIndex } from '../compositor/layers.js';
import type { SceneInstance } from './director.js';

export interface ScenePlaneProps {
  readonly layer: SceneLayer;
  readonly instances: readonly SceneInstance[];
}

/**
 * One scene plane on the stage. Each scene on stage contributes a wrapper
 * holding its artwork and its actors for this plane, and the wrappers
 * crossfade exactly as whole scenes used to. Wrappers are keyed by showing,
 * so a scene that starts fading out keeps its DOM and its moving actors.
 */
export function ScenePlane({ layer, instances }: ScenePlaneProps) {
  return (
    <div
      className={`scene-plane scene-plane--${layer}`}
      data-plane={layer}
      style={{ zIndex: scenePlaneZIndex(layer) }}
    >
      {instances.map((instance) => {
        const Art = instance.definition.art[layer];
        const hasActors = instance.engine.spawners.some((spawner) => spawner.layer === layer);
        if (!Art && !hasActors) return null;
        return (
          <div
            key={instance.key}
            className={`scene-layer scene-layer--${instance.role}`}
            data-scene={instance.sceneId}
            style={{ animationDuration: `${Math.max(1, instance.transitionMs)}ms` }}
          >
            {Art ? <Art /> : null}
            {hasActors ? <ActorPlane engine={instance.engine} layer={layer} /> : null}
          </div>
        );
      })}
    </div>
  );
}
