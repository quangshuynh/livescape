import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { EventServerError } from './api.js';
import { acceptedFeedback, mergeCooldowns, rejectedFeedback } from './sceneActions.js';
import { installFakeWebSocket } from './test/fakeWebSocket.js';

type Reply = { status: number; body: unknown };

function mockServer(options: { scene?: string; cooldowns?: Record<string, number>; reply?: (body: unknown) => Reply } = {}) {
  const posts: unknown[] = [];
  const reply = options.reply ?? (() => ({ status: 202, body: { event: { id: 'evt-1' }, deliveredTo: 1 } }));

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      if (String(input).endsWith('/healthz')) {
        return Response.json({
          status: 'ok',
          version: '0.1.0',
          protocolVersion: 1,
          uptimeSeconds: 1,
          connectedClients: 1,
          currentScene: options.scene ?? 'roadside-workshop',
          activeEffects: [],
          actionCooldowns: options.cooldowns ?? {},
        });
      }
      const body = JSON.parse(String(init?.body));
      posts.push(body);
      const { status, body: response } = reply(body);
      return Response.json(response, { status });
    }),
  );
  return { posts };
}

async function actionsCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: 'Scene actions' });
  return heading.closest('section') as HTMLElement;
}

async function press(card: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    within(card).getByRole('button', { name: label }).click();
  });
}

function feedback(card: HTMLElement): string {
  return within(card).getByRole('status').textContent ?? '';
}

describe('scene action controls', () => {
  beforeEach(() => {
    installFakeWebSocket();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('offers only the current scene’s actions', async () => {
    mockServer({ scene: 'roadside-workshop' });
    render(<App />);
    const card = await actionsCard();

    await waitFor(() => expect(within(card).queryAllByRole('button')).toHaveLength(5));
    expect(within(card).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Send Car',
      'Send Bus',
      'Pedestrians',
      'Blow Leaves',
      'Rush Hour',
    ]);
    expect(within(card).queryByRole('button', { name: 'Shooting Star' })).toBeNull();
  });

  it('says when the current scene has no actions', async () => {
    mockServer({ scene: 'city' });
    render(<App />);
    const card = await actionsCard();

    expect(await within(card).findByText('City has no scene actions.')).toBeTruthy();
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
  });

  it('sends a normalized scene.action and confirms it', async () => {
    const server = mockServer();
    render(<App />);
    const card = await actionsCard();
    await within(card).findByRole('button', { name: 'Send Bus' });

    await press(card, 'Send Bus');

    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toEqual({
      version: 1,
      type: 'scene.action',
      source: 'manual',
      payload: { actionId: 'roadside.send-bus' },
    });
    await waitFor(() => expect(feedback(card)).toBe('Send Bus sent to 1 connected client.'));
    // The accepted action now shows its cooldown, but stays pressable.
    const button = within(card).getByRole('button', { name: 'Send Bus' });
    expect(button.className).toContain('control-button--cooling');
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('reports a cooling-down rejection without the global error banner', async () => {
    mockServer({
      reply: () => ({ status: 429, body: { detail: 'roadside.send-car is cooling down', retryAfterMs: 1200 } }),
    });
    render(<App />);
    const card = await actionsCard();
    await within(card).findByRole('button', { name: 'Send Car' });

    await press(card, 'Send Car');

    await waitFor(() => expect(feedback(card)).toBe('Send Car is cooling down; ready in 1.2 s.'));
    expect(within(card).getByRole('button', { name: 'Send Car' }).className).toContain('control-button--cooling');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports an action that no longer matches the scene', async () => {
    mockServer({
      reply: () => ({ status: 409, body: { detail: 'wrong scene', sceneId: 'roadside-workshop' } }),
    });
    render(<App />);
    const card = await actionsCard();
    await within(card).findByRole('button', { name: 'Rush Hour' });

    await press(card, 'Rush Hour');

    await waitFor(() =>
      expect(feedback(card)).toBe('Rush Hour belongs to Roadside Workshop, which is not the current scene.'),
    );
  });

  it('surfaces a validation rejection', async () => {
    mockServer({
      reply: () => ({ status: 422, body: { detail: [{ loc: ['body', 'payload', 'actionId'], msg: 'Input should be ...' }] } }),
    });
    render(<App />);
    const card = await actionsCard();
    await within(card).findByRole('button', { name: 'Blow Leaves' });

    await press(card, 'Blow Leaves');

    await waitFor(() => expect(feedback(card)).toContain('Blow Leaves rejected: body.payload.actionId'));
  });

  it('shows a cooldown another source started', async () => {
    mockServer({ cooldowns: { 'roadside.send-bus': 4000, 'not.an-action': 9000 } });
    render(<App />);
    const card = await actionsCard();

    const bus = await within(card).findByRole('button', { name: 'Send Bus' });
    await waitFor(() => expect(bus.className).toContain('control-button--cooling'));
    expect(within(card).getByRole('button', { name: 'Send Car' }).className).not.toContain('cooling');
  });

  it('makes no platform, gift or money assumptions', async () => {
    mockServer();
    render(<App />);
    const card = await actionsCard();
    await within(card).findByRole('button', { name: 'Send Bus' });

    expect(card.textContent).not.toMatch(/tiktok|youtube|twitch|gift|coin|donat|\$|€/i);
  });
});

describe('scene action feedback text', () => {
  it('distinguishes a delivered action from one no renderer saw', () => {
    expect(acceptedFeedback('roadside.send-car', 2).text).toBe('Send Car sent to 2 connected clients.');
    expect(acceptedFeedback('roadside.send-car', 0)).toMatchObject({ tone: 'wait' });
  });

  it('explains an unreachable server', () => {
    const error = new EventServerError('cannot reach the LiveScape event server', null);
    expect(rejectedFeedback('forest.bird-flock', error).text).toBe(
      'Bird Flock not sent: cannot reach the LiveScape event server.',
    );
  });

  it('keeps the later of two cooldown deadlines and ignores unknown ids', () => {
    const local = { 'roadside.send-bus': 5000 } as const;
    expect(mergeCooldowns(local, { 'roadside.send-bus': 1000 }, 1000)).toBe(local);
    expect(mergeCooldowns(local, { 'roadside.send-bus': 8000, bogus: 1 }, 1000)).toEqual({ 'roadside.send-bus': 9000 });
  });
});
