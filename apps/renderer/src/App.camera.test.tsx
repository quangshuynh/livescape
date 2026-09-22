import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { installFakeCanvas, stubVideoSize, type FrameClock } from './test/fakeCanvas.js';
import { FakeMediaDevices, mediaError } from './test/fakeMedia.js';
import { FakeSegmenter, solidMask } from './test/fakeSegmenter.js';
import { FakeWebSocket, installFakeWebSocket } from './test/fakeWebSocket.js';

const DEVICES = [
  { deviceId: 'cam-a', label: 'Integrated Camera' },
  { deviceId: 'cam-b', label: 'USB Camera' },
];

function envelope(type: string, payload: unknown, id = 'evt-1'): unknown {
  return {
    version: 1,
    id,
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

let canvas: ReturnType<typeof installFakeCanvas>;
let frames: FrameClock;
let restoreVideo: () => void;

beforeEach(() => {
  installFakeWebSocket();
  canvas = installFakeCanvas();
  frames = canvas.frames;
  restoreVideo = stubVideoSize(1280, 720);
  window.history.replaceState({}, '', '/?setup=1');
});

afterEach(() => {
  cleanup();
  restoreVideo();
  canvas.restore();
  window.history.replaceState({}, '', '/');
});

interface Setup {
  readonly container: HTMLElement;
  readonly devices: FakeMediaDevices;
  readonly segmenter: FakeSegmenter;
  mode(label: 'Off' | 'Raw' | 'Segmented'): HTMLElement;
}

function renderApp(devices = new FakeMediaDevices(DEVICES)): Setup {
  const segmenter = new FakeSegmenter();
  const { container } = render(
    <App mediaDevices={devices} createSegmenter={() => segmenter} />,
  );
  act(() => FakeWebSocket.latest.open());

  const panel = container.querySelector('.setup');
  if (!(panel instanceof HTMLElement)) throw new Error('setup panel is not mounted');

  return {
    container,
    devices,
    segmenter,
    mode: (label) => within(panel).getByRole('button', { name: label }),
  };
}

async function startCamera(setup: Setup, label: 'Raw' | 'Segmented' = 'Raw'): Promise<void> {
  act(() => setup.mode(label).click());
  await waitFor(() => expect(stage(setup.container).dataset.cameraStatus).toBe('ready'));
}

describe('camera setup surface', () => {
  it('shows no camera chrome on the bare renderer URL', () => {
    window.history.replaceState({}, '', '/');
    const { container } = render(<App mediaDevices={new FakeMediaDevices(DEVICES)} />);

    expect(container.querySelector('.setup')).toBeNull();
    expect(container.querySelector('.debug-overlay')).toBeNull();
    expect(container.querySelector('.camera-layer')).toBeNull();
  });

  it('starts with the camera off and opens nothing', () => {
    const setup = renderApp();

    expect(stage(setup.container).dataset.camera).toBe('off');
    expect(setup.devices.requests).toHaveLength(0);
    expect(setup.mode('Off').getAttribute('aria-pressed')).toBe('true');
  });

  it('lists the cameras it can see', async () => {
    const setup = renderApp();

    await waitFor(() => expect(setup.devices.enumerateCalls).toBeGreaterThan(0));
    const panel = setup.container.querySelector('.setup') as HTMLElement;
    expect(within(panel).getByRole('option', { name: 'USB Camera' })).toBeTruthy();
  });

  it('opens the camera only when a mode is chosen', async () => {
    const setup = renderApp();

    await startCamera(setup);

    expect(setup.devices.liveStreams).toHaveLength(1);
    expect(stage(setup.container).dataset.camera).toBe('raw');
  });

  it('explains a blocked permission and offers a retry', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    devices.failWith = mediaError('NotAllowedError');
    const setup = renderApp(devices);

    act(() => setup.mode('Raw').click());

    await waitFor(() => expect(stage(setup.container).dataset.cameraStatus).toBe('denied'));
    const panel = setup.container.querySelector('.setup') as HTMLElement;
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('switches cameras without leaking the previous stream', async () => {
    const setup = renderApp();
    await startCamera(setup);
    const panel = setup.container.querySelector('.setup') as HTMLElement;
    const select = within(panel).getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement;

    act(() => {
      select.value = 'cam-b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await waitFor(() => expect(stage(setup.container).dataset.cameraStatus).toBe('ready'));
    expect(setup.devices.liveStreams).toHaveLength(1);
    expect(setup.devices.opened[0]?.allStopped).toBe(true);
  });

  it('releases the camera when stopped', async () => {
    const setup = renderApp();
    await startCamera(setup);

    act(() => setup.mode('Off').click());

    await waitFor(() => expect(setup.devices.allStreamsStopped).toBe(true));
    expect(stage(setup.container).dataset.camera).toBe('off');
    expect(setup.container.querySelector('.camera-layer')).toBeNull();
  });

  it('releases the camera when the renderer unmounts', async () => {
    const setup = renderApp();
    await startCamera(setup);

    cleanup();

    expect(setup.devices.allStreamsStopped).toBe(true);
  });
});

describe('compositor layering', () => {
  it('places the subject between the two effect planes', async () => {
    const setup = renderApp();
    await startCamera(setup);
    act(() =>
      FakeWebSocket.latest.emit(
        envelope('effect.trigger', { effectId: 'rain', intensity: 0.8, durationMs: null }),
      ),
    );
    act(() =>
      FakeWebSocket.latest.emit(
        envelope('effect.trigger', { effectId: 'fireworks', intensity: 1 }, 'evt-2'),
      ),
    );

    const order = [...stage(setup.container).children]
      .map((node) => node.className)
      .filter((name) => /effects-layer|camera-layer/.test(name));

    expect(order).toEqual([
      'effects-layer effects-layer--background',
      'camera-layer',
      'effects-layer effects-layer--foreground',
    ]);
  });

  it('keeps both effect planes mounted with the camera off', () => {
    const setup = renderApp();

    expect(setup.container.querySelectorAll('.effects-layer')).toHaveLength(2);
  });
});

describe('scenes and effects while the camera is running', () => {
  it.each(['city', 'forest', 'space', 'roadside-workshop'])('switches to %s with the camera on', async (sceneId) => {
    const setup = renderApp();
    await startCamera(setup);

    act(() =>
      FakeWebSocket.latest.emit(envelope('scene.change', { sceneId, transitionMs: 100 })),
    );

    expect(stage(setup.container).dataset.scene).toBe(sceneId);
    expect(stage(setup.container).dataset.cameraStatus).toBe('ready');
    expect(setup.devices.liveStreams).toHaveLength(1);
  });

  it.each(['rain', 'snow', 'fireworks'])('runs the %s effect with the camera on', async (id) => {
    const setup = renderApp();
    await startCamera(setup, 'Segmented');

    act(() =>
      FakeWebSocket.latest.emit(
        envelope('effect.trigger', { effectId: id, intensity: 0.7, durationMs: null }),
      ),
    );

    expect(setup.container.querySelectorAll('.effects-layer')).toHaveLength(2);
    expect(stage(setup.container).dataset.cameraStatus).toBe('ready');
  });

  it('clears effects without disturbing the camera', async () => {
    const setup = renderApp();
    await startCamera(setup);
    act(() =>
      FakeWebSocket.latest.emit(
        envelope('effect.trigger', { effectId: 'snow', intensity: 1, durationMs: null }),
      ),
    );

    act(() => FakeWebSocket.latest.emit(envelope('effect.clear', { effectId: null }, 'evt-c')));

    expect(stage(setup.container).dataset.cameraStatus).toBe('ready');
    expect(setup.devices.liveStreams).toHaveLength(1);
  });

  it('still ignores invalid events while the camera is running', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setup = renderApp();
    await startCamera(setup);
    act(() =>
      FakeWebSocket.latest.emit(envelope('scene.change', { sceneId: 'forest', transitionMs: 10 })),
    );

    act(() => FakeWebSocket.latest.emit(envelope('scene.change', { sceneId: 'volcano' })));
    act(() => FakeWebSocket.latest.emit(envelope('camera.change', { mode: 'off' }, 'evt-x')));
    act(() => FakeWebSocket.latest.emit('{ not json'));

    expect(stage(setup.container).dataset.scene).toBe('forest');
    expect(stage(setup.container).dataset.camera).toBe('raw');
    expect(setup.devices.liveStreams).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('independence of the camera and the event stream', () => {
  it('keeps the camera running when the server disappears', async () => {
    const setup = renderApp();
    await startCamera(setup, 'Segmented');

    act(() => FakeWebSocket.latest.serverClose());

    expect(stage(setup.container).dataset.connection).toBe('reconnecting');
    expect(stage(setup.container).dataset.cameraStatus).toBe('ready');
    expect(setup.devices.liveStreams).toHaveLength(1);
  });

  it('resumes event synchronisation on reconnect without touching the camera', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const setup = renderApp();
      await startCamera(setup);
      act(() => FakeWebSocket.latest.serverClose());

      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      act(() => FakeWebSocket.latest.open());
      act(() =>
        FakeWebSocket.latest.emit(
          envelope('state.sync', { sceneId: 'space', effects: [] }, 'evt-sync'),
        ),
      );

      expect(stage(setup.container).dataset.connection).toBe('open');
      expect(stage(setup.container).dataset.scene).toBe('space');
      expect(stage(setup.container).dataset.cameraStatus).toBe('ready');
      expect(setup.devices.liveStreams).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the scene when the camera fails', async () => {
    const devices = new FakeMediaDevices(DEVICES);
    devices.failWith = mediaError('NotReadableError');
    const setup = renderApp(devices);
    act(() =>
      FakeWebSocket.latest.emit(envelope('scene.change', { sceneId: 'forest', transitionMs: 10 })),
    );

    act(() => setup.mode('Segmented').click());
    await waitFor(() => expect(stage(setup.container).dataset.cameraStatus).toBe('busy'));

    expect(stage(setup.container).dataset.scene).toBe('forest');
    expect(setup.container.querySelector('.scene-layer')).not.toBeNull();
  });

  it('keeps the scene when segmentation fails', async () => {
    const segmenter = new FakeSegmenter();
    segmenter.failInitialize = new Error('WASM blocked');
    window.history.replaceState({}, '', '/?setup=1');
    const devices = new FakeMediaDevices(DEVICES);
    const { container } = render(
      <App mediaDevices={devices} createSegmenter={() => segmenter} />,
    );
    act(() => FakeWebSocket.latest.open());
    const panel = container.querySelector('.setup') as HTMLElement;

    act(() => within(panel).getByRole('button', { name: 'Segmented' }).click());

    await waitFor(() => expect(panel.textContent).toContain('WASM blocked'));
    expect(stage(container).dataset.scene).toBe('city');
    expect(stage(container).dataset.cameraStatus).toBe('ready');
  });
});

describe('diagnostics', () => {
  it('reports the measured camera and segmentation figures', async () => {
    const setup = renderApp();
    await startCamera(setup, 'Segmented');
    const panel = setup.container.querySelector('.setup') as HTMLElement;

    act(() => frames.tick(50));
    await act(async () => {
      setup.segmenter.finishOne(solidMask(16, 9, 1));
    });
    act(() => frames.tick(600));

    await waitFor(() => expect(panel.textContent).toContain('1280x720'));
    // Segmentation input is the camera aspect with its longest side clamped.
    expect(panel.textContent).toContain('320x180');
    // The resolved backend is surfaced so a CPU fallback is visible.
    expect(panel.textContent).toContain('fake');
  });

  it('shows the matte-quality figures', async () => {
    const setup = renderApp();
    await startCamera(setup, 'Segmented');
    const panel = setup.container.querySelector('.setup') as HTMLElement;

    act(() => frames.tick(50));
    await act(async () => {
      setup.segmenter.finishOne(solidMask(16, 9, 1));
    });
    act(() => frames.tick(600));

    await waitFor(() => expect(panel.textContent).toContain('Mask age'));
    const stats = panel.querySelector('.setup__stats') as HTMLElement;
    for (const label of ['Quality', 'Mask processing', 'Stale', 'Camera rate']) {
      expect(within(stats).getByText(label)).toBeTruthy();
    }
    expect(stats.textContent).toContain('Balanced');
  });
});

describe('matte view', () => {
  it('is a setup-panel control that shows the mask in this tab', async () => {
    const setup = renderApp();
    await startCamera(setup, 'Segmented');
    const panel = setup.container.querySelector('.setup') as HTMLElement;
    const toggle = within(panel).getByRole('button', { name: 'Show matte' });

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    act(() => toggle.click());

    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(panel.textContent).toContain('The OBS Browser Source never draws it.');
  });

  it('does not exist without the setup panel', () => {
    window.history.replaceState({}, '', '/');
    const { container } = render(<App mediaDevices={new FakeMediaDevices(DEVICES)} />);

    expect(within(container).queryByRole('button', { name: 'Show matte' })).toBeNull();
  });
});
