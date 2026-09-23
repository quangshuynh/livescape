import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { installFakeCanvas, stubVideoSize } from './test/fakeCanvas.js';
import { FakeClock } from './test/fakeClock.js';
import { FakeMediaDevices } from './test/fakeMedia.js';
import { FakeSegmenter, solidMask } from './test/fakeSegmenter.js';
import { FakeWebSocket, installFakeWebSocket } from './test/fakeWebSocket.js';

const DEVICES = [{ deviceId: 'cam-a', label: 'Integrated Camera' }];

let sequence = 0;
function envelope(type: string, payload: unknown): unknown {
  sequence += 1;
  return {
    version: 1,
    id: `evt-${sequence}`,
    type,
    source: 'manual',
    timestamp: '2026-01-01T00:00:00Z',
    payload,
  };
}

function stage(container: HTMLElement): HTMLElement {
  const element = container.querySelector('.stage');
  if (!(element instanceof HTMLElement)) throw new Error('stage is not mounted');
  return element;
}

function zIndexOf(element: Element | null): number {
  if (!(element instanceof HTMLElement)) throw new Error('element is not mounted');
  return Number(element.style.zIndex);
}

/** The z-index that decides where an actor lands: that of its stage plane. */
function planeZ(actor: Element | null): number {
  return zIndexOf(actor?.closest('.scene-plane') ?? null);
}

let canvas: ReturnType<typeof installFakeCanvas>;
let restoreVideo: () => void;

beforeEach(() => {
  installFakeWebSocket();
  canvas = installFakeCanvas();
  restoreVideo = stubVideoSize(1280, 720);
});

afterEach(() => {
  cleanup();
  restoreVideo();
  canvas.restore();
  window.history.replaceState({}, '', '/');
});

interface Harness {
  readonly container: HTMLElement;
  readonly clock: FakeClock;
  readonly devices: FakeMediaDevices;
  readonly segmenter: FakeSegmenter;
  emit(type: string, payload: unknown): void;
  advance(ms: number): void;
  spawn(label: string): void;
  button(label: string): HTMLElement;
}

function renderApp(search = '?setup=1'): Harness {
  window.history.replaceState({}, '', `/${search}`);
  const clock = new FakeClock();
  const devices = new FakeMediaDevices(DEVICES);
  const segmenter = new FakeSegmenter();
  const { container } = render(
    <App mediaDevices={devices} createSegmenter={() => segmenter} sceneClock={clock} />,
  );
  act(() => FakeWebSocket.latest.open());

  const panel = () => {
    const element = container.querySelector('.setup');
    if (!(element instanceof HTMLElement)) throw new Error('setup panel is not mounted');
    return element;
  };
  const button = (label: string) => within(panel()).getByRole('button', { name: label });

  return {
    container,
    clock,
    devices,
    segmenter,
    emit: (type, payload) => act(() => FakeWebSocket.latest.emit(envelope(type, payload))),
    advance: (ms) => act(() => clock.advance(ms)),
    spawn: (label) => act(() => button(label).click()),
    button,
  };
}

async function startCamera(app: Harness, label: 'Raw' | 'Segmented'): Promise<void> {
  act(() => app.button(label).click());
  await waitFor(() => expect(stage(app.container).dataset.cameraStatus).toBe('ready'));
}

function showRoadside(app: Harness): void {
  app.emit('scene.change', { sceneId: 'roadside-workshop', transitionMs: 100 });
  app.advance(100);
}

