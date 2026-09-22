import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { FakeWebSocket, installFakeWebSocket } from './test/fakeWebSocket.js';

const HEALTH = {
  status: 'ok',
  version: '0.1.0',
  protocolVersion: 1,
  uptimeSeconds: 1,
  connectedClients: 1,
  currentScene: 'city',
  activeEffects: [] as string[],
};

interface PostCall {
  readonly url: string;
  readonly body: unknown;
}

function mockServer(options: { healthy?: boolean } = {}) {
  const posts: PostCall[] = [];
  const healthy = options.healthy ?? true;

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/healthz')) {
      if (!healthy) throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify(HEALTH), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    posts.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ event: { id: 'evt-1' }, deliveredTo: 1 }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { posts };
}

describe('<App /> control panel', () => {
  beforeEach(() => {
    installFakeWebSocket();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the server as connected once health responds', async () => {
    mockServer();
    render(<App />);

    expect(await screen.findByText(/Connected to LiveScape server/)).toBeTruthy();
  });

  it('shows an unreachable server without crashing', async () => {
    mockServer({ healthy: false });
    render(<App />);

    expect(await screen.findByText(/LiveScape server unreachable/)).toBeTruthy();
  });

  it('sends a normalized scene.change when a scene button is pressed', async () => {
    const server = mockServer();
    render(<App />);
    await screen.findByText(/Connected to LiveScape server/);

    await act(async () => {
      screen.getByRole('button', { name: 'Forest' }).click();
    });

    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]?.url).toMatch(/\/api\/events$/);
    expect(server.posts[0]?.body).toEqual({
      version: 1,
      type: 'scene.change',
      source: 'manual',
      payload: { sceneId: 'forest', transitionMs: 900 },
    });
  });

  it('sends effect.trigger and effect.clear from the effect controls', async () => {
    const server = mockServer();
    render(<App />);
    await screen.findByText(/Connected to LiveScape server/);

    await act(async () => {
      screen.getByRole('button', { name: 'Rain' }).click();
    });
    await waitFor(() => expect(server.posts).toHaveLength(1));

    await act(async () => {
      screen.getByRole('button', { name: 'Clear effects' }).click();
    });
    await waitFor(() => expect(server.posts).toHaveLength(2));

    expect(server.posts[0]?.body).toMatchObject({
      type: 'effect.trigger',
      source: 'manual',
      payload: { effectId: 'rain' },
    });
    expect(server.posts[1]?.body).toMatchObject({
      type: 'effect.clear',
      payload: { effectId: null },
    });
  });

  it('marks the simulation controls as development-only', async () => {
    mockServer();
    render(<App />);

    expect(await screen.findByText(/no livestream platform is connected/i)).toBeTruthy();
    expect(screen.getByText(/has no TikTok, YouTube or other platform integration/i)).toBeTruthy();
  });

  it('sends simulated events tagged with the simulation source', async () => {
    const server = mockServer();
    render(<App />);
    await screen.findByText(/Connected to LiveScape server/);

    await act(async () => {
      screen.getByRole('button', { name: 'Send simulated event' }).click();
    });

    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]?.body).toMatchObject({
      type: 'effect.trigger',
      source: 'simulation',
      payload: { effectId: 'fireworks', intensity: 1 },
    });
  });

  it('logs broadcast events from the server feed', async () => {
    mockServer();
    render(<App />);
    await screen.findByText(/Connected to LiveScape server/);
    expect(screen.getByText('No events yet.')).toBeTruthy();

    act(() => {
      FakeWebSocket.latest.open();
      FakeWebSocket.latest.emit({
        version: 1,
        id: 'evt-feed-1',
        type: 'effect.trigger',
        source: 'simulation',
        timestamp: '2026-01-01T00:00:00Z',
        payload: { effectId: 'snow', intensity: 0.5, durationMs: null },
      });
    });

    expect(await screen.findByText('effect.trigger')).toBeTruthy();
    expect(screen.getByText('simulation')).toBeTruthy();
  });

  it('reports a rejected event instead of failing silently', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/healthz')) {
        return new Response(JSON.stringify(HEALTH), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ detail: 'nope' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText(/Connected to LiveScape server/);

    await act(async () => {
      screen.getByRole('button', { name: 'Space' }).click();
    });

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
