import type { EffectId } from '@livescape/protocol';

import type { SceneLayer } from '../actors/types.js';

/**
 * The renderer composites back to front:
 *
 * ```text
 * backdrop            scene: the far world (sky, street) and its actors
 * environment         scene: the near set around the subject and its actors
 * vignette            scene framing
 * background-effects  effects that belong behind the subject
 * subject             the local camera subject, raw or segmented
 * foreground          scene: artwork and actors in front of the subject
 * foreground-effects  effects that fall in front of everything in the scene
 * debug / setup       local only, never in the OBS output
 * ```
 *
 * This list is the single source of the stacking order: every stage layer
 * takes its z-index from `stageZIndex`, never from a stylesheet.
 */
export const STAGE_LAYERS = [
  'backdrop',
  'environment',
  'vignette',
  'background-effects',
  'subject',
  'foreground',
  'foreground-effects',
  'debug',
  'setup',
] as const;

export type StageLayer = (typeof STAGE_LAYERS)[number];

export function stageZIndex(layer: StageLayer): number {
  return STAGE_LAYERS.indexOf(layer) + 1;
}

/** Scene planes are stage layers of the same name. */
export function scenePlaneZIndex(layer: SceneLayer): number {
  return stageZIndex(layer);
}

export type EffectPlane = 'background' | 'foreground';

export function effectPlaneZIndex(plane: EffectPlane): number {
  return stageZIndex(plane === 'background' ? 'background-effects' : 'foreground-effects');
}

/**
 * Which side of the subject each effect is drawn on.
 *
 * Weather is what sells a person standing inside a scene rather than pasted on
 * top of it, so rain and snow fall in front, over the scene's foreground too.
 * Fireworks read as distant sky, so they stay behind the subject; they are
 * still drawn over the scene's own artwork, including a room's walls.
 */
export const EFFECT_PLANE: Record<EffectId, EffectPlane> = {
  rain: 'foreground',
  snow: 'foreground',
  fireworks: 'background',
};

export function planeOf(effectId: EffectId): EffectPlane {
  return EFFECT_PLANE[effectId];
}
