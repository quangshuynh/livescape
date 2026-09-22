import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { FakeWebSocket, installFakeWebSocket } from './test/fakeWebSocket.js';

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

describe('<App /> end-to-end event handling', () => {
  beforeEach(() => {
    installFakeWebSocket();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the default scene before any event arrives', () => {
    const { container } = render(<App />);

    expect(stage(container).dataset.scene).toBe('city');
  });

  it('reports the connection state on the stage element', () => {
    const { container } = render(<App />);
    expect(stage(container).dataset.connection).toBe('connecting');

    act(() => FakeWebSocket.latest.open());

    expect(stage(container).dataset.connection).toBe('open');
  });

  it('changes scene when a scene.change event arrives', () => {
    const { container } = render(<App />);
    act(() => FakeWebSocket.latest.open());

    act(() => FakeWebSocket.latest.emit(envelope('scene.change', { sceneId: 'space', transitionMs: 100 })));

    expect(stage(container).dataset.scene).toBe('space');
  });

  it('adopts the scene from the server state.sync snapshot on connect', () => {
    const { container } = render(<App />);
    act(() => FakeWebSocket.latest.open());

    act(() =>
      FakeWebSocket.latest.emit(
        envelope('state.sync', { sceneId: 'forest', effects: [] }, 'evt-sync'),
      ),
    );

    expect(stage(container).dataset.scene).toBe('forest');
  });

  it('ignores invalid frames and keeps the current scene', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(<App />);
    act(() => FakeWebSocket.latest.open());
    act(() => FakeWebSocket.latest.emit(envelope('scene.change', { sceneId: 'forest' })));

    act(() => FakeWebSocket.latest.emit(envelope('scene.change', { sceneId: 'volcano' })));
    act(() => FakeWebSocket.latest.emit('{ not json'));

    expect(stage(container).dataset.scene).toBe('forest');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the current scene when the server disappears, and reconnects', () => {
    const { container } = render(<App />);
    act(() => FakeWebSocket.latest.open());
    act(() => FakeWebSocket.latest.emit(envelope('scene.change', { sceneId: 'space', transitionMs: 100 })));
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => FakeWebSocket.latest.serverClose());

    // The scene survives the disconnect: OBS keeps showing what it had.
    expect(stage(container).dataset.scene).toBe('space');
    expect(stage(container).dataset.connection).toBe('reconnecting');

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);

    act(() => FakeWebSocket.latest.open());
    expect(stage(container).dataset.connection).toBe('open');
    expect(stage(container).dataset.scene).toBe('space');
  });

  it('retries again when a reconnect attempt also fails', () => {
    render(<App />);
    act(() => FakeWebSocket.latest.open());
    act(() => FakeWebSocket.latest.serverClose());

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const afterFirstRetry = FakeWebSocket.instances.length;

    act(() => FakeWebSocket.latest.serverClose());
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(FakeWebSocket.instances.length).toBeGreaterThan(afterFirstRetry);
  });

  it('mounts and unmounts the effects layer as effects come and go', () => {
    const { container } = render(<App />);
    act(() => FakeWebSocket.latest.open());

    act(() =>
      FakeWebSocket.latest.emit(
        envelope('effect.trigger', { effectId: 'rain', intensity: 0.8, durationMs: null }),
      ),
    );
    expect(container.querySelector('.effects-layer')).not.toBeNull();

    act(() => FakeWebSocket.latest.emit(envelope('effect.clear', { effectId: null }, 'evt-clear')));

    expect(stage(container).dataset.scene).toBe('city');
  });

  it('shows no debug overlay by default', () => {
    const { container } = render(<App />);

    expect(container.querySelector('.debug-overlay')).toBeNull();
  });
});
