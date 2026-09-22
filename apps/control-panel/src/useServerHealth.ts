import { useCallback, useEffect, useState } from 'react';

import { fetchHealth, type Health } from './api.js';

export const HEALTH_POLL_MS = 3_000;

export interface ServerHealth {
  /** `null` while the event server is unreachable. */
  readonly health: Health | null;
  /** Force an immediate refresh, e.g. right after sending an event. */
  readonly refresh: () => void;
}

/**
 * Polls the event server's health endpoint.
 *
 * A failed poll is not an error state to recover from -- it simply means the
 * local server is not running yet, so the panel reports it and keeps polling.
 */
export function useServerHealth(apiUrl: string, intervalMs: number = HEALTH_POLL_MS): ServerHealth {
  const [health, setHealth] = useState<Health | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      fetchHealth(apiUrl).then(
        (next) => {
          if (!cancelled) setHealth(next);
        },
        () => {
          if (!cancelled) setHealth(null);
        },
      );
    };

    poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiUrl, intervalMs, nonce]);

  return { health, refresh };
}
