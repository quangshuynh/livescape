import { describe, expect, it, vi } from 'vitest';
import { sceneChangeRequest } from '@livescape/protocol';

import {
  DEFAULT_API_URL,
  EventServerError,
  fetchHealth,
  quantityToIntensity,
  resolveApiUrl,
  sendEvent,
} from './api.js';
import { FOLLOW_INTENSITY, simulatedActionRequest, simulatedActionUsesQuantity } from './simulation.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('resolveApiUrl', () => {
  it('defaults to the local event server', () => {
    expect(resolveApiUrl({})).toBe(DEFAULT_API_URL);
  });

  it('strips a trailing slash so paths join cleanly', () => {
    expect(resolveApiUrl({ VITE_LIVESCAPE_API_URL: 'http://127.0.0.1:9000/' })).toBe(
      'http://127.0.0.1:9000',
    );
  });
});

describe('sendEvent', () => {
  it('posts the normalized request as JSON', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ event: { id: 'evt-1' }, deliveredTo: 1 }, 202),
    );

    const result = await sendEvent(DEFAULT_API_URL, sceneChangeRequest('space'), fetchImpl);

    expect(result.deliveredTo).toBe(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_API_URL}/api/events`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      version: 1,
      type: 'scene.change',
      source: 'manual',
      payload: { sceneId: 'space', transitionMs: 900 },
    });
  });

  it('surfaces a validation rejection from the server', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ detail: [{ loc: ['body', 'payload', 'sceneId'], msg: 'not allowed' }] }, 422),
    );

    await expect(sendEvent(DEFAULT_API_URL, sceneChangeRequest('city'), fetchImpl)).rejects.toThrow(
      /sceneId: not allowed/,
    );
  });

  it('reports an unreachable server instead of throwing a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const error = await sendEvent(DEFAULT_API_URL, sceneChangeRequest('city'), fetchImpl).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(EventServerError);
    expect((error as EventServerError).status).toBeNull();
  });

  it('handles an error response with no JSON body', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }));

    await expect(sendEvent(DEFAULT_API_URL, sceneChangeRequest('city'), fetchImpl)).rejects.toThrow(
      /rejected by the event server/,
    );
  });
});

describe('fetchHealth', () => {
  it('returns the parsed health document', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: 'ok',
        version: '0.1.0',
        protocolVersion: 1,
        uptimeSeconds: 3,
        connectedClients: 2,
        currentScene: 'forest',
        activeEffects: ['rain'],
      }),
    );

    await expect(fetchHealth(DEFAULT_API_URL, fetchImpl)).resolves.toMatchObject({
      currentScene: 'forest',
      activeEffects: ['rain'],
    });
  });

  it('throws when the server answers with an error status', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));

    await expect(fetchHealth(DEFAULT_API_URL, fetchImpl)).rejects.toBeInstanceOf(EventServerError);
  });
});

describe('simulated viewer events', () => {
  it('maps gift quantity onto normalized intensity', () => {
    expect(quantityToIntensity(20)).toBe(1);
    expect(quantityToIntensity(10)).toBe(0.5);
    expect(quantityToIntensity(1)).toBe(0.05);
  });

  it('never produces an intensity outside the protocol range', () => {
    expect(quantityToIntensity(0)).toBeGreaterThanOrEqual(0.01);
    expect(quantityToIntensity(5_000)).toBe(1);
  });

  it('always produces a normalized effect.trigger tagged as simulation', () => {
    const request = simulatedActionRequest('gift', 'fireworks', 10);

    expect(request.type).toBe('effect.trigger');
    expect(request.source).toBe('simulation');
    expect(request.payload).toEqual({ effectId: 'fireworks', intensity: 0.5, durationMs: 8000 });
  });

  it('uses a fixed intensity for actions that carry no quantity', () => {
    expect(simulatedActionRequest('follow', 'rain', 99).payload.intensity).toBe(FOLLOW_INTENSITY);
    expect(simulatedActionRequest('chat-command', 'rain', 99).payload.intensity).toBe(1);
    expect(simulatedActionUsesQuantity('follow')).toBe(false);
    expect(simulatedActionUsesQuantity('gift')).toBe(true);
  });
});
