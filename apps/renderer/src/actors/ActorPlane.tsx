import { memo, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';

import type { ActorEngine } from './engine.js';
import { actorTransform, positionAt } from './population.js';
import { SpriteArt } from './SpriteArt.js';
import { SCENE_HEIGHT, SCENE_WIDTH, type ActorInstance, type SceneLayer } from './types.js';

interface ActorViewProps {
  readonly actor: ActorInstance;
  readonly now: () => number;
}

const ActorView = memo(function ActorView({ actor, now }: ActorViewProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const elapsed = Math.min(actor.lifetimeMs, Math.max(0, now() - actor.spawnedAt));

    // The whole path is known at spawn, so it is handed to the browser as one
    // linear animation. Transform animations run on the compositor thread and
    // keep moving smoothly while segmentation occupies the main thread.
    if (typeof element.animate === 'function') {
      const animation = element.animate(
        [
          { transform: actorTransform(actor, actor.from) },
          { transform: actorTransform(actor, actor.to) },
        ],
        { duration: actor.lifetimeMs, easing: 'linear', fill: 'both' },
      );
      animation.currentTime = elapsed;
      return () => animation.cancel();
    }
    element.style.transform = actorTransform(actor, positionAt(actor, actor.spawnedAt + elapsed));
    return undefined;
  }, [actor, now]);

  const style: CSSProperties = {
    width: `${(actor.width / SCENE_WIDTH) * 100}%`,
    height: `${(actor.height / SCENE_HEIGHT) * 100}%`,
    opacity: actor.opacity,
    zIndex: actor.depth,
    transform: actorTransform(actor, actor.from),
  };

  return (
    <div
      ref={ref}
      className={`actor actor--${actor.sprite}`}
      data-actor-id={actor.id}
      data-spawner={actor.spawnerId}
      data-layer={actor.layer}
      data-facing={actor.facing}
      data-triggered={actor.triggered ? 'true' : undefined}
      style={style}
    >
      <div className={actor.facing === 'left' ? 'actor__body actor__body--flipped' : 'actor__body'}>
        <SpriteArt sprite={actor.sprite} tint={actor.tint} variant={actor.id} />
      </div>
    </div>
  );
});

export interface ActorPlaneProps {
  readonly engine: ActorEngine;
  readonly layer: SceneLayer;
}

/**
 * The actors one scene has on one plane. It re-renders only when an actor is
 * added or removed on this plane, never per frame.
 */
export function ActorPlane({ engine, layer }: ActorPlaneProps) {
  const actors = useSyncExternalStore(
    engine.subscribe,
    () => engine.actorsIn(layer),
    () => engine.actorsIn(layer),
  );
  const now = engine.clockNow;

  return (
    <div className="scene-frame actor-plane" data-layer={layer}>
      {actors.map((actor) => (
        <ActorView key={actor.id} actor={actor} now={now} />
      ))}
    </div>
  );
}
