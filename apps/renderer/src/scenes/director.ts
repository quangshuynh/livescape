import { sceneActionEntry, type SceneActionId, type SceneId } from '@livescape/protocol';

import { browserClock, NO_ACTORS, type ActorCounts, type ActorEngine, type EngineClock } from '../actors/engine.js';
import type { ActionOutcome } from '../actors/population.js';
import { SCENE_LAYERS } from '../actors/types.js';
import { createSceneEngine, type SceneDefinition } from './definition.js';
import { mulberry32 } from './random.js';

/** One showing of a scene. A scene shown twice gets two instances. */
export interface SceneInstance {
  readonly key: number;
  readonly sceneId: SceneId;
  readonly definition: SceneDefinition;
  readonly engine: ActorEngine;
  /** `in` is the scene being shown; `out` is fading away underneath it. */
  readonly role: 'in' | 'out';
  readonly transitionMs: number;
}

/** `wrong-scene`: the action belongs to a scene that is not the one showing. */
export type SceneActionResult = ActionOutcome | 'wrong-scene';

/** The most recent action request, for local diagnostics. */
export interface SceneActionRecord {
  readonly actionId: SceneActionId;
  readonly result: SceneActionResult;
  readonly at: number;
}

export interface SceneDirectorOptions {
  readonly scenes: Readonly<Record<SceneId, SceneDefinition>>;
  readonly initialScene: SceneId;
  readonly reducedMotion: boolean;
  readonly clock?: EngineClock;
  /** Randomness for one showing. Defaults to a generator seeded per scene and showing. */
  readonly randomFor?: (definition: SceneDefinition, key: number) => () => number;
}

function seededRandom(definition: SceneDefinition, key: number): () => number {
  return mulberry32(definition.seed + key * 7919);
}

/**
 * Owns the scenes on stage: which one is showing, which one is fading out,
 * and the actor engine each of them runs.
 *
 * A scene change retires the outgoing scene's engine immediately (no new
 * actors), keeps its artwork and remaining actors for the crossfade, and then
 * stops it, which removes every actor it owned. At most two scenes exist at
 * once. None of this touches the camera: the director knows nothing about it.
 */
export class SceneDirector {
  private readonly options: SceneDirectorOptions;
  private readonly clock: EngineClock;
  private reducedMotion: boolean;
  private running = false;
  private nextKey = 1;
  private instances: readonly SceneInstance[];
  private outgoingTimer: unknown = null;
  private readonly listeners = new Set<() => void>();
  private readonly activityListeners = new Set<() => void>();
  private readonly engineSubscriptions = new Map<ActorEngine, () => void>();
  private countsCache: ActorCounts | null = null;
  private last: SceneActionRecord | null = null;

  constructor(options: SceneDirectorOptions) {
    this.options = options;
    this.clock = options.clock ?? browserClock;
    this.reducedMotion = options.reducedMotion;
    this.instances = [this.createInstance(options.initialScene, 0)];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly SceneInstance[] => this.instances;

  /** Fires whenever any scene's actor population changes. Diagnostics only. */
  subscribeActivity = (listener: () => void): (() => void) => {
    this.activityListeners.add(listener);
    return () => {
      this.activityListeners.delete(listener);
    };
  };

  /** Live actors across every scene on stage, including one fading out. */
  getActorCounts = (): ActorCounts => {
    if (this.countsCache) return this.countsCache;
    let total = 0;
    let triggered = 0;
    const byLayer = { ...NO_ACTORS.byLayer };
    for (const instance of this.instances) {
      const counts = instance.engine.counts();
      total += counts.total;
      triggered += counts.triggered;
      for (const layer of SCENE_LAYERS) byLayer[layer] += counts.byLayer[layer];
    }
    const counts: ActorCounts = { total, byLayer, triggered };
    this.countsCache = counts;
    return counts;
  };

  /** The most recent action request and what became of it. Diagnostics only. */
  get lastAction(): SceneActionRecord | null {
    return this.last;
  }

  /**
   * Routes a scene action to the scene showing now. An action only ever
   * reaches the scene the registry says owns it; anything else is refused
   * here, whatever the event server decided, and never touches another
   * scene's actors. A scene that is fading out never receives actions.
   */
  act(actionId: SceneActionId): SceneActionResult {
    const current = this.current;
    let result: SceneActionResult;
    if (sceneActionEntry(actionId).sceneId !== current.sceneId) result = 'wrong-scene';
    else if (!this.running) result = 'inactive';
    else result = current.engine.act(actionId);
    this.last = { actionId, result, at: this.clock.now() };
    this.onActivity();
    return result;
  }

  get current(): SceneInstance {
    return this.instances[this.instances.length - 1] as SceneInstance;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.current.engine.start();
  }

  /** Stops every engine and drops a scene that was fading out. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.clearOutgoingTimer();
    for (const instance of this.instances) instance.engine.stop();
    this.dropOutgoing();
  }

  show(sceneId: SceneId, transitionMs: number): void {
    const current = this.current;
    if (current.sceneId === sceneId) return;

    this.clearOutgoingTimer();
    for (const instance of this.instances) {
      if (instance !== current) this.release(instance);
    }

    current.engine.retire();
    const outgoing: SceneInstance = { ...current, role: 'out', transitionMs };
    const incoming = this.createInstance(sceneId, transitionMs);
    if (this.running) incoming.engine.start();

    const duration = Math.max(0, transitionMs);
    if (duration === 0) {
      this.release(current);
      this.setInstances([incoming]);
      return;
    }
    this.setInstances([outgoing, incoming]);
    this.outgoingTimer = this.clock.setTimeout(() => {
      this.outgoingTimer = null;
      this.dropOutgoing();
    }, duration);
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (reducedMotion === this.reducedMotion) return;
    this.reducedMotion = reducedMotion;
    for (const instance of this.instances) instance.engine.setReducedMotion(reducedMotion);
  }

  private createInstance(sceneId: SceneId, transitionMs: number): SceneInstance {
    const definition = this.options.scenes[sceneId];
    const key = this.nextKey++;
    const engine = createSceneEngine(definition, {
      reducedMotion: this.reducedMotion,
      random: (this.options.randomFor ?? seededRandom)(definition, key),
      clock: this.clock,
    });
    this.engineSubscriptions.set(engine, engine.subscribe(this.onActivity));
    return { key, sceneId, definition, engine, role: 'in', transitionMs };
  }

  private release(instance: SceneInstance): void {
    instance.engine.stop();
    this.engineSubscriptions.get(instance.engine)?.();
    this.engineSubscriptions.delete(instance.engine);
  }

  private dropOutgoing(): void {
    const current = this.current;
    const outgoing = this.instances.filter((instance) => instance !== current);
    if (outgoing.length === 0) return;
    for (const instance of outgoing) this.release(instance);
    this.setInstances([current]);
  }

  private clearOutgoingTimer(): void {
    if (this.outgoingTimer !== null) {
      this.clock.clearTimeout(this.outgoingTimer);
      this.outgoingTimer = null;
    }
  }

  private setInstances(instances: readonly SceneInstance[]): void {
    this.instances = instances;
    for (const listener of this.listeners) listener();
    this.onActivity();
  }

  private onActivity = (): void => {
    this.countsCache = null;
    for (const listener of this.activityListeners) listener();
  };
}
