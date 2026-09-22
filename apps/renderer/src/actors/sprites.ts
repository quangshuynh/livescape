/**
 * The allowlist of actor artwork. Scene definitions name sprites by id; the
 * drawings themselves live in `SpriteArt.tsx`.
 *
 * Sizes are in scene units at scale 1, and every sprite is drawn facing right.
 */
export const SPRITE_SIZES = {
  'light-streak': { width: 211, height: 3 },
  sedan: { width: 170, height: 56 },
  hatchback: { width: 140, height: 56 },
  van: { width: 184, height: 78 },
  bus: { width: 400, height: 116 },
  cyclist: { width: 62, height: 66 },
  pedestrian: { width: 26, height: 74 },
  bird: { width: 18, height: 10 },
  leaf: { width: 18, height: 12 },
  cat: { width: 58, height: 34 },
} as const satisfies Record<string, { width: number; height: number }>;

export type SpriteId = keyof typeof SPRITE_SIZES;

export function isSpriteId(value: unknown): value is SpriteId {
  return typeof value === 'string' && Object.hasOwn(SPRITE_SIZES, value);
}
