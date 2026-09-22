import type { EngineClock } from '../actors/engine.js';

/**
 * A clock and timer queue the test advances by hand, so actor spawning and
 * scene transitions never depend on the wall clock.
 */
export class FakeClock implements EngineClock {
  time = 0;
  private next = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now = (): number => this.time;

  setTimeout = (callback: () => void, ms: number): number => {
    const handle = this.next++;
    this.timers.set(handle, { at: this.time + ms, callback });
    return handle;
  };

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  get pending(): number {
    return this.timers.size;
  }

  /** Moves time forward, firing every timer that falls due, in order. */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let dueHandle: number | null = null;
      let dueAt = Infinity;
      for (const [handle, timer] of this.timers) {
        if (timer.at <= end && timer.at < dueAt) {
          dueAt = timer.at;
          dueHandle = handle;
        }
      }
      if (dueHandle === null) break;
      const timer = this.timers.get(dueHandle);
      this.timers.delete(dueHandle);
      this.time = Math.max(this.time, dueAt);
      timer?.callback();
    }
    this.time = end;
  }
}
