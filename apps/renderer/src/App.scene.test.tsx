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

describe('reduced motion', () => {
  it('shows the scene held still, with no ambient actors', () => {
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
    try {
      const app = renderApp('');
      showRoadside(app);

      app.advance(120_000);

      expect(app.container.querySelector('.scene--roadside')).not.toBeNull();
      expect(app.container.querySelectorAll('.actor')).toHaveLength(0);
    } finally {
      window.matchMedia = original;
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
    expect(overlay?.textContent).toContain('actors: 2 (backdrop 1, environment 1, foreground 0)');
    expect(overlay?.textContent).toContain('scene: roadside-workshop');
  });

  it('lists only the current scene’s actors as spawn controls', () => {
    const app = renderApp();
    const panel = app.container.querySelector('.setup') as HTMLElement;
    expect(within(panel).getByRole('button', { name: 'Headlight streak' })).toBeTruthy();

    app.emit('scene.change', { sceneId: 'space', transitionMs: 0 });

    expect(within(panel).queryByRole('button', { name: 'Headlight streak' })).toBeNull();
    expect(panel.textContent).toContain('This scene has no actors.');
  });
});
