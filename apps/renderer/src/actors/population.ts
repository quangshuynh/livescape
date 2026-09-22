import { SPRITE_SIZES } from './sprites.js';
import {
  SCENE_WIDTH,
  type ActorInstance,
  type ActorSpawnerDefinition,
  type Point,
  type Range,
} from './types.js';
import { MAX_ACTORS_PER_SCENE } from './validate.js';

/** Actors spawned on demand under reduced motion move at this fraction of speed. */
export const REDUCED_MOTION_SPEED = 0.5;
/** How long a spawner waits before retrying when its lane is occupied. */
export const LANE_RETRY_MS: Range = [800, 2400];

export interface PopulationOptions {
  readonly random: () => number;
  /** Clamped to `MAX_ACTORS_PER_SCENE`. */
  readonly maxActors: number;
  readonly reducedMotion: boolean;
}

function between(random: () => number, [min, max]: Range): number {
  return min + (max - min) * random();
}

function wholeBetween(random: () => number, [min, max]: Range): number {
  return Math.min(max, Math.floor(min + (max - min + 1) * random()));
}

function pick<T>(random: () => number, items: readonly T[]): T {
  const index = Math.min(items.length - 1, Math.floor(random() * items.length));
  return items[index] as T;
}

/** Where an actor is at `now`: linear motion, clamped to its lifetime. */
export function positionAt(actor: ActorInstance, now: number): Point {
  const t = Math.min(1, Math.max(0, (now - actor.spawnedAt) / actor.lifetimeMs));
  return {
    x: actor.from.x + (actor.to.x - actor.from.x) * t,
    y: actor.from.y + (actor.to.y - actor.from.y) * t,
  };
}

/**
 * Translation as a percentage of the actor's own box. The box is sized as a
 * percentage of the scene frame, so the motion scales with the stage and no
 * layout measurement is ever needed.
 */
export function actorTransform(actor: ActorInstance, point: Point): string {
  const x = (point.x / actor.width) * 100;
  const y = (point.y / actor.height) * 100;
  return `translate3d(${x.toFixed(3)}%, ${y.toFixed(3)}%, 0)`;
}

export function expiresAt(actor: ActorInstance): number {
  return actor.spawnedAt + actor.lifetimeMs;
}

/**
 * Builds one actor. Every random choice happens here, in a fixed order, so a
 * seeded generator reproduces the same scene exactly.
 */
export function createActor(
  spawner: ActorSpawnerDefinition,
  id: number,
  now: number,
  random: () => number,
  speedScale = 1,
): ActorInstance {
  const sprite = pick(random, spawner.sprites);
  const size = SPRITE_SIZES[sprite];
  const scale = between(random, spawner.scale);
  const width = size.width * scale;
  const height = size.height * scale;
  const opacity = spawner.opacity ? between(random, spawner.opacity) : 1;
  const tint = spawner.tints && spawner.tints.length > 0 ? pick(random, spawner.tints) : null;
  const base = {
    id,
    spawnerId: spawner.id,
    sprite,
    layer: spawner.layer,
    lane: spawner.lane ?? null,
    spawnedAt: now,
    width,
    height,
    opacity,
    tint,
  };

  const { behavior } = spawner;
  if (behavior.kind === 'traverse') {
    const direction =
      behavior.direction === 'either' ? (random() < 0.5 ? 'left' : 'right') : behavior.direction;
    const baseline = between(random, behavior.baseline);
    const y = baseline - height;
    const speed = between(random, behavior.speed) * speedScale;
    const start = direction === 'right' ? -width : SCENE_WIDTH;
    const end = direction === 'right' ? SCENE_WIDTH : -width;
    return {
      ...base,
      from: { x: start, y },
      to: { x: end, y },
      lifetimeMs: ((SCENE_WIDTH + width) / speed) * 1000,
      facing: direction,
      depth: Math.round(baseline),
    };
  }

  const from = { x: between(random, behavior.from.x), y: between(random, behavior.from.y) };
  const dx = between(random, behavior.travel.x);
  const dy = between(random, behavior.travel.y);
  return {
    ...base,
    from,
    to: { x: from.x + dx, y: from.y + dy },
    lifetimeMs: between(random, behavior.durationMs) / speedScale,
    facing: dx < 0 ? 'left' : 'right',
    depth: Math.round(from.y + height),
  };
}

type Phase = 'idle' | 'running' | 'retired';

/**
 * The actors of one scene, as a pure function of time.
 *
 * Nothing in here reads a clock or sets a timer: the caller passes `now` and
 * asks when it next needs to be woken. That keeps spawning, traversal, caps
 * and cleanup testable without a browser and without wall-clock randomness.
 */
export class ActorPopulation {
  private readonly spawners: readonly ActorSpawnerDefinition[];
  private readonly random: () => number;
  private readonly maxActors: number;
  private reducedMotion: boolean;
  private phase: Phase = 'idle';
  private list: ActorInstance[] = [];
  private readonly schedule = new Map<string, number>();
  private nextId = 1;

