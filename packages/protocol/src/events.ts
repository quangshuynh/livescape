import type { EffectId, EventSource, SceneActionId, SceneId } from './registry.js';

/**
 * The LiveScape event protocol.
 *
 * Every message crossing the wire is a versioned envelope. Platform adapters
 * (TikTok, YouTube, ...) are expected to translate their own payloads into
 * these envelopes; the renderer only ever sees the normalized form and has no
 * knowledge of any upstream platform.
 */

export const CLIENT_EVENT_TYPES = ['scene.change', 'effect.trigger', 'effect.clear', 'scene.action'] as const;
export const SERVER_ONLY_EVENT_TYPES = ['state.sync'] as const;
export const EVENT_TYPES = [...CLIENT_EVENT_TYPES, ...SERVER_ONLY_EVENT_TYPES] as const;

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];

export interface SceneChangePayload {
  readonly sceneId: SceneId;
  /** Crossfade duration hint for the renderer, in milliseconds. */
  readonly transitionMs: number;
}

export interface EffectTriggerPayload {
  readonly effectId: EffectId;
  /** Normalized 0 < intensity <= 1. Adapters map their own scales onto this. */
  readonly intensity: number;
  /** `null` means "run until cleared". */
  readonly durationMs: number | null;
}

export interface EffectClearPayload {
  /** `null` clears every active effect. */
  readonly effectId: EffectId | null;
}

/**
 * A one-shot request for a predefined scene action.
 *
 * Unlike the other client events this is transient: the server does not fold
 * it into state, so it is never replayed by `state.sync`. A renderer that is
 * not connected when it is broadcast simply never sees it.
 */
export interface SceneActionPayload {
  readonly actionId: SceneActionId;
}

export interface ActiveEffect {
  readonly effectId: EffectId;
  readonly intensity: number;
  readonly durationMs: number | null;
}

export interface StateSyncPayload {
  readonly sceneId: SceneId;
  readonly effects: readonly ActiveEffect[];
}

export interface EventEnvelopeBase<TType extends EventType, TPayload> {
  readonly version: number;
  readonly id: string;
  readonly type: TType;
  readonly source: EventSource;
  /** ISO-8601 UTC timestamp assigned by the event server. */
  readonly timestamp: string;
  readonly payload: TPayload;
}

export type SceneChangeEvent = EventEnvelopeBase<'scene.change', SceneChangePayload>;
export type EffectTriggerEvent = EventEnvelopeBase<'effect.trigger', EffectTriggerPayload>;
export type EffectClearEvent = EventEnvelopeBase<'effect.clear', EffectClearPayload>;
export type StateSyncEvent = EventEnvelopeBase<'state.sync', StateSyncPayload>;
export type SceneActionEvent = EventEnvelopeBase<'scene.action', SceneActionPayload>;

export type LiveScapeEvent =
  | SceneChangeEvent
  | EffectTriggerEvent
  | EffectClearEvent
  | SceneActionEvent
  | StateSyncEvent;

/**
 * What a client sends to `POST /api/events`. The server owns `id` and
 * `timestamp` so that ordering and identity are decided in exactly one place.
 */
export interface EventRequestBase<TType extends ClientEventType, TPayload> {
  readonly version: number;
  readonly type: TType;
  readonly source: EventSource;
  readonly payload: TPayload;
}

export type SceneChangeRequest = EventRequestBase<'scene.change', SceneChangePayload>;
export type EffectTriggerRequest = EventRequestBase<'effect.trigger', EffectTriggerPayload>;
export type EffectClearRequest = EventRequestBase<'effect.clear', EffectClearPayload>;

export type SceneActionRequest = EventRequestBase<'scene.action', SceneActionPayload>;

export type EventRequest =
  | SceneChangeRequest
  | EffectTriggerRequest
  | EffectClearRequest
  | SceneActionRequest;
