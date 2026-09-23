import { describe, expect, it } from 'vitest';

import {
  EVENT_TYPES,
  MAX_ACTION_COOLDOWN_MS,
  MIN_ACTION_COOLDOWN_MS,
  PROTOCOL_VERSION,
  REGISTRY,
  SCENE_ACTION_IDS,
  SCENE_IDS,
  actionsForScene,
  isSceneActionId,
  parseEvent,
  sceneActionEntry,
  sceneActionRequest,
} from './index.js';

function actionEnvelope(payload: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: PROTOCOL_VERSION,
    id: 'evt-1',
    type: 'scene.action',
    source: 'manual',
    timestamp: '2026-01-01T00:00:00Z',
    payload,
    ...overrides,
  };
}

describe('scene action registry', () => {
  it('declares every action exactly once, each owned by a known scene', () => {
    const ids = REGISTRY.actions.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...SCENE_ACTION_IDS].sort());
    for (const action of REGISTRY.actions) {
      expect(SCENE_IDS).toContain(action.sceneId);
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.cooldownMs).toBeGreaterThanOrEqual(MIN_ACTION_COOLDOWN_MS);
      expect(action.cooldownMs).toBeLessThanOrEqual(MAX_ACTION_COOLDOWN_MS);
    }
  });

  it('answers which actions a scene owns', () => {
    expect(actionsForScene('roadside-workshop').map((action) => action.label)).toEqual([
      'Send Car',
      'Send Bus',
      'Pedestrians',
      'Blow Leaves',
      'Rush Hour',
    ]);
    expect(actionsForScene('city')).toEqual([]);
    expect(sceneActionEntry('roadside.send-bus').sceneId).toBe('roadside-workshop');
  });

  it('only recognises allowlisted ids', () => {
    expect(isSceneActionId('roadside.send-bus')).toBe(true);
    for (const candidate of ['roadside.send_bus', 'eval', 'toString', '__proto__', '', 42, null]) {
      expect(isSceneActionId(candidate)).toBe(false);
    }
    expect(() => sceneActionEntry('lasers' as never)).toThrow();
  });

  it('has no generic execution event type', () => {
    for (const forbidden of ['execute', 'run', 'script', 'eval', 'command']) {
      expect(EVENT_TYPES.some((type) => type.includes(forbidden))).toBe(false);
    }
  });
});

describe('scene.action validation', () => {
  it('accepts an allowlisted action and preserves its source', () => {
    const result = parseEvent(actionEnvelope({ actionId: 'roadside.send-bus' }, { source: 'simulation' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe('scene.action');
    expect(result.value.source).toBe('simulation');
    expect(result.value.payload).toEqual({ actionId: 'roadside.send-bus' });
  });

  it.each([
    ['unknown action', { actionId: 'roadside.send-tank' }],
    ['missing action id', {}],
    ['action id is not a string', { actionId: 7 }],
    ['payload is a string', 'roadside.send-bus'],
    ['payload is an array', ['roadside.send-bus']],
    ['payload is null', null],
    ['a script instead of an id', { actionId: 'window.location = "https://example.com"' }],
    ['a path instead of an id', { actionId: '../../etc/passwd' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseEvent(actionEnvelope(payload)).ok).toBe(false);
  });

  it('drops any extra payload field instead of passing it on', () => {
    const result = parseEvent(
      actionEnvelope({ actionId: 'roadside.blow-leaves', script: 'alert(1)', url: 'https://example.com' }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.payload).toEqual({ actionId: 'roadside.blow-leaves' });
  });

  it.each(['execute', 'run', 'script', 'eval', 'command', 'scene.execute'])(
    'rejects a generic "%s" event type',
    (type) => {
      expect(parseEvent(actionEnvelope({ actionId: 'roadside.send-car' }, { type })).ok).toBe(false);
    },
  );

  it('rejects an action from an unknown source or protocol version', () => {
    expect(parseEvent(actionEnvelope({ actionId: 'roadside.send-car' }, { source: 'tiktok' })).ok).toBe(false);
    expect(parseEvent(actionEnvelope({ actionId: 'roadside.send-car' }, { version: 2 })).ok).toBe(false);
  });

  it('builds a request that carries only the action id', () => {
    expect(sceneActionRequest('roadside.rush-hour')).toEqual({
      version: 1,
      type: 'scene.action',
      source: 'manual',
      payload: { actionId: 'roadside.rush-hour' },
    });
    expect(sceneActionRequest('forest.bird-flock', { source: 'simulation' }).source).toBe('simulation');
  });
});
