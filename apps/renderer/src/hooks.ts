import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { FrameRateMeter } from './compositor/stats.js';

/**
 * Tracks whether the viewer asked for reduced motion. Scene ambience, scene
 * actors and particle effects all tone themselves down when this is true.
 */
export function useReducedMotion(): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => {};
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    query.addEventListener('change', notify);
    return () => query.removeEventListener('change', notify);
  }, []);

  const getSnapshot = useCallback(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** How often the measured frame rate is pushed into React state. */
const FRAME_RATE_REPORT_MS = 500;

/**
 * Measures the page's own animation frame rate, for diagnostics only. It runs
 * nothing at all unless `enabled`, so the OBS output never pays for it.
 */
export function useFrameRate(enabled: boolean): number {
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const meter = new FrameRateMeter();
    let frame = 0;
    let lastReport = 0;
    const tick = (time: number) => {
      const value = meter.sample(time);
      if (time - lastReport >= FRAME_RATE_REPORT_MS) {
        lastReport = time;
        setFps(value);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [enabled]);

  return fps;
}
