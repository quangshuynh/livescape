import { ActorPopulation } from './population.js';
import { SCENE_LAYERS, type ActorInstance, type ActorSpawnerDefinition, type SceneLayer } from './types.js';

/** Never wake more often than this, however close the next deadline is. */
const MIN_WAKE_MS = 16;

export interface EngineClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserClock: EngineClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

export interface ActorCounts {
  readonly total: number;
  readonly byLayer: Readonly<Record<SceneLayer, number>>;
}

export const NO_ACTORS: ActorCounts = {
  total: 0,
  byLayer: { backdrop: 0, environment: 0, foreground: 0 },
};

export interface ActorEngineOptions {
  readonly spawners: readonly ActorSpawnerDefinition[];
  readonly maxActors: number;
  readonly random: () => number;
  readonly reducedMotion: boolean;
  readonly clock?: EngineClock;
}

/**
 * Runs one scene's actor population on a single timer.
 *
 * The engine only wakes when something is due: the next spawn or the next
 * actor reaching the end of its path. It never runs per frame. Motion itself
 * is handed to the browser as a compositor animation by `ActorPlane`, so a
 * busy main thread (segmentation runs there) does not stutter the traffic.
 */
export class ActorEngine {
  private readonly population: ActorPopulation;
  private readonly clock: EngineClock;
  private readonly listeners = new Set<() => void>();
  private timer: unknown = null;
  private byLayer: Record<SceneLayer, readonly ActorInstance[]> = emptyLayers();
  private countsCache: ActorCounts = NO_ACTORS;

  readonly spawners: readonly ActorSpawnerDefinition[];

  constructor(options: ActorEngineOptions) {
    this.spawners = options.spawners;
    this.clock = options.clock ?? browserClock;
    this.population = new ActorPopulation(options.spawners, {
      random: options.random,
      maxActors: options.maxActors,
      reducedMotion: options.reducedMotion,
    });
  }

  /** The engine's clock, bound so views can hold on to it. */
  readonly clockNow = (): number => this.clock.now();

  get actors(): readonly ActorInstance[] {
    return this.population.actors;
  }

  /** Stable between changes, so it is safe as a `useSyncExternalStore` snapshot. */
  actorsIn(layer: SceneLayer): readonly ActorInstance[] {
    return this.byLayer[layer];
  }

  counts(): ActorCounts {
    return this.countsCache;
  }

  /** Whether a timer is currently pending. Exposed for tests and diagnostics. */
  get scheduled(): boolean {
    return this.timer !== null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start(): void {
    this.population.start(this.clock.now());
    this.wake();
  }

  /** Stop spawning; actors already on screen finish their path. */
  retire(): void {
    this.population.retire();
    this.reschedule();
  }

  /** Stop everything, remove every actor and cancel the timer. */
  stop(): void {
    this.cancel();
    if (this.population.stop()) this.publish();
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.population.setReducedMotion(reducedMotion, this.clock.now())) this.publish();
    this.wake();
  }

  /** Spawn from one spawner now, subject to the usual caps. */
  trigger(spawnerId: string): number {
    const spawned = this.population.trigger(spawnerId, this.clock.now());
    if (spawned.length > 0) {
      this.publish();
      this.reschedule();
    }
    return spawned.length;
  }

  private wake = (): void => {
    // Also called directly (start, reduced motion), when a timer may still be
    // pending: cancel it rather than orphan it.
    this.cancel();
    if (this.population.advance(this.clock.now())) this.publish();
    this.reschedule();
  };

  private reschedule(): void {
    this.cancel();
    const due = this.population.nextDueAt();
    if (due === null) return;
    const delay = Math.max(MIN_WAKE_MS, due - this.clock.now());
    this.timer = this.clock.setTimeout(this.wake, delay);
  }

  private cancel(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private publish(): void {
    const layers = emptyLayers();
    for (const actor of this.population.actors) {
      (layers[actor.layer] as ActorInstance[]).push(actor);
    }
    // Keep a plane's snapshot identical when its actors did not change, so
    // only the plane that gained or lost an actor re-renders.
    for (const layer of SCENE_LAYERS) {
      if (sameActors(layers[layer], this.byLayer[layer])) layers[layer] = this.byLayer[layer];
    }
    this.byLayer = layers;
    this.countsCache = {
      total: this.population.actors.length,
      byLayer: {
        backdrop: layers.backdrop.length,
        environment: layers.environment.length,
        foreground: layers.foreground.length,
      },
    };
    for (const listener of this.listeners) listener();
  }
}

function sameActors(a: readonly ActorInstance[], b: readonly ActorInstance[]): boolean {
  return a.length === b.length && a.every((actor, index) => actor === b[index]);
}

function emptyLayers(): Record<SceneLayer, readonly ActorInstance[]> {
  return Object.fromEntries(SCENE_LAYERS.map((layer) => [layer, []])) as unknown as Record<
    SceneLayer,
    readonly ActorInstance[]
  >;
}
