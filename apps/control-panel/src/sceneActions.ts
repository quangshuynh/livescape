import { isSceneActionId, isSceneId, sceneActionEntry, sceneEntry, type SceneActionId } from '@livescape/protocol';

import { EventServerError } from './api.js';

/**
 * Feedback for the scene action controls: one short line that is replaced by
 * each request, rather than a notification per click, so rapid testing stays
 * readable.
 */
export interface ActionFeedback {
  readonly actionId: SceneActionId;
  readonly tone: 'ok' | 'wait' | 'error';
  readonly text: string;
}

function sceneLabel(sceneId: unknown): string {
  return isSceneId(sceneId) ? sceneEntry(sceneId).label : 'another scene';
}

export function acceptedFeedback(actionId: SceneActionId, deliveredTo: number): ActionFeedback {
  const { label } = sceneActionEntry(actionId);
  return {
    actionId,
    tone: deliveredTo > 0 ? 'ok' : 'wait',
    // `deliveredTo` counts every socket client, this panel's activity feed
    // included, so it is reported as clients rather than renderers.
    text:
      deliveredTo > 0
        ? `${label} sent to ${deliveredTo} connected client${deliveredTo === 1 ? '' : 's'}.`
        : `${label} accepted, but no client is connected to show it.`,
  };
}

export function rejectedFeedback(actionId: SceneActionId, error: unknown): ActionFeedback {
  const { label, sceneId } = sceneActionEntry(actionId);
  if (error instanceof EventServerError) {
    if (error.status === 429) {
      const seconds = ((error.retryAfterMs ?? 0) / 1000).toFixed(1);
      return { actionId, tone: 'wait', text: `${label} is cooling down; ready in ${seconds} s.` };
    }
    if (error.status === 409) {
      return {
        actionId,
        tone: 'error',
        text: `${label} belongs to ${sceneLabel(sceneId)}, which is not the current scene.`,
      };
    }
    if (error.status === null) return { actionId, tone: 'error', text: `${label} not sent: ${error.message}.` };
    return { actionId, tone: 'error', text: `${label} rejected: ${error.message}.` };
  }
  return { actionId, tone: 'error', text: `${label} not sent: unexpected error.` };
}

/** Epoch-millisecond deadlines until which each action is known to be cooling down. */
export type CooldownDeadlines = Readonly<Partial<Record<SceneActionId, number>>>;

/** Remaining cooldown in milliseconds, 0 when the action is ready. */
export function cooldownRemaining(deadlines: CooldownDeadlines, actionId: SceneActionId, now: number): number {
  return Math.max(0, (deadlines[actionId] ?? 0) - now);
}

/**
 * Folds the server's view of running cooldowns into the local one. The later
 * deadline wins, so a cooldown started by another event source (a second
 * operator, or later a platform adapter) shows up here too.
 */
export function mergeCooldowns(
  deadlines: CooldownDeadlines,
  remaining: Readonly<Record<string, number>> | undefined,
  now: number,
): CooldownDeadlines {
  if (!remaining) return deadlines;
  let next: Partial<Record<SceneActionId, number>> | null = null;
  for (const [actionId, ms] of Object.entries(remaining)) {
    if (!isSceneActionId(actionId) || !Number.isFinite(ms)) continue;
    const deadline = now + ms;
    if ((deadlines[actionId] ?? 0) < deadline) {
      next ??= { ...deadlines };
      next[actionId] = deadline;
    }
  }
  return next ?? deadlines;
}
