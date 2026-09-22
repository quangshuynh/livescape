import type { EffectId } from '@livescape/protocol';

/**
 * The renderer composites back to front:
 *
 * ```text
 * scene            z 1-2   the LiveScape environment, crossfading
 * vignette         z 3     scene framing
 * background       z 4     effects that belong behind the subject
 * camera subject   z 5     the locally segmented person
 * foreground       z 6     effects that fall between camera and subject
 * debug / setup    z 7-8   local only, never in the OBS output
 * ```
 *
 * The z-indexes themselves live in `styles.css`; this module owns the part
 * that needs to be shared with the effect system.
 */
export type EffectPlane = 'background' | 'foreground';

/**
 * Which side of the subject each effect is drawn on.
 *
 * Weather is what sells a person standing inside a scene rather than pasted on
 * top of it, so rain and snow fall in front. Fireworks read as distant sky, so
 * they stay behind.
 */
export const EFFECT_PLANE: Record<EffectId, EffectPlane> = {
  rain: 'foreground',
  snow: 'foreground',
  fireworks: 'background',
};

export function planeOf(effectId: EffectId): EffectPlane {
  return EFFECT_PLANE[effectId];
}
