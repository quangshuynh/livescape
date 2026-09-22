import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { LiveScapeEvent } from '@livescape/protocol';

import type { EngineClock } from './actors/engine.js';
import { useCamera } from './camera/useCamera.js';
import type { MediaDevicesLike } from './camera/media.js';
import { CameraLayer } from './compositor/CameraLayer.js';
import { stageZIndex } from './compositor/layers.js';
import { EMPTY_COMPOSITOR_STATS, type CompositorStats } from './compositor/stats.js';
import { debugOverlayEnabled, resolveWsUrl, setupPanelEnabled } from './config.js';
import { EffectsLayer } from './effects/EffectsLayer.js';
import { useFrameRate, useReducedMotion } from './hooks.js';
import { initialRendererState, rendererReducer } from './rendererState.js';
import { describeActorCounts, useActorCounts } from './scenes/diagnostics.js';
import type { SceneDirector } from './scenes/director.js';
import { ScenePlane } from './scenes/ScenePlane.js';
import { useSceneDirector } from './scenes/useSceneDirector.js';
import type { SegmenterFactory } from './segmentation/types.js';
import { SetupPanel } from './setup/SetupPanel.js';
import { useEventStream } from './useEventStream.js';

const EXPIRY_TICK_MS = 250;

export interface AppProps {
  /** Injected by the tests; production reads `navigator.mediaDevices`. */
  readonly mediaDevices?: MediaDevicesLike | null | undefined;
  readonly createSegmenter?: SegmenterFactory | undefined;
  /** Injected by the tests so actor timing does not depend on the wall clock. */
  readonly sceneClock?: EngineClock | undefined;
}

export function App({ mediaDevices, createSegmenter, sceneClock }: AppProps = {}) {
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

  const { director, instances } = useSceneDirector(
    state.sceneId,
    state.transitionMs,
    reducedMotion,
    { clock: sceneClock },
  );

  // Diagnostics are only collected while something is there to display them.
  const showStats = showDebug || showSetup;
  const frameRate = useFrameRate(showStats);
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
      <ScenePlane layer="backdrop" instances={instances} />
      <ScenePlane layer="environment" instances={instances} />
      <div
        className="stage__vignette"
        aria-hidden="true"
        style={{ zIndex: stageZIndex('vignette') }}
      />
      <EffectsLayer effects={state.effects} reducedMotion={reducedMotion} plane="background" />
      <CameraLayer
        state={camera.state}
        stream={camera.stream}
        onSegmentationStatus={reportSegmentation}
        onStats={onStats}
        createSegmenter={createSegmenter}
      />
      <ScenePlane layer="foreground" instances={instances} />
      <EffectsLayer effects={state.effects} reducedMotion={reducedMotion} plane="foreground" />
      {showDebug ? (
        <DebugOverlay
          wsUrl={wsUrl}
          status={status}
          sceneId={state.sceneId}
          effects={effectIds}
          camera={`${camera.state.mode}/${camera.state.status}`}
          stats={cameraStats}
          frameRate={frameRate}
          director={director}
        />
      ) : null}
      {showSetup ? (
        <SetupPanel
          camera={camera}
          stats={cameraStats}
          connection={status}
          sceneId={state.sceneId}
          effects={effectIds}
          frameRate={frameRate}
          director={director}
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
  readonly frameRate: number;
  readonly director: SceneDirector;
}
/**
 * Development-only overlay, enabled with `?debug=1`. It is deliberately off by
 * default so the OBS Browser Source shows nothing but the scene.
 */
function DebugOverlay({
  wsUrl,
  status,
  sceneId,
  effects,
  camera,
  stats,
  frameRate,
  director,
}: DebugOverlayProps) {
  const segmentation = stats.segmentation;
  const actors = useActorCounts(director);
  return (
    <aside className="debug-overlay" style={{ zIndex: stageZIndex('debug') }}>
      <p className="debug-overlay__row">
        <span className={`debug-overlay__dot debug-overlay__dot--${status}`} />
        {status}
      </p>
      <p className="debug-overlay__row">scene: {sceneId}</p>
      <p className="debug-overlay__row">actors: {describeActorCounts(actors)}</p>
      <p className="debug-overlay__row">page: {frameRate.toFixed(0)} FPS</p>
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
