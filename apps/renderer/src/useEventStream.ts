import { useEffect, useRef, useState } from 'react';
import { parseEventJson, type LiveScapeEvent } from '@livescape/protocol';

import type { ConnectionStatus } from './rendererState.js';

export const INITIAL_RECONNECT_DELAY_MS = 500;
export const MAX_RECONNECT_DELAY_MS = 8_000;

/**
 * Exponential backoff with jitter, so a restarted event server is not hit by
 * every client at the same instant.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const capped = Math.min(MAX_RECONNECT_DELAY_MS, INITIAL_RECONNECT_DELAY_MS * 2 ** attempt);
  return Math.round(capped * (0.75 + random() * 0.5));
}

/**
 * Subscribes to the event server and reconnects forever if it goes away.
 *
 * The hook never touches scene state on disconnect: whatever is on screen
 * stays on screen, which is what a stream needs when a local service restarts.
 */
export function useEventStream(
  url: string,
  onEvent: (event: LiveScapeEvent) => void,
): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = (): void => {
      if (disposed) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');

      let next: WebSocket;
      try {
        next = new WebSocket(url);
      } catch {
        scheduleRetry();
        return;
      }
      socket = next;

      next.onopen = () => {
        if (disposed) return;
        attempt = 0;
        setStatus('open');
      };

      next.onmessage = (message: MessageEvent<unknown>) => {
        if (disposed || typeof message.data !== 'string') return;
        const parsed = parseEventJson(message.data);
        if (parsed.ok) {
          onEventRef.current(parsed.value);
        } else {
          console.warn('[livescape] ignoring invalid event:', parsed.reason);
        }
      };

      next.onerror = () => {
        // `onclose` always follows; retry scheduling lives there.
      };

      next.onclose = () => {
        if (disposed) return;
        socket = null;
        scheduleRetry();
      };
    };

    const scheduleRetry = (): void => {
      if (disposed) return;
      setStatus('reconnecting');
      const delay = reconnectDelayMs(attempt);
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
    };
  }, [url]);

  return status;
}
