import {
  effectTriggerRequest,
  type EffectId,
  type EffectTriggerRequest,
} from '@livescape/protocol';

import { quantityToIntensity } from './api.js';

/**
 * Development stand-ins for viewer actions.
 *
 * LiveScape is not connected to any livestream platform. This module exists to
 * demonstrate the adapter boundary: a platform adapter's only job is to turn
 * some external action into a normalized LiveScape event. Everything below the
 * boundary -- the event server and the renderer -- sees only the envelope.
 */
export const SIMULATED_ACTIONS = [
  { id: 'gift', label: 'Gift received', usesQuantity: true },
  { id: 'follow', label: 'New follower', usesQuantity: false },
  { id: 'chat-command', label: 'Chat command', usesQuantity: false },
] as const;

export type SimulatedActionId = (typeof SIMULATED_ACTIONS)[number]['id'];

/** Intensity a single follow is worth, independent of any quantity. */
export const FOLLOW_INTENSITY = 0.3;

export function simulatedActionUsesQuantity(action: SimulatedActionId): boolean {
  return SIMULATED_ACTIONS.find((item) => item.id === action)?.usesQuantity ?? false;
}

/**
 * Maps a simulated action onto a normalized `effect.trigger` request.
 *
 * Gift quantity scales the effect; a follow is a fixed gentle burst; a chat
 * command is treated as an explicit request and runs at full intensity.
 */
export function simulatedActionRequest(
  action: SimulatedActionId,
  effectId: EffectId,
  quantity: number,
): EffectTriggerRequest {
  const intensity =
    action === 'gift'
      ? quantityToIntensity(quantity)
      : action === 'follow'
        ? FOLLOW_INTENSITY
        : 1;

  return effectTriggerRequest(effectId, { source: 'simulation', intensity });
}