describe('Roadside Workshop composition', () => {
  it('draws its artwork on all three scene planes', () => {
    const app = renderApp('');
    showRoadside(app);

    for (const plane of ['backdrop', 'environment', 'foreground']) {
      const layer = app.container.querySelector(`.scene-plane--${plane} [data-scene="roadside-workshop"]`);
      expect(layer?.querySelector('.scene--roadside')).not.toBeNull();
    }
    // Clean output: no chrome on the bare URL.
    expect(app.container.querySelector('.setup, .debug-overlay')).toBeNull();
  });

  it('fills with ambient actors on its own, within its cap', () => {
    const app = renderApp('');
    showRoadside(app);

    const seen = new Set<string>();
    let most = 0;
    for (let second = 0; second < 90; second += 1) {
      app.advance(1000);
      const actors = [...app.container.querySelectorAll<HTMLElement>('.actor')];
      most = Math.max(most, actors.length);
      for (const actor of actors) seen.add(actor.dataset.spawner ?? '');
    }

    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(16);
    expect(seen).toContain('near-traffic');
    expect(seen).toContain('far-traffic');
    expect(seen).toContain('far-walkers');
  });

  it.each(['Raw', 'Segmented'] as const)(
    'puts the car behind the %s subject and the leaves in front of it',
    async (mode) => {
      const app = renderApp();
      showRoadside(app);
      await startCamera(app, mode);
      if (mode === 'Segmented') {
        act(() => canvas.frames.tick(16));
        await act(async () => app.segmenter.finishOne(solidMask(16, 9, 1)));
      }

      app.spawn('Car, near lane');
      app.spawn('Workshop cat');
      app.spawn('Blown leaves');

      const subject = zIndexOf(app.container.querySelector('.camera-layer'));
      const car = app.container.querySelector('.actor[data-spawner="near-traffic"]');
      const cat = app.container.querySelector('.actor[data-spawner="cat"]');
      const leaf = app.container.querySelector('.actor[data-spawner="leaves"]');

      expect(planeZ(car)).toBeLessThan(planeZ(cat));
      expect(planeZ(cat)).toBeLessThan(subject);
      expect(subject).toBeLessThan(planeZ(leaf));
      // Weather still falls in front of everything in the scene.
      expect(planeZ(leaf)).toBeLessThan(zIndexOf(app.container.querySelector('.effects-layer--foreground')));
      expect(stage(app.container).dataset.camera).toBe(mode.toLowerCase());
    },
  );

  it('stacks the near lane in front of the far lane within a plane', () => {
    const app = renderApp();
    showRoadside(app);

    app.spawn('Car, near lane');
    app.spawn('Car, far lane');

    const near = app.container.querySelector<HTMLElement>('.actor[data-spawner="near-traffic"]');
    const far = app.container.querySelector<HTMLElement>('.actor[data-spawner="far-traffic"]');
    expect(Number(near?.style.zIndex)).toBeGreaterThan(Number(far?.style.zIndex));
  });

  it('removes an actor from the page once it has crossed', () => {
    const app = renderApp();
    showRoadside(app);
    app.spawn('Car, near lane');
    const car = app.container.querySelector<HTMLElement>('.actor[data-spawner="near-traffic"]');
    const selector = `.actor[data-actor-id="${car?.dataset.actorId}"]`;
    expect(app.container.querySelector(selector)).not.toBeNull();

    // Slowest car: (960 + ~191 units) at 150 units/s is under 8 s.
    app.advance(8000);

    expect(app.container.querySelector(selector)).toBeNull();
  });
});