  constructor(spawners: readonly ActorSpawnerDefinition[], options: PopulationOptions) {
    this.spawners = spawners;
    this.random = options.random;
    this.maxActors = Math.max(0, Math.min(MAX_ACTORS_PER_SCENE, options.maxActors));
    this.reducedMotion = options.reducedMotion;
  }

  get actors(): readonly ActorInstance[] {
    return this.list;
  }

  /** Whether ambient spawning is currently scheduled. */
  get spawning(): boolean {
    return this.schedule.size > 0;
  }

  /** Begins ambient spawning. Reduced motion holds the scene still instead. */
  start(now: number): void {
    this.phase = 'running';
    this.scheduleAll(now);
  }

  /**
   * Stops spawning but lets the actors already on screen finish their path.
   * Used for a scene that is fading out.
   */
  retire(): void {
    this.phase = 'retired';
    this.schedule.clear();
  }

  /** Stops everything and removes every actor. */
  stop(): boolean {
    this.phase = 'idle';
    this.schedule.clear();
    return this.clear();
  }

  /**
   * Reduced motion removes ambient actors and stops spawning; switching it
   * off again resumes the scene as if it had just started.
   */
  setReducedMotion(reducedMotion: boolean, now: number): boolean {
    if (reducedMotion === this.reducedMotion) return false;
    this.reducedMotion = reducedMotion;
    if (reducedMotion) {
      this.schedule.clear();
      return this.clear();
    }
    if (this.phase === 'running') this.scheduleAll(now);
    return false;
  }

  /** Removes finished actors and spawns whatever is due. Returns whether anything changed. */
  advance(now: number): boolean {
    let changed = this.expire(now);
    for (const spawner of this.spawners) {
      const due = this.schedule.get(spawner.id);
      if (due === undefined || due > now) continue;

      if (this.laneBusy(spawner)) {
        this.schedule.set(spawner.id, now + between(this.random, LANE_RETRY_MS));
        continue;
      }
      const burst = spawner.spawn.burst ? wholeBetween(this.random, spawner.spawn.burst) : 1;
      if (this.spawnFrom(spawner, burst, now, 1).length > 0) changed = true;
      // Late timers never cause a catch-up burst: the next spawn is measured
      // from now, not from when this one was due.
      this.schedule.set(spawner.id, now + between(this.random, spawner.spawn.intervalMs));
    }
    return changed;
  }

  /**
   * Spawns from one spawner immediately, within the same caps as ambient
   * spawning. This is the internal hook a future event-driven action would
   * use; nothing in the protocol reaches it today.
   */
  trigger(spawnerId: string, now: number): readonly ActorInstance[] {
    const spawner = this.spawners.find((candidate) => candidate.id === spawnerId);
    if (!spawner || this.phase !== 'running') return [];
    this.expire(now);
    if (this.laneBusy(spawner)) return [];
    const burst = spawner.spawn.burst ? wholeBetween(this.random, spawner.spawn.burst) : 1;
    return this.spawnFrom(spawner, burst, now, this.reducedMotion ? REDUCED_MOTION_SPEED : 1);
  }

  /** The next time `advance` has something to do, or `null` for never. */
  nextDueAt(): number | null {
    let next: number | null = null;
    for (const due of this.schedule.values()) next = next === null ? due : Math.min(next, due);
    for (const actor of this.list) {
      const end = expiresAt(actor);
      next = next === null ? end : Math.min(next, end);
    }
    return next;
  }

  private scheduleAll(now: number): void {
    this.schedule.clear();
    if (this.reducedMotion) return;
    for (const spawner of this.spawners) {
      this.schedule.set(spawner.id, now + between(this.random, spawner.spawn.initialDelayMs));
    }
  }

  private expire(now: number): boolean {
    const alive = this.list.filter((actor) => expiresAt(actor) > now);
    if (alive.length === this.list.length) return false;
    this.list = alive;
    return true;
  }

  private clear(): boolean {
    if (this.list.length === 0) return false;
    this.list = [];
    return true;
  }

  private laneBusy(spawner: ActorSpawnerDefinition): boolean {
    return spawner.lane !== undefined && this.list.some((actor) => actor.lane === spawner.lane);
  }

  private spawnFrom(
    spawner: ActorSpawnerDefinition,
    requested: number,
    now: number,
    speedScale: number,
  ): ActorInstance[] {
    const alive = this.list.filter((actor) => actor.spawnerId === spawner.id).length;
    // A lane holds one actor, so a burst into a lane is a single actor.
    const wanted = spawner.lane === undefined ? requested : 1;
    const room = Math.min(
      wanted,
      spawner.spawn.maxAlive - alive,
      this.maxActors - this.list.length,
    );
    const spawned: ActorInstance[] = [];
    for (let index = 0; index < room; index += 1) {
      spawned.push(createActor(spawner, this.nextId++, now, this.random, speedScale));
    }
    if (spawned.length > 0) this.list = [...this.list, ...spawned];
    return spawned;
  }
}
