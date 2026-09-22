import { describe, expect, it } from 'vitest';
import type { LiveScapeEvent } from '@livescape/protocol';

import { initialRendererState, rendererReducer, type RendererState } from './rendererState.js';

function event(type: LiveScapeEvent['type'], payload: unknown): LiveScapeEvent {
  return {
    version: 1,
    id: `evt-${type}`,
    type,
    source: 'manual',
    timestamp: '2026-01-01T00:00:00Z',
    payload,
  } as LiveScapeEvent;
}

function apply(state: RendererState, next: LiveScapeEvent, now = 1_000): RendererState {
  return rendererReducer(state, { type: 'event', event: next, now });
}

describe('rendererReducer', () => {
  it('starts on the default scene with nothing playing', () => {
    expect(initialRendererState.sceneId).toBe('city');
    expect(initialRendererState.effects).toEqual([]);
  });

  it('switches scene on scene.change and records the transition hint', () => {
    const state = apply(initialRendererState, event('scene.change', { sceneId: 'forest', transitionMs: 400 }));

    expect(state.sceneId).toBe('forest');
    expect(state.transitionMs).toBe(400);
    expect(state.sceneRevision).toBe(1);
  });

  it('adds an effect with a deadline derived from durationMs', () => {
    const state = apply(
      initialRendererState,
      event('effect.trigger', { effectId: 'fireworks', intensity: 0.6, durationMs: 8000 }),
      5_000,
    );

    expect(state.effects).toEqual([
      { effectId: 'fireworks', intensity: 0.6, startedAt: 5_000, expiresAt: 13_000, instance: 0 },
    ]);
  });

  it('keeps effects without a duration running until cleared', () => {
    const state = apply(
      initialRendererState,
      event('effect.trigger', { effectId: 'rain', intensity: 1, durationMs: null }),
    );

    expect(state.effects[0]?.expiresAt).toBeNull();
  });

  it('re-triggering an effect replaces it and bumps the instance', () => {
    const first = apply(
      initialRendererState,
      event('effect.trigger', { effectId: 'rain', intensity: 0.3, durationMs: null }),
    );
    const second = apply(
      first,
      event('effect.trigger', { effectId: 'rain', intensity: 0.9, durationMs: null }),
    );

    expect(second.effects).toHaveLength(1);
    expect(second.effects[0]?.intensity).toBe(0.9);
    expect(second.effects[0]?.instance).toBe(1);
  });

  it('runs several effects at once', () => {
    let state = apply(initialRendererState, event('effect.trigger', { effectId: 'rain', intensity: 1, durationMs: null }));
    state = apply(state, event('effect.trigger', { effectId: 'snow', intensity: 1, durationMs: null }));

    expect(state.effects.map((effect) => effect.effectId)).toEqual(['rain', 'snow']);
  });

  it('clears a single effect by id', () => {
    let state = apply(initialRendererState, event('effect.trigger', { effectId: 'rain', intensity: 1, durationMs: null }));
    state = apply(state, event('effect.trigger', { effectId: 'snow', intensity: 1, durationMs: null }));
    state = apply(state, event('effect.clear', { effectId: 'rain' }));

    expect(state.effects.map((effect) => effect.effectId)).toEqual(['snow']);
  });

  it('clears every effect when effectId is null', () => {
    let state = apply(initialRendererState, event('effect.trigger', { effectId: 'rain', intensity: 1, durationMs: null }));
    state = apply(state, event('effect.trigger', { effectId: 'snow', intensity: 1, durationMs: null }));
    state = apply(state, event('effect.clear', { effectId: null }));

    expect(state.effects).toEqual([]);
  });

  it('clearing an effect that is not running is a no-op', () => {
    const state = apply(initialRendererState, event('effect.clear', { effectId: 'snow' }));

    expect(state.effects).toEqual([]);
    expect(state.sceneId).toBe('city');
  });

  it('adopts the server snapshot on state.sync', () => {
    const state = apply(
      initialRendererState,
      event('state.sync', {
        sceneId: 'space',
        effects: [{ effectId: 'snow', intensity: 0.4, durationMs: 4000 }],
      }),
      2_000,
    );

    expect(state.sceneId).toBe('space');
    expect(state.effects).toEqual([
      { effectId: 'snow', intensity: 0.4, startedAt: 2_000, expiresAt: 6_000, instance: 0 },
    ]);
  });

  it('drops expired effects on an expiry tick and leaves open-ended ones alone', () => {
    let state = apply(
      initialRendererState,
      event('effect.trigger', { effectId: 'fireworks', intensity: 1, durationMs: 1000 }),
      0,
    );
    state = apply(state, event('effect.trigger', { effectId: 'rain', intensity: 1, durationMs: null }), 0);

    const ticked = rendererReducer(state, { type: 'expire', now: 2_000 });

    expect(ticked.effects.map((effect) => effect.effectId)).toEqual(['rain']);
  });

  it('returns the same state object when an expiry tick changes nothing', () => {
    const state = apply(
      initialRendererState,
      event('effect.trigger', { effectId: 'rain', intensity: 1, durationMs: null }),
    );

    expect(rendererReducer(state, { type: 'expire', now: 999_999 })).toBe(state);
  });
});
