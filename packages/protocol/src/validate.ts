import type {
  ActiveEffect,
  EffectClearRequest,
  EffectTriggerRequest,
  EventType,
  LiveScapeEvent,
  SceneChangeRequest,
} from './events.js';
import { EVENT_TYPES } from './events.js';
import {
  PROTOCOL_VERSION,
  effectEntry,
  isEffectId,
  isEventSource,
  isSceneId,
} from './registry.js';
import type { EffectId, EventSource, SceneId } from './registry.js';

/**
 * Bounds shared with the Python event server (`models.py`). Both sides
 * validate independently; these values are documented in docs/protocol.md.
 */
export const LIMITS = {
  minTransitionMs: 0,
  maxTransitionMs: 10_000,
  defaultTransitionMs: 900,
  minIntensity: 0.01,
  maxIntensity: 1,
  minDurationMs: 100,
  maxDurationMs: 600_000,
} as const;

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function parseActiveEffect(raw: unknown): ParseResult<ActiveEffect> {
  if (!isRecord(raw)) return fail('active effect must be an object');
  if (!isEffectId(raw.effectId)) return fail(`unknown effect id: ${String(raw.effectId)}`);
  if (!isFiniteNumber(raw.intensity) || !inRange(raw.intensity, LIMITS.minIntensity, LIMITS.maxIntensity)) {
    return fail('intensity out of range');
  }
  const durationMs = raw.durationMs ?? null;
  if (durationMs !== null && (!isFiniteNumber(durationMs) || !inRange(durationMs, LIMITS.minDurationMs, LIMITS.maxDurationMs))) {
    return fail('durationMs out of range');
  }
  return { ok: true, value: { effectId: raw.effectId, intensity: raw.intensity, durationMs } };
}

function parsePayload(type: EventType, raw: unknown): ParseResult<LiveScapeEvent['payload']> {
  if (!isRecord(raw)) return fail('payload must be an object');

  switch (type) {
    case 'scene.change': {
      if (!isSceneId(raw.sceneId)) return fail(`unknown scene id: ${String(raw.sceneId)}`);
      const transitionMs = raw.transitionMs ?? LIMITS.defaultTransitionMs;
      if (!isFiniteNumber(transitionMs) || !inRange(transitionMs, LIMITS.minTransitionMs, LIMITS.maxTransitionMs)) {
        return fail('transitionMs out of range');
      }
      return { ok: true, value: { sceneId: raw.sceneId, transitionMs } };
    }
    case 'effect.trigger': {
      if (!isEffectId(raw.effectId)) return fail(`unknown effect id: ${String(raw.effectId)}`);
      const intensity = raw.intensity ?? LIMITS.maxIntensity;
      if (!isFiniteNumber(intensity) || !inRange(intensity, LIMITS.minIntensity, LIMITS.maxIntensity)) {
        return fail('intensity out of range');
      }
      const durationMs = raw.durationMs === undefined ? effectEntry(raw.effectId).defaultDurationMs : raw.durationMs;
      if (durationMs !== null && (!isFiniteNumber(durationMs) || !inRange(durationMs, LIMITS.minDurationMs, LIMITS.maxDurationMs))) {
        return fail('durationMs out of range');
      }
      return { ok: true, value: { effectId: raw.effectId, intensity, durationMs } };
    }
    case 'effect.clear': {
      const effectId = raw.effectId ?? null;
      if (effectId !== null && !isEffectId(effectId)) return fail(`unknown effect id: ${String(effectId)}`);
      return { ok: true, value: { effectId: effectId as EffectId | null } };
    }
    case 'state.sync': {
      if (!isSceneId(raw.sceneId)) return fail(`unknown scene id: ${String(raw.sceneId)}`);
      if (!Array.isArray(raw.effects)) return fail('effects must be an array');
      const effects: ActiveEffect[] = [];
      for (const candidate of raw.effects) {
        const parsed = parseActiveEffect(candidate);
        if (!parsed.ok) return parsed;
        effects.push(parsed.value);
      }
      return { ok: true, value: { sceneId: raw.sceneId, effects } };
    }
    default:
      return fail(`unsupported event type: ${String(type)}`);
  }
}

/**
 * Validates an envelope received from the event server. The renderer treats
 * anything that fails this check as noise and keeps its current scene.
 */
export function parseEvent(raw: unknown): ParseResult<LiveScapeEvent> {
  if (!isRecord(raw)) return fail('event must be an object');
  if (raw.version !== PROTOCOL_VERSION) return fail(`unsupported protocol version: ${String(raw.version)}`);
  if (typeof raw.id !== 'string' || raw.id.length === 0) return fail('missing event id');
  if (typeof raw.timestamp !== 'string' || raw.timestamp.length === 0) return fail('missing timestamp');
  if (!isEventSource(raw.source)) return fail(`unknown event source: ${String(raw.source)}`);
  if (typeof raw.type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(raw.type)) {
    return fail(`unsupported event type: ${String(raw.type)}`);
  }

  const type = raw.type as EventType;
  const parsedPayload = parsePayload(type, raw.payload);
  if (!parsedPayload.ok) return parsedPayload;

  return {
    ok: true,
    value: {
      version: PROTOCOL_VERSION,
      id: raw.id,
      type,
      source: raw.source,
      timestamp: raw.timestamp,
      payload: parsedPayload.value,
    } as unknown as LiveScapeEvent,
  };
}

/** Parses a JSON string straight off a WebSocket frame. */
export function parseEventJson(text: string): ParseResult<LiveScapeEvent> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('malformed JSON');
  }
  return parseEvent(raw);
}

export function sceneChangeRequest(
  sceneId: SceneId,
  options: { source?: EventSource; transitionMs?: number } = {},
): SceneChangeRequest {
  return {
    version: PROTOCOL_VERSION,
    type: 'scene.change',
    source: options.source ?? 'manual',
    payload: { sceneId, transitionMs: options.transitionMs ?? LIMITS.defaultTransitionMs },
  };
}

export function effectTriggerRequest(
  effectId: EffectId,
  options: { source?: EventSource; intensity?: number; durationMs?: number | null } = {},
): EffectTriggerRequest {
  return {
    version: PROTOCOL_VERSION,
    type: 'effect.trigger',
    source: options.source ?? 'manual',
    payload: {
      effectId,
      intensity: options.intensity ?? LIMITS.maxIntensity,
      durationMs: options.durationMs === undefined ? effectEntry(effectId).defaultDurationMs : options.durationMs,
    },
  };
}

export function effectClearRequest(
  effectId: EffectId | null = null,
  options: { source?: EventSource } = {},
): EffectClearRequest {
  return {
    version: PROTOCOL_VERSION,
    type: 'effect.clear',
    source: options.source ?? 'manual',
    payload: { effectId },
  };
}
