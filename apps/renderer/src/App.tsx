import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { LiveScapeEvent } from '@livescape/protocol';

import { useCamera } from './camera/useCamera.js';
import type { MediaDevicesLike } from './camera/media.js';
import { CameraLayer } from './compositor/CameraLayer.js';
import { EMPTY_COMPOSITOR_STATS, type CompositorStats } from './compositor/stats.js';
import { debugOverlayEnabled, resolveWsUrl, setupPanelEnabled } from './config.js';
import { EffectsLayer } from './effects/EffectsLayer.js';
import { useReducedMotion, useSceneTransition } from './hooks.js';
import { initialRendererState, rendererReducer } from './rendererState.js';
import { SCENE_COMPONENTS } from './scenes/index.js';
import type { SegmenterFactory } from './segmentation/types.js';
import { SetupPanel } from './setup/SetupPanel.js';
import { useEventStream } from './useEventStream.js';

const EXPIRY_TICK_MS = 250;

export interface AppProps {
  /** Injected by the tests; production reads `navigator.mediaDevices`. */
  readonly mediaDevices?: MediaDevicesLike | null | undefined;
  readonly createSegmenter?: SegmenterFactory | undefined;
}

export function App({ mediaDevices, createSegmenter }: AppProps = {}) {
  const [state, dispatch] = useReducer(rendererReducer, initialRendererState);
  const wsUrl = useMemo(() => resolveWsUrl(), []);
  const showDebug = useMemo(() => debugOverlayEnabled(), []);
  const showSetup = useMemo(() => setupPanelEnabled(), []);
  const reducedMotion = useReducedMotion();

  const camera = useCamera(mediaDevices);
  const [cameraStats, setCameraStats] = useState<CompositorStats>(EMPTY_COMPOSITOR_STATS);

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

  // Diagnostics are only collected while something is there to display them.
  const showStats = showDebug || showSetup;
  const onStats = useMemo(
    () => (showStats ? (next: CompositorStats) => setCameraStats(next) : undefined),
    [showStats],
  );

  const { reportSegmentation } = camera;
  const effectIds = state.effects.map((effect) => effect.effectId);

  return (
    <div
      className="stage"
      data-scene={state.sceneId}
      data-connection={status}
      data-camera={camera.state.mode}
      data-camera-status={camera.state.status}
    >
      {OutgoingScene && outgoingSceneId ? (
        <div
          key={`out-${outgoingSceneId}`}
          className="scene-layer scene-layer--out"
          style={transitionStyle}
        >
          <OutgoingScene />
        </div>
      ) : null}
      <div key={state.sceneId} className="scene-layer scene-layer--in" style={transitionStyle}>
        <CurrentScene />
      </div>
      <div className="stage__vignette" aria-hidden="true" />
      <EffectsLayer effects={state.effects} reducedMotion={reducedMotion} plane="background" />
      <CameraLayer
        state={camera.state}
        stream={camera.stream}
        onSegmentationStatus={reportSegmentation}
        onStats={onStats}
        createSegmenter={createSegmenter}
      />
      <EffectsLayer effects={state.effects} reducedMotion={reducedMotion} plane="foreground" />
      {showDebug ? (
        <DebugOverlay
          wsUrl={wsUrl}
          status={status}
          sceneId={state.sceneId}
          effects={effectIds}
          camera={`${camera.state.mode}/${camera.state.status}`}
          stats={cameraStats}
        />
      ) : null}
      {showSetup ? (
        <SetupPanel
          camera={camera}
          stats={cameraStats}
          connection={status}
          sceneId={state.sceneId}
          effects={effectIds}
        />
      ) : null}
    </div>
  );
}

interface DebugOverlayProps {
  readonly wsUrl: string;
  readonly status: string;
  readonly sceneId: string;
  readonly effects: readonly string[];
  readonly camera: string;
  readonly stats: CompositorStats;
}

/**
 * Development-only overlay, enabled with `?debug=1`. It is deliberately off by
 * default so the OBS Browser Source shows nothing but the scene.
 */
function DebugOverlay({ wsUrl, status, sceneId, effects, camera, stats }: DebugOverlayProps) {
  const segmentation = stats.segmentation;
  return (
    <aside className="debug-overlay">
      <p className="debug-overlay__row">
        <span className={`debug-overlay__dot debug-overlay__dot--${status}`} />
        {status}
      </p>
      <p className="debug-overlay__row">scene: {sceneId}</p>
      <p className="debug-overlay__row">effects: {effects.length > 0 ? effects.join(', ') : 'none'}</p>
      <p className="debug-overlay__row">camera: {camera}</p>
      {stats.cameraResolution && stats.cameraResolution.width > 0 ? (
        <>
          <p className="debug-overlay__row">
            {stats.cameraResolution.width}x{stats.cameraResolution.height} at{' '}
            {stats.renderFps.toFixed(0)} FPS
          </p>
          <p className="debug-overlay__row">
            seg: {segmentation.segmentationFps.toFixed(0)} FPS,{' '}
            {segmentation.inferenceMs.toFixed(1)} ms, {segmentation.skipped} skipped
          </p>
        </>
      ) : null}
      <p className="debug-overlay__row debug-overlay__row--muted">{wsUrl}</p>
    </aside>
  );
}
