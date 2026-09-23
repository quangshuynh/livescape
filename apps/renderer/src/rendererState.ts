import { DEFAULT_SCENE_ID, type EffectId, type LiveScapeEvent, type SceneId } from '@livescape/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting';

export interface ActiveEffectState {
  readonly effectId: EffectId;
  readonly intensity: number;
  readonly startedAt: number;
  /** Epoch-ish millisecond deadline, or `null` for "until cleared". */
  readonly expiresAt: number | null;
  /** Bumped every time the same effect is re-triggered, so bursts restart. */
  readonly instance: number;
}

export interface RendererState {
  readonly sceneId: SceneId;
  readonly transitionMs: number;
  /** Increments on every accepted scene change, including a change back. */
  readonly sceneRevision: number;
  readonly effects: readonly ActiveEffectState[];
  readonly lastEventAt: number | null;
}

export type RendererAction =
  | { readonly type: 'event'; readonly event: LiveScapeEvent; readonly now: number }
  | { readonly type: 'expire'; readonly now: number };

export const initialRendererState: RendererState = {
  sceneId: DEFAULT_SCENE_ID,
  transitionMs: 900,
  sceneRevision: 0,
  effects: [],
  lastEventAt: null,
};

function withoutEffect(
  effects: readonly ActiveEffectState[],
  effectId: EffectId,
): ActiveEffectState[] {
  return effects.filter((effect) => effect.effectId !== effectId);
}

function instanceOf(effects: readonly ActiveEffectState[], effectId: EffectId): number {
  const existing = effects.find((effect) => effect.effectId === effectId);
  return existing ? existing.instance + 1 : 0;
}

/**
 * Pure fold of protocol events onto renderer state.
 *
 * Nothing here can fail: an event that reaches this point has already been
 * validated against the protocol, and any state the renderer cannot represent
 * simply leaves the previous state in place. Losing the connection never
 * clears the scene.
 */
export function rendererReducer(state: RendererState, action: RendererAction): RendererState {
  if (action.type === 'expire') {
    const remaining = state.effects.filter(
      (effect) => effect.expiresAt === null || effect.expiresAt > action.now,
    );
    return remaining.length === state.effects.length ? state : { ...state, effects: remaining };
  }

  const { event, now } = action;

  switch (event.type) {
    case 'scene.change':
      return {
        ...state,
        sceneId: event.payload.sceneId,
        transitionMs: event.payload.transitionMs,
        sceneRevision: state.sceneRevision + 1,
        lastEventAt: now,
      };

    case 'effect.trigger': {
      const { effectId, intensity, durationMs } = event.payload;
      const next: ActiveEffectState = {
        effectId,
        intensity,
        startedAt: now,
        expiresAt: durationMs === null ? null : now + durationMs,
        instance: instanceOf(state.effects, effectId),
      };
      return {
        ...state,
        effects: [...withoutEffect(state.effects, effectId), next],
        lastEventAt: now,
      };
    }

    case 'effect.clear':
      return {
        ...state,
        effects:
          event.payload.effectId === null
            ? []
            : withoutEffect(state.effects, event.payload.effectId),
        lastEventAt: now,
      };

    case 'state.sync': {
      const sceneChanged = event.payload.sceneId !== state.sceneId;
      return {
        ...state,
        sceneId: event.payload.sceneId,
        sceneRevision: sceneChanged ? state.sceneRevision + 1 : state.sceneRevision,
        effects: event.payload.effects.map((effect, index) => ({
          effectId: effect.effectId,
          intensity: effect.intensity,
          startedAt: now,
          expiresAt: effect.durationMs === null ? null : now + effect.durationMs,
          instance: index,
        })),
        lastEventAt: now,
      };
    }

    case 'scene.action':
      // Transient: an action is performed by the scene director, once, and is
      // never part of renderer state. Leaving state untouched also means a
      // reconnect has nothing to replay.
      return state;

    default:
      return state;
  }
}

export function activeEffect(
  state: RendererState,
  effectId: EffectId,
): ActiveEffectState | undefined {
  return state.effects.find((effect) => effect.effectId === effectId);
}
