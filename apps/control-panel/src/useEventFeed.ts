import { useEffect, useState } from 'react';
import { parseEventJson, type LiveScapeEvent } from '@livescape/protocol';

const RETRY_DELAY_MS = 1_500;
export const MAX_FEED_ENTRIES = 12;

export type FeedStatus = 'connecting' | 'open' | 'offline';

export interface FeedEntry {
  readonly event: LiveScapeEvent;
  readonly receivedAt: number;
}

export interface EventFeed {
  readonly status: FeedStatus;
  readonly entries: readonly FeedEntry[];
}

/**
 * Read-only view of what the event server is broadcasting.
 *
 * The panel subscribes to the same socket the renderer uses, so the activity
 * log shows exactly the normalized envelopes the renderer received -- not a
 * local guess about what was sent.
 */
export function useEventFeed(url: string): EventFeed {
  const [status, setStatus] = useState<FeedStatus>('connecting');
  const [entries, setEntries] = useState<readonly FeedEntry[]>([]);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      let next: WebSocket;
      try {
        next = new WebSocket(url);
      } catch {
        setStatus('offline');
        retryTimer = setTimeout(connect, RETRY_DELAY_MS);
        return;
      }
      socket = next;

      next.onopen = () => {
        if (!disposed) setStatus('open');
      };

      next.onmessage = (message: MessageEvent<unknown>) => {
        if (disposed || typeof message.data !== 'string') return;
        const parsed = parseEventJson(message.data);
        if (!parsed.ok) return;
        setEntries((current) =>
          [{ event: parsed.value, receivedAt: Date.now() }, ...current].slice(0, MAX_FEED_ENTRIES),
        );
      };

      next.onclose = () => {
        if (disposed) return;
        socket = null;
        setStatus('offline');
        retryTimer = setTimeout(connect, RETRY_DELAY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.close();
      }
    };
  }, [url]);

  return { status, entries };
}
