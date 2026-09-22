export const DEFAULT_WS_URL = 'ws://127.0.0.1:8765/ws';

/** Only the keys LiveScape reads, so callers (and tests) need nothing else. */
export interface RendererEnv {
  readonly VITE_LIVESCAPE_WS_URL?: string | undefined;
}

export function resolveWsUrl(env: RendererEnv = import.meta.env): string {
  const configured = env.VITE_LIVESCAPE_WS_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_WS_URL;
}

function flagEnabled(search: string, key: string): boolean {
  const value = new URLSearchParams(search).get(key);
  return value !== null && value !== '0' && value !== 'false';
}

/**
 * The renderer shows no UI chrome by default so it can be dropped straight
 * into an OBS Browser Source. `?debug=1` opts into a small status overlay for
 * local development.
 */
export function debugOverlayEnabled(search: string = window.location.search): boolean {
  return flagEnabled(search, 'debug');
}

/**
 * `?setup=1` opts into the camera setup panel.
 *
 * Camera controls have to live in the renderer, because the renderer's origin
 * is the one that holds the camera permission, but they must never appear in
 * the OBS output. Opening a second tab on the same origin with `?setup=1`
 * gives the operator the controls; the OBS source stays on the bare URL.
 *
 * Note that each tab holds its own camera: the setup tab configures the
 * renderer it is part of, not the one OBS has open.
 */
export function setupPanelEnabled(search: string = window.location.search): boolean {
  return flagEnabled(search, 'setup');
}
