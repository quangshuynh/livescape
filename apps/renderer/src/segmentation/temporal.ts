import { clamp, smoothstep } from './math.js';

/**
 * Per-pixel confidence change below which a difference is treated as noise and
 * smoothed at full strength.
 */
export const MOTION_LOW = 0.08;
/**
 * Per-pixel confidence change above which a difference is treated as real
 * motion and passed through with no smoothing at all.
 */
export const MOTION_HIGH = 0.35;

/**
 * Weight kept from the previous estimate for one pixel.
 *
 * A plain moving average keeps the same weight everywhere, which is why it
 * trades flicker for a ghost: the pixels a moving hand has just left keep
 * claiming "person" for several frames, and the room shows through them. Here
 * the weight falls to zero as the change grows, so a confident change (a hand
 * arriving or leaving) lands in a single frame while small jitter on a still
 * edge is averaged away.
 */
export function temporalKeep(delta: number, smoothing: number): number {
  const motion = smoothstep(MOTION_LOW, MOTION_HIGH, Math.abs(delta));
  return clamp(smoothing, 0, 0.9) * (1 - motion);
}

/**
 * Motion-gated temporal filter over confidence masks.
 *
 * It holds exactly one frame of history, the filtered confidence, and works on
 * confidence rather than on thresholded coverage so that a pixel hovering near
 * the threshold is steadied before it can flip.
 */
export class TemporalMatteFilter {
  private state: Float32Array | null = null;

  /** Number of pixels of history held; 0 after a reset. */
  get size(): number {
    return this.state?.length ?? 0;
  }

  reset(): void {
    this.state = null;
  }

  /**
   * Folds `confidence` into the history and writes the filtered result to
   * `out`, which may be the same array as `confidence`. The first frame, and
   * any frame whose size differs from the history, passes straight through.
   */
  apply(confidence: Float32Array, count: number, smoothing: number, out: Float32Array): void {
    let state = this.state;
    if (!state || state.length !== count) {
      state = new Float32Array(count);
      state.set(confidence.subarray(0, count));
      this.state = state;
      if (out !== confidence) out.set(state);
      return;
    }

    const keepMax = clamp(smoothing, 0, 0.9);
    if (keepMax === 0) {
      state.set(confidence.subarray(0, count));
      if (out !== confidence) out.set(state);
      return;
    }

    const span = MOTION_HIGH - MOTION_LOW;
    for (let i = 0; i < count; i += 1) {
      const previous = state[i]!;
      const delta = confidence[i]! - previous;
      // Inlined `temporalKeep`: this loop runs over every mask pixel.
      const magnitude = delta < 0 ? -delta : delta;
      let keep = keepMax;
      if (magnitude >= MOTION_HIGH) keep = 0;
      else if (magnitude > MOTION_LOW) {
        const t = (magnitude - MOTION_LOW) / span;
        keep = keepMax * (1 - t * t * (3 - 2 * t));
      }
      const next = previous + delta * (1 - keep);
      state[i] = next;
      out[i] = next;
    }
  }
}
