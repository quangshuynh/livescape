import { describe, expect, it } from 'vitest';

import {
  LIMITS,
  PROTOCOL_VERSION,
  REGISTRY,
  effectClearRequest,
  effectTriggerRequest,
  isEffectId,
  isSceneId,
  parseEvent,
  parseEventJson,
  sceneChangeRequest,
} from './index.js';

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: PROTOCOL_VERSION,
    id: 'evt-1',
    type: 'scene.change',
    source: 'manual',
    timestamp: '2026-01-01T00:00:00Z',
    payload: { sceneId: 'forest', transitionMs: 500 },
    ...overrides,
  };
}

describe('registry', () => {
  it('exposes exactly the allowlisted scenes and effects', () => {
    expect(REGISTRY.scenes.map((s) => s.id)).toEqual(['city', 'forest', 'space']);
    expect(REGISTRY.effects.map((e) => e.id)).toEqual(['rain', 'snow', 'fireworks']);
  });

  it('rejects ids outside the allowlist', () => {
    expect(isSceneId('city')).toBe(true);
    expect(isSceneId('volcano')).toBe(false);
    expect(isEffectId('rain')).toBe(true);
    expect(isEffectId('__proto__')).toBe(false);
  });
});

describe('parseEvent', () => {
  it('accepts a well-formed scene.change envelope', () => {
    const result = parseEvent(envelope());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe('scene.change');
    expect(result.value.payload).toEqual({ sceneId: 'forest', transitionMs: 500 });
  });

  it('accepts effect.trigger and applies registry defaults for durationMs', () => {
    const result = parseEvent(
      envelope({ type: 'effect.trigger', payload: { effectId: 'fireworks', intensity: 0.5 } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payload).toEqual({ effectId: 'fireworks', intensity: 0.5, durationMs: 8000 });
  });

  it('accepts effect.clear with a null effectId meaning "clear all"', () => {
    const result = parseEvent(envelope({ type: 'effect.clear', payload: {} }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payload).toEqual({ effectId: null });
  });

  it('accepts a state.sync envelope', () => {
    const result = parseEvent(
      envelope({
        type: 'state.sync',
        source: 'system',
        payload: { sceneId: 'space', effects: [{ effectId: 'snow', intensity: 1, durationMs: null }] },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['non-object', 42],
    ['unknown type', envelope({ type: 'scene.explode' })],
    ['unknown source', envelope({ source: 'tiktok' })],
    ['wrong version', envelope({ version: 99 })],
    ['missing id', envelope({ id: '' })],
    ['missing timestamp', envelope({ timestamp: undefined })],
    ['unknown scene id', envelope({ payload: { sceneId: 'volcano' } })],
    ['payload not an object', envelope({ payload: 'forest' })],
    ['transition out of range', envelope({ payload: { sceneId: 'city', transitionMs: 99_999 } })],
    [
      'intensity out of range',
      envelope({ type: 'effect.trigger', payload: { effectId: 'rain', intensity: 4 } }),
    ],
    [
      'duration out of range',
      envelope({ type: 'effect.trigger', payload: { effectId: 'rain', intensity: 1, durationMs: 5 } }),
    ],
    [
      'unknown effect id',
      envelope({ type: 'effect.trigger', payload: { effectId: 'lasers', intensity: 1 } }),
    ],
  ])('rejects %s', (_label, raw) => {
    expect(parseEvent(raw).ok).toBe(false);
  });

  it('rejects malformed JSON without throwing', () => {
    const result = parseEventJson('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed JSON');
  });

  it('round-trips a JSON encoded envelope', () => {
    expect(parseEventJson(JSON.stringify(envelope())).ok).toBe(true);
  });
});

describe('request builders', () => {
  it('builds a scene.change request with the default transition', () => {
    expect(sceneChangeRequest('space')).toEqual({
      version: PROTOCOL_VERSION,
      type: 'scene.change',
      source: 'manual',
      payload: { sceneId: 'space', transitionMs: LIMITS.defaultTransitionMs },
    });
  });

  it('builds a simulated effect.trigger request', () => {
    expect(effectTriggerRequest('rain', { source: 'simulation', intensity: 0.4 })).toEqual({
      version: PROTOCOL_VERSION,
      type: 'effect.trigger',
      source: 'simulation',
      payload: { effectId: 'rain', intensity: 0.4, durationMs: null },
    });
  });

  it('builds a clear-all request', () => {
    expect(effectClearRequest()).toEqual({
      version: PROTOCOL_VERSION,
      type: 'effect.clear',
      source: 'manual',
      payload: { effectId: null },
    });
  });
});
