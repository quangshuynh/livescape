import { describe, expect, it } from 'vitest';

import {
  INITIAL_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  reconnectDelayMs,
} from './useEventStream.js';
import { DEFAULT_WS_URL, debugOverlayEnabled, resolveWsUrl } from './config.js';

describe('reconnectDelayMs', () => {
  it('starts small and grows with each attempt', () => {
    const noJitter = () => 0.5;

    expect(reconnectDelayMs(0, noJitter)).toBe(INITIAL_RECONNECT_DELAY_MS);
    expect(reconnectDelayMs(1, noJitter)).toBe(INITIAL_RECONNECT_DELAY_MS * 2);
    expect(reconnectDelayMs(2, noJitter)).toBe(INITIAL_RECONNECT_DELAY_MS * 4);
  });

  it('never exceeds the cap, however long the server stays down', () => {
    for (const attempt of [5, 12, 50]) {
      expect(reconnectDelayMs(attempt, () => 1)).toBeLessThanOrEqual(MAX_RECONNECT_DELAY_MS * 1.25);
      expect(reconnectDelayMs(attempt, () => 0)).toBeGreaterThan(0);
    }
  });

  it('applies jitter around the base delay', () => {
    expect(reconnectDelayMs(3, () => 0)).toBeLessThan(reconnectDelayMs(3, () => 1));
  });
});

describe('configuration', () => {
  it('falls back to the local event server', () => {
    expect(resolveWsUrl({})).toBe(DEFAULT_WS_URL);
    expect(resolveWsUrl({ VITE_LIVESCAPE_WS_URL: '   ' })).toBe(DEFAULT_WS_URL);
  });

  it('uses a configured websocket url', () => {
    expect(resolveWsUrl({ VITE_LIVESCAPE_WS_URL: 'ws://10.0.0.5:9000/ws' })).toBe(
      'ws://10.0.0.5:9000/ws',
    );
  });

  it('keeps the debug overlay off unless it is explicitly requested', () => {
    expect(debugOverlayEnabled('')).toBe(false);
    expect(debugOverlayEnabled('?debug=0')).toBe(false);
    expect(debugOverlayEnabled('?debug=false')).toBe(false);
    expect(debugOverlayEnabled('?debug=1')).toBe(true);
    expect(debugOverlayEnabled('?debug')).toBe(true);
  });
});
