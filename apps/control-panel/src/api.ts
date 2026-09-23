import { LIMITS, type EventRequest, type LiveScapeEvent } from '@livescape/protocol';

export const DEFAULT_API_URL = 'http://127.0.0.1:8765';
export const DEFAULT_WS_URL = 'ws://127.0.0.1:8765/ws';

/** Only the keys LiveScape reads, so callers (and tests) need nothing else. */
export interface ControlPanelEnv {
  readonly VITE_LIVESCAPE_API_URL?: string | undefined;
  readonly VITE_LIVESCAPE_WS_URL?: string | undefined;
}

export function resolveApiUrl(env: ControlPanelEnv = import.meta.env): string {
  const configured = env.VITE_LIVESCAPE_API_URL?.trim();
  return (configured && configured.length > 0 ? configured : DEFAULT_API_URL).replace(/\/+$/, '');
}

export function resolveWsUrl(env: ControlPanelEnv = import.meta.env): string {
  const configured = env.VITE_LIVESCAPE_WS_URL?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_WS_URL;
}

export interface Health {
  readonly status: string;
  readonly version: string;
  readonly protocolVersion: number;
  readonly uptimeSeconds: number;
  readonly connectedClients: number;
  readonly currentScene: string;
  readonly activeEffects: readonly string[];
  /** Scene actions still cooling down, with the milliseconds left. */
  readonly actionCooldowns?: Readonly<Record<string, number>>;
  /** Local epoch milliseconds when this response arrived; set by `fetchHealth`. */
  readonly receivedAt?: number;
}

export interface AcceptedEvent {
  readonly event: LiveScapeEvent;
  readonly deliveredTo: number;
}

export class EventServerError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** For a scene action refused while cooling down (429): time left. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'EventServerError';
  }
}

function retryAfterOf(body: unknown): number | null {
  if (typeof body === 'object' && body !== null && 'retryAfterMs' in body) {
    const value = (body as { retryAfterMs: unknown }).retryAfterMs;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

type FetchLike = typeof fetch;

/** Turns the server's 422 detail payload into something a human can read. */
function describeRejection(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { loc?: unknown[]; msg?: string };
      const where = Array.isArray(first.loc) ? first.loc.join('.') : 'payload';
      return `${where}: ${first.msg ?? 'rejected by the event server'}`;
    }
  }
  return 'rejected by the event server';
}

export async function sendEvent(
  baseUrl: string,
  request: EventRequest,
  fetchImpl: FetchLike = fetch,
): Promise<AcceptedEvent> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    throw new EventServerError('cannot reach the LiveScape event server', null);
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Keep the status-only message.
    }
    throw new EventServerError(describeRejection(body), response.status, retryAfterOf(body));
  }

  return (await response.json()) as AcceptedEvent;
}

export async function fetchHealth(baseUrl: string, fetchImpl: FetchLike = fetch): Promise<Health> {
  const response = await fetchImpl(`${baseUrl}/healthz`);
  if (!response.ok) {
    throw new EventServerError(`health check failed (${response.status})`, response.status);
  }
  const health = (await response.json()) as Health;
  return { ...health, receivedAt: Date.now() };
}

/**
 * Maps a simulated gift quantity onto the protocol's normalized intensity.
 *
 * Platform adapters will eventually do the same job for real viewer events:
 * the renderer only ever sees a 0-1 number, never a platform-specific count.
 */
export function quantityToIntensity(quantity: number): number {
  const scaled = quantity / 20;
  const clamped = Math.min(LIMITS.maxIntensity, Math.max(LIMITS.minIntensity, scaled));
  return Math.round(clamped * 100) / 100;
}
