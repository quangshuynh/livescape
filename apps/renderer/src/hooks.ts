import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SceneId } from '@livescape/protocol';

/**
 * Tracks whether the viewer asked for reduced motion. Scene ambience and
 * particle effects both tone themselves down when this is true.
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

/**
 * Keeps the previous scene mounted for the length of the crossfade so a scene
 * change reads as a transition rather than a cut.
 */
export function useSceneTransition(sceneId: SceneId, transitionMs: number): SceneId | null {
  const [outgoing, setOutgoing] = useState<SceneId | null>(null);
  const previousRef = useRef(sceneId);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = sceneId;
    if (previous === sceneId) return;

    setOutgoing(previous);
    const timer = setTimeout(() => setOutgoing(null), Math.max(0, transitionMs));
    return () => clearTimeout(timer);
  }, [sceneId, transitionMs]);

  return outgoing;
}