describe('scene changes', () => {
  it('removes the previous scene and all of its actors after the crossfade', () => {
    const app = renderApp();
    showRoadside(app);
    app.spawn('Blown leaves');
    app.spawn('Car, near lane');

    app.emit('scene.change', { sceneId: 'city', transitionMs: 500 });
    // Mid-crossfade both scenes are on stage, the outgoing one underneath.
    expect(app.container.querySelector('.scene-plane--backdrop .scene-layer--out[data-scene="roadside-workshop"]')).not.toBeNull();
    expect(app.container.querySelector('.scene-plane--backdrop .scene-layer--in[data-scene="city"]')).not.toBeNull();

    app.advance(500);

    expect(app.container.querySelector('[data-scene="roadside-workshop"]')).toBeNull();
    expect(app.container.querySelector('.actor[data-spawner="leaves"], .actor[data-spawner="near-traffic"]')).toBeNull();
    expect(app.container.querySelector('.actor[data-spawner="headlights"]')).not.toBeNull();
  });

  it.each(['city', 'forest', 'space'])('switches between %s and Roadside Workshop without reopening the camera', async (sceneId) => {
    const app = renderApp();
    await startCamera(app, 'Segmented');

    showRoadside(app);
    app.emit('scene.change', { sceneId, transitionMs: 100 });
    app.advance(100);
    showRoadside(app);

    expect(stage(app.container).dataset.scene).toBe('roadside-workshop');
    expect(stage(app.container).dataset.cameraStatus).toBe('ready');
    expect(app.devices.requests).toHaveLength(1);
    expect(app.devices.liveStreams).toHaveLength(1);
    expect(app.container.querySelectorAll('.camera-layer')).toHaveLength(1);
  });

  it('keeps the scene and its actors through a server disconnect and a reconnect', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const app = renderApp();
      showRoadside(app);
      app.spawn('Workshop cat');

      act(() => FakeWebSocket.latest.serverClose());
      expect(app.container.querySelector('.actor[data-spawner="cat"]')).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      act(() => FakeWebSocket.latest.open());
      app.emit('state.sync', { sceneId: 'roadside-workshop', effects: [] });

      expect(stage(app.container).dataset.connection).toBe('open');
      expect(stage(app.container).dataset.scene).toBe('roadside-workshop');
      // Re-syncing to the scene already showing is not a scene change.
      expect(app.container.querySelector('.actor[data-spawner="cat"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('effects in Roadside Workshop', () => {
  it.each(['rain', 'snow', 'fireworks'])('runs and clears %s', (effectId) => {
    const app = renderApp('');
    showRoadside(app);

    app.emit('effect.trigger', { effectId, intensity: 0.6, durationMs: null });
    expect(app.container.querySelectorAll('.effects-layer')).toHaveLength(2);

    app.emit('effect.clear', { effectId: null });
    expect(stage(app.container).dataset.scene).toBe('roadside-workshop');
    expect(app.container.querySelector('.scene--roadside')).not.toBeNull();
  });
});

/** Makes `prefers-reduced-motion: reduce` match; returns the restore. */
function preferReducedMotion(): () => void {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe('reduced motion', () => {
  it('shows the scene held still, with no ambient actors', () => {
    const restore = preferReducedMotion();
    try {
      const app = renderApp('');
      showRoadside(app);

      app.advance(120_000);

      expect(app.container.querySelector('.scene--roadside')).not.toBeNull();
      expect(app.container.querySelectorAll('.actor')).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('still performs an explicit scene action, but not a surge', () => {
    const restore = preferReducedMotion();
    try {
      const app = renderApp('?debug=1');
      showRoadside(app);

      app.emit('scene.action', { actionId: 'roadside.blow-leaves' });
      expect(app.container.querySelectorAll('.actor[data-spawner="gust"]')).toHaveLength(2);

      app.emit('scene.action', { actionId: 'roadside.rush-hour' });
      expect(debugText(app)).toContain('action: roadside.rush-hour (reduced-motion)');

      app.advance(60_000);
      expect(app.container.querySelectorAll('.actor')).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

describe('scene diagnostics', () => {
  it('reports live actor counts by plane in the debug overlay', () => {
    const app = renderApp('?debug=1&setup=1');
    showRoadside(app);
    app.spawn('Workshop cat');
    app.spawn('Car, near lane');

    const overlay = app.container.querySelector('.debug-overlay');
    expect(overlay?.textContent).toContain(
      'actors: 2 (backdrop 1, environment 1, foreground 0), 2 triggered',
    );
    expect(overlay?.textContent).toContain('scene: roadside-workshop');
  });

  it('lists only the current scene’s actors as spawn controls', () => {
    const app = renderApp();
    const panel = app.container.querySelector('.setup') as HTMLElement;
    expect(within(panel).getByRole('button', { name: 'Headlight streak' })).toBeTruthy();

    app.emit('scene.change', { sceneId: 'space', transitionMs: 0 });

    expect(within(panel).queryByRole('button', { name: 'Headlight streak' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Shooting star' })).toBeTruthy();
  });
});

function actors(app: Harness, spawner?: string): HTMLElement[] {
  const selector = spawner ? `.actor[data-spawner="${spawner}"]` : '.actor';
  return [...app.container.querySelectorAll<HTMLElement>(selector)];
}

function triggeredActors(app: Harness): HTMLElement[] {
  return actors(app).filter((element) => element.dataset.triggered === 'true');
}

function debugText(app: Harness): string {
  return app.container.querySelector('.debug-overlay')?.textContent ?? '';
}

/** A Roadside Workshop with nothing on the street yet (ambient spawns start after 1.5 s). */
function quietRoadside(search = '?debug=1'): Harness {
  const app = renderApp(search);
  app.emit('scene.change', { sceneId: 'roadside-workshop', transitionMs: 0 });
  return app;
}

describe('scene actions over the event stream', () => {
  it.each(['Raw', 'Segmented'] as const)(
    'sends the bus and the car behind the %s subject and the leaves in front of it',
    async (mode) => {
      const app = renderApp('?setup=1');
      app.emit('scene.change', { sceneId: 'roadside-workshop', transitionMs: 0 });
      await startCamera(app, mode);
      if (mode === 'Segmented') {
        act(() => canvas.frames.tick(16));
        await act(async () => app.segmenter.finishOne(solidMask(16, 9, 1)));
      }

      app.emit('scene.action', { actionId: 'roadside.send-bus' });
      app.emit('scene.action', { actionId: 'roadside.send-car' });
      app.emit('scene.action', { actionId: 'roadside.blow-leaves' });

      const subject = zIndexOf(app.container.querySelector('.camera-layer'));
      const [bus] = actors(app, 'bus');
      const [car] = actors(app, 'near-traffic');
      const leaves = actors(app, 'gust');

      expect(bus?.classList.contains('actor--bus')).toBe(true);
      expect(bus?.dataset.layer).toBe('backdrop');
      expect(planeZ(bus ?? null)).toBeLessThan(subject);
      expect(planeZ(car ?? null)).toBeLessThan(subject);
      expect(leaves.length).toBeGreaterThanOrEqual(6);
      for (const leaf of leaves) expect(planeZ(leaf)).toBeGreaterThan(subject);
      expect(stage(app.container).dataset.camera).toBe(mode.toLowerCase());
    },
  );

  it('works with the camera off, and cleans the actors up after they cross', () => {
    const app = quietRoadside();

    app.emit('scene.action', { actionId: 'roadside.send-bus' });
    app.emit('scene.action', { actionId: 'roadside.pedestrians' });
    expect(stage(app.container).dataset.camera).toBe('off');
    expect(actors(app, 'bus')).toHaveLength(1);
    expect(actors(app, 'walker-group').length).toBeGreaterThanOrEqual(2);
    expect(debugText(app)).toContain('action: roadside.pedestrians (started)');

    expect(triggeredActors(app).length).toBeGreaterThanOrEqual(3);

    // The slowest of them, a pedestrian, is off screen within 30 s.
    app.advance(30_000);
    expect(triggeredActors(app)).toHaveLength(0);
  });

  it('refuses an action that belongs to another scene', () => {
    const app = quietRoadside();

    app.emit('scene.action', { actionId: 'space.shooting-star' });
    app.emit('scene.action', { actionId: 'forest.bird-flock' });

    expect(actors(app)).toHaveLength(0);
    expect(debugText(app)).toContain('action: forest.bird-flock (wrong-scene)');
    expect(stage(app.container).dataset.scene).toBe('roadside-workshop');
  });

  it('ignores an action id outside the registry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = quietRoadside();

    app.emit('scene.action', { actionId: 'roadside.send-tank' });
    app.emit('scene.action', { actionId: 'roadside.send-bus', sprite: 'dragon', url: 'https://example.com' });

    expect(warn).toHaveBeenCalledWith('[livescape] ignoring invalid event:', expect.stringContaining('send-tank'));
    // Extra fields are dropped by validation; only the allowlisted action runs.
    expect(actors(app).map((element) => element.dataset.spawner)).toEqual(['bus']);
  });

  it('delivers an action to the scene the server just switched to', () => {
    const app = renderApp('?debug=1');
    act(() => {
      FakeWebSocket.latest.emit(envelope('scene.change', { sceneId: 'space', transitionMs: 0 }));
      FakeWebSocket.latest.emit(envelope('scene.action', { actionId: 'space.shooting-star' }));
    });

    expect(debugText(app)).toContain('action: space.shooting-star (started)');
    expect(actors(app, 'meteor')).toHaveLength(1);
  });

  it('turns a burst of fifty requests into one bus', () => {
    const app = quietRoadside();

    act(() => {
      for (let index = 0; index < 50; index += 1) {
        FakeWebSocket.latest.emit(envelope('scene.action', { actionId: 'roadside.send-bus' }));
      }
    });

    expect(actors(app, 'bus')).toHaveLength(1);
    expect(actors(app, 'near-bus')).toHaveLength(0);
    expect(debugText(app)).toContain('action: roadside.send-bus (cooldown)');
  });

  it('keeps rush hour bounded and lets it expire', () => {
    const app = quietRoadside();

    app.emit('scene.action', { actionId: 'roadside.rush-hour' });
    expect(debugText(app)).toContain('running roadside.rush-hour');
    let most = 0;
    for (let second = 0; second < 20; second += 1) {
      app.advance(1000);
      most = Math.max(most, actors(app).length);
    }
    expect(most).toBeGreaterThan(3);
    expect(most).toBeLessThanOrEqual(24);

    app.advance(1000);
    expect(debugText(app)).not.toContain('running roadside.rush-hour');
  });

  it('removes a moving bus with its scene and comes back to a normal Roadside Workshop', () => {
    const app = quietRoadside();
    app.emit('scene.action', { actionId: 'roadside.send-bus' });
    app.emit('scene.action', { actionId: 'roadside.rush-hour' });
    expect(actors(app, 'bus')).toHaveLength(1);

    app.emit('scene.change', { sceneId: 'space', transitionMs: 500 });
    // A scene that is fading out takes no more actions.
    app.emit('scene.action', { actionId: 'roadside.send-car' });
    app.advance(500);

    expect(app.container.querySelector('[data-scene="roadside-workshop"]')).toBeNull();
    expect(actors(app)).toHaveLength(0);
    expect(debugText(app)).toContain('actors: 0');

    app.emit('scene.change', { sceneId: 'roadside-workshop', transitionMs: 0 });
    expect(actors(app)).toHaveLength(0);
    expect(debugText(app)).not.toContain('running');
    // The returning scene has its own, fresh cooldowns.
    app.emit('scene.action', { actionId: 'roadside.send-bus' });
    expect(actors(app, 'bus')).toHaveLength(1);
  });

  it('does not replay past actions after a reconnect, and takes new ones', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const app = quietRoadside();
      app.emit('scene.action', { actionId: 'roadside.blow-leaves' });
      expect(triggeredActors(app).length).toBeGreaterThan(0);
      app.advance(10_000);
      expect(triggeredActors(app)).toHaveLength(0);

      act(() => FakeWebSocket.latest.serverClose());
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      act(() => FakeWebSocket.latest.open());
      app.emit('state.sync', { sceneId: 'roadside-workshop', effects: [] });

      // Reconnecting restores durable state only; the gust is not replayed.
      expect(triggeredActors(app)).toHaveLength(0);
      expect(debugText(app)).toContain('action: roadside.blow-leaves (started)');

      app.emit('scene.action', { actionId: 'roadside.blow-leaves' });
      expect(triggeredActors(app).length).toBeGreaterThanOrEqual(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves durable renderer state alone', () => {
    const app = quietRoadside();
    app.emit('effect.trigger', { effectId: 'snow', intensity: 0.5, durationMs: null });

    app.emit('scene.action', { actionId: 'roadside.blow-leaves' });

    expect(stage(app.container).dataset.scene).toBe('roadside-workshop');
    expect(debugText(app)).toContain('effects: snow');
  });

  it.each([
    ['forest', 'forest.bird-flock', 'flock'],
    ['space', 'space.shooting-star', 'meteor'],
  ])('runs the %s action on its backdrop', (sceneId, actionId, spawner) => {
    const app = renderApp('');
    app.emit('scene.change', { sceneId, transitionMs: 0 });

    app.emit('scene.action', { actionId });

    const spawned = actors(app, spawner);
    expect(spawned.length).toBeGreaterThan(0);
    for (const element of spawned) expect(element.dataset.layer).toBe('backdrop');
  });
});
