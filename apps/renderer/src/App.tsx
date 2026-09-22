import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { LiveScapeEvent } from '@livescape/protocol';

import { debugOverlayEnabled, resolveWsUrl } from './config.js';
import { EffectsLayer } from './effects/EffectsLayer.js';
import { useReducedMotion, useSceneTransition } from './hooks.js';
import { initialRendererState, rendererReducer } from './rendererState.js';
import { SCENE_COMPONENTS } from './scenes/index.js';
import { useEventStream } from './useEventStream.js';

const EXPIRY_TICK_MS = 250;

export function App() {
  const [state, dispatch] = useReducer(rendererReducer, initialRendererState);
  const wsUrl = useMemo(() => resolveWsUrl(), []);
  const showDebug = useMemo(() => debugOverlayEnabled(), []);
  const reducedMotion = useReducedMotion();

  const onEvent = useCallback((event: LiveScapeEvent) => {
    dispatch({ type: 'event', event, now: Date.now() });
  }, []);

  const status = useEventStream(wsUrl, onEvent);

  const hasTimedEffect = state.effects.some((effect) => effect.expiresAt !== null);
  useEffect(() => {
    if (!hasTimedEffect) return;
    const timer = setInterval(() => dispatch({ type: 'expire', now: Date.now() }), EXPIRY_TICK_MS);
    return () => clearInterval(timer);
  }, [hasTimedEffect]);

  const outgoingSceneId = useSceneTransition(state.sceneId, state.transitionMs);
  const CurrentScene = SCENE_COMPONENTS[state.sceneId];
  const OutgoingScene = outgoingSceneId ? SCENE_COMPONENTS[outgoingSceneId] : null;
  const transitionStyle = { animationDuration: `${Math.max(1, state.transitionMs)}ms` };

  return (
    <div className="stage" data-scene={state.sceneId} data-connection={status}>
      {OutgoingScene && outgoingSceneId ? (
        <div key={`out-${outgoingSceneId}`} className="scene-layer scene-layer--out" style={transitionStyle}>
          <OutgoingScene />
        </div>
      ) : null}
      <div key={state.sceneId} className="scene-layer scene-layer--in" style={transitionStyle}>
        <CurrentScene />
      </div>
      <div className="stage__vignette" aria-hidden="true" />
      <EffectsLayer effects={state.effects} reducedMotion={reducedMotion} />
      {showDebug ? <DebugOverlay wsUrl={wsUrl} status={status} sceneId={state.sceneId} effects={state.effects.map((effect) => effect.effectId)} /> : null}
    </div>
  );
}

interface DebugOverlayProps {
  readonly wsUrl: string;
  readonly status: string;
  readonly sceneId: string;
  readonly effects: readonly string[];
}

/**
 * Development-only overlay, enabled with `?debug=1`. It is deliberately off by
 * default so the OBS Browser Source shows nothing but the scene.
 */
function DebugOverlay({ wsUrl, status, sceneId, effects }: DebugOverlayProps) {
  return (
    <aside className="debug-overlay">
      <p className="debug-overlay__row">
        <span className={`debug-overlay__dot debug-overlay__dot--${status}`} />
        {status}
      </p>
      <p className="debug-overlay__row">scene: {sceneId}</p>
      <p className="debug-overlay__row">effects: {effects.length > 0 ? effects.join(', ') : 'none'}</p>
      <p className="debug-overlay__row debug-overlay__row--muted">{wsUrl}</p>
    </aside>
  );
}
