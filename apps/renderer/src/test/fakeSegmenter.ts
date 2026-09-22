import type { FrameSource, SegmentationMask, SubjectSegmenter } from '../segmentation/types.js';

interface Pending {
  resolve: (mask: SegmentationMask | null) => void;
  reject: (error: unknown) => void;
  timestampMs: number;
}

/**
 * A segmenter whose inference the test controls frame by frame.
 *
 * Holding calls open is what makes the scheduler's concurrency rules testable:
 * real backends finish too fast and too unpredictably to assert on.
 */
export class FakeSegmenter implements SubjectSegmenter {
  readonly name = 'fake';
  readonly calls: number[] = [];

  initialized = 0;
  disposed = 0;

  /** Makes `initialize()` reject, standing in for a missing runtime. */
  failInitialize: Error | null = null;
  /** Makes every `segment()` reject. */
  failSegment: Error | null = null;
  /** When false, calls resolve immediately instead of being held open. */
  manual = true;

  private pending: Pending[] = [];
  private nextMask: SegmentationMask = { width: 2, height: 2, data: new Float32Array([1, 1, 1, 1]) };

  get inFlight(): number {
    return this.pending.length;
  }

  setMask(mask: SegmentationMask): void {
    this.nextMask = mask;
  }

  async initialize(): Promise<void> {
    this.initialized += 1;
    if (this.failInitialize) throw this.failInitialize;
  }

  segment(_frame: FrameSource, timestampMs: number): Promise<SegmentationMask | null> {
    this.calls.push(timestampMs);
    if (this.failSegment) return Promise.reject(this.failSegment);
    if (!this.manual) return Promise.resolve(this.nextMask);
    return new Promise<SegmentationMask | null>((resolve, reject) => {
      this.pending.push({ resolve, reject, timestampMs });
    });
  }

  /** Completes the oldest outstanding inference. */
  finishOne(mask: SegmentationMask | null = this.nextMask): void {
    const next = this.pending.shift();
    next?.resolve(mask);
  }

  failOne(error: Error): void {
    const next = this.pending.shift();
    next?.reject(error);
  }

  async dispose(): Promise<void> {
    this.disposed += 1;
    this.pending = [];
  }
}

export function solidMask(width: number, height: number, value: number): SegmentationMask {
  return { width, height, data: new Float32Array(width * height).fill(value) };
}
