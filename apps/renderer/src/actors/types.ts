import type { SpriteId } from './sprites.js';

/**
 * Scene composition vocabulary.
 *
 * Scenes are described as data: which sprite, which plane, which path, how
 * often. The behaviours below are the whole of what an actor can do. There is
 * no hook for a scene to run its own code per actor.
 */

/**
 * The planes a scene can draw into, back to front. The camera subject sits
 * between `environment` and `foreground`; see `compositor/layers.ts` for the
 * full stage order, including the effect planes.
 *
 * * `backdrop` is the far world: sky, street, anything seen through an opening.
 * * `environment` is the near set around the subject: walls, floor, props.
 * * `foreground` is drawn in front of the subject.
 */
export const SCENE_LAYERS = ['backdrop', 'environment', 'foreground'] as const;
export type SceneLayer = (typeof SCENE_LAYERS)[number];

/** Inclusive `[min, max]`. Equal bounds make a value fixed. */
export type Range = readonly [min: number, max: number];

/**
 * Scene units: every scene is authored on a 960x540 canvas that is scaled to
 * cover the stage, anchored bottom-centre, exactly like the scene artwork's
 * `preserveAspectRatio="xMidYMax slice"`. Actors and artwork share one
 * coordinate system, so a car drawn on a road stays on that road at any size.
 */
export const SCENE_WIDTH = 960;
export const SCENE_HEIGHT = 540;

/** Crosses the scene horizontally, entering and leaving fully off screen. */
export interface TraverseBehavior {
  readonly kind: 'traverse';
  readonly direction: 'left' | 'right' | 'either';
  /** Where the actor's bottom edge runs, in scene units. */
  readonly baseline: Range;
  /** Scene units per second. */
  readonly speed: Range;
}

/** Travels in a straight line from a start region by a displacement. */
export interface PathBehavior {
  readonly kind: 'path';
  /** Top-left corner of the actor at spawn, in scene units. */
  readonly from: { readonly x: Range; readonly y: Range };
  /** Displacement over the actor's lifetime, in scene units. */
  readonly travel: { readonly x: Range; readonly y: Range };
  readonly durationMs: Range;
}

export type ActorBehavior = TraverseBehavior | PathBehavior;

export interface SpawnRule {
  /** Delay before the first spawn once the scene is showing. */
  readonly initialDelayMs: Range;
  /** Delay between spawns. */
  readonly intervalMs: Range;
  /** How many actors one spawn produces; a gust of leaves, a flock. */
  readonly burst?: Range;
  /** This spawner never has more than this many actors alive. */
  readonly maxAlive: number;
}

export interface ActorSpawnerDefinition {
  /** Unique within the scene. */
  readonly id: string;
  /** Human-readable, for the local setup panel. */
  readonly label: string;
  /** One is chosen per actor. */
  readonly sprites: readonly SpriteId[];
  readonly layer: SceneLayer;
  readonly behavior: ActorBehavior;
  readonly scale: Range;
  readonly opacity?: Range;
  /** Colour variations, `#rrggbb`. One is chosen per actor. */
  readonly tints?: readonly string[];
  /**
   * Spawners that share a lane never overlap: a lane holds one actor at a
   * time, so a fast car cannot drive through a slow bus.
   */
  readonly lane?: string;
  readonly spawn: SpawnRule;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A live actor. Its motion is fully determined at spawn. */
export interface ActorInstance {
  readonly id: number;
  readonly spawnerId: string;
  readonly sprite: SpriteId;
  readonly layer: SceneLayer;
  readonly lane: string | null;
  readonly spawnedAt: number;
  readonly lifetimeMs: number;
  /** Top-left corner at spawn and at the end of its life, in scene units. */
  readonly from: Point;
  readonly to: Point;
  /** Size after scaling, in scene units. */
  readonly width: number;
  readonly height: number;
  readonly facing: 'left' | 'right';
  /**
   * Stacking order within the actor's plane: the scene-unit y of its ground
   * line at spawn. Lower on screen reads as nearer, so a car in the near lane
   * always passes in front of one in the far lane.
   */
  readonly depth: number;
  readonly opacity: number;
  readonly tint: string | null;
}
