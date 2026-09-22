export const DEFAULT_WS_URL = 'ws://127.0.0.1:8765/ws';

/** Only the keys LiveScape reads, so callers (and tests) need nothing else. */
export interface RendererEnv {
  readonly VITE_LIVESCAPE_WS_URL?: string | undefined;
}

export function resolveWsUrl(env: RendererEnv = import.meta.env): string {
  const configured = env.VITE_LIVESCAPE_WS_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_WS_URL;
}

/**
 * The renderer shows no UI chrome by default so it can be dropped straight
 * into an OBS Browser Source. `?debug=1` opts into a small status overlay for
 * local development.
 */
export function debugOverlayEnabled(search: string = window.location.search): boolean {
  const value = new URLSearchParams(search).get('debug');
  return value !== null && value !== '0' && value !== 'false';
}
