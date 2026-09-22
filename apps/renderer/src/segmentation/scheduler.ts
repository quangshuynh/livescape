import type { FrameSource, SegmentationMask, SubjectSegmenter } from './types.js';

/** Consecutive failures tolerated before the scheduler gives up on a backend. */
export const FAILURE_THRESHOLD = 5;

/** Weight of the newest sample in the exponential moving averages below. */
const EMA_ALPHA = 0.15;

export interface SegmentationStats {
  /** Smoothed inference duration in milliseconds. */
  readonly inferenceMs: number;
  /** Duration of the most recent inference in milliseconds. */
  readonly lastInferenceMs: number;
  /** Smoothed rate at which masks are produced. */
  readonly segmentationFps: number;
  /** Masks produced since the scheduler started. */
  readonly completed: number;
  /**
   * Frames offered while inference was still running. This is the backlog
   * pressure signal: the scheduler drops them rather than queueing them.
   */
  readonly skipped: number;
  /** Frames declined because the minimum interval had not elapsed. */
  readonly throttled: number;
  readonly errors: number;
  /**
   * Smoothed time from the start of an inference until its mask has been
   * handled (inference plus `onMask`), in milliseconds.
   */
  readonly costMs: number;
  /** The interval currently enforced between inference starts. */
  readonly intervalMs: number;
}

export const EMPTY_SEGMENTATION_STATS: SegmentationStats = {
  inferenceMs: 0,
  lastInferenceMs: 0,
  segmentationFps: 0,
  completed: 0,
  skipped: 0,
  throttled: 0,
  errors: 0,
  costMs: 0,
  intervalMs: 0,
};

/** What the scheduler knows about the frame a mask came from. */
export interface MaskResult {
  /** Identifies the submission; increases by one per started inference. */
  readonly sequence: number;
  /** The monotonic timestamp the backend was given. */
  readonly timestampMs: number;
  readonly startedAt: number;
  readonly finishedAt: number;
}

/**
 * The frame to segment, or a function that captures it. The function form is
 * only called once the scheduler has decided to start, so a frame that is
 * going to be skipped or throttled is never copied.
 */
export type FrameInput = FrameSource | ((sequence: number) => FrameSource | null);

export interface SegmentationSchedulerOptions {
  readonly segmenter: SubjectSegmenter;
  /** Lower bound between two inference starts. Set from the quality preset. */
  readonly minIntervalMs: number;
  /**
   * Largest fraction of wall-clock time segmentation may occupy, 0 to 1. When
   * a mask costs more (a slow machine, a busy GPU), the interval stretches so
   * the rest of the page keeps its frame rate and the subject updates less
   * often instead. Defaults to 1, no cap.
   */
  readonly maxDutyCycle?: number;
  readonly onMask: (mask: SegmentationMask, result: MaskResult) => void;
  /** Called when a started inference ends without a mask (null or error). */
  readonly onDrop?: (sequence: number) => void;
  /** Called once, when the backend has failed `FAILURE_THRESHOLD` times in a row. */
  readonly onFailure?: (error: unknown) => void;
  readonly now?: () => number;
}

/**
 * Runs segmentation at most once at a time, always on the newest frame.
 *
 * The renderer draws every animation frame; segmentation is slower than that.
 * A queue would turn the gap into latency that grows without bound, so a frame
 * offered while inference is running is dropped and counted. The next frame
 * the caller offers after inference finishes is by definition the current one,
 * which is the whole point: the mask may be a frame or two old, but it never
 * falls further behind than one inference.
 */
export class SegmentationScheduler {
  private readonly options: SegmentationSchedulerOptions;
  private readonly now: () => number;

  private busy = false;
  private disposed = false;
  private failed = false;
  private consecutiveFailures = 0;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private lastCompletedAt: number | null = null;
  private lastTimestampMs = Number.NEGATIVE_INFINITY;
  private sequence = 0;

  private inferenceMs = 0;
  private lastInferenceMs = 0;
  private segmentationFps = 0;
  private completed = 0;
  private skipped = 0;
  private throttled = 0;
  private errors = 0;
  private costMs = 0;

  constructor(options: SegmentationSchedulerOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
  }

  get stats(): SegmentationStats {
    return {
      inferenceMs: this.inferenceMs,
      lastInferenceMs: this.lastInferenceMs,
      segmentationFps: this.segmentationFps,
      completed: this.completed,
      skipped: this.skipped,
      throttled: this.throttled,
      errors: this.errors,
      costMs: this.costMs,
      intervalMs: this.intervalMs,
    };
  }

  /**
   * The enforced gap between inference starts: the preset's minimum, or
   * longer if the measured cost per mask would otherwise exceed the duty cycle.
   */
  get intervalMs(): number {
    const duty = this.options.maxDutyCycle ?? 1;
    const budgeted = duty > 0 && duty < 1 ? this.costMs / duty : 0;
    return Math.max(this.options.minIntervalMs, budgeted);
  }

  /** True once the backend has failed often enough to be considered unusable. */
  get hasFailed(): boolean {
    return this.failed;
  }

  /** Identifies the running backend, including its delegate where relevant. */
  get backend(): string {
    return this.options.segmenter.name;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /**
   * Offers a frame. Returns what the scheduler did with it, which is also what
   * the tests assert on.
   */
  submit(frame: FrameInput, timestampMs: number): 'started' | 'skipped' | 'throttled' | 'stopped' {
    if (this.disposed || this.failed) return 'stopped';
    if (this.busy) {
      this.skipped += 1;
      return 'skipped';
    }

    const startedAt = this.now();
    if (startedAt - this.lastStartedAt < this.intervalMs) {
      this.throttled += 1;
      return 'throttled';
    }

    const sequence = this.sequence + 1;
    const source = typeof frame === 'function' ? frame(sequence) : frame;
    if (!source) return 'stopped';
    this.sequence = sequence;

    // Backends that track video time reject a timestamp that moves backwards.
    const monotonic = Math.max(timestampMs, this.lastTimestampMs + 1);
    this.lastTimestampMs = monotonic;
    this.lastStartedAt = startedAt;
    this.busy = true;

    void this.run(source, sequence, monotonic, startedAt);
    return 'started';
  }

  private async run(
    frame: FrameSource,
    sequence: number,
    timestampMs: number,
    startedAt: number,
  ): Promise<void> {
    try {
      const mask = await this.options.segmenter.segment(frame, timestampMs);
      if (this.disposed) return;

      const finishedAt = this.now();
      this.record(startedAt, finishedAt);
      this.consecutiveFailures = 0;
      if (mask) this.options.onMask(mask, { sequence, timestampMs, startedAt, finishedAt });
      else this.options.onDrop?.(sequence);
      const cost = Math.max(0, this.now() - startedAt);
      this.costMs = this.costMs === 0 ? cost : this.costMs + (cost - this.costMs) * EMA_ALPHA;
    } catch (error) {
      if (this.disposed) return;
      this.options.onDrop?.(sequence);
      this.errors += 1;
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= FAILURE_THRESHOLD && !this.failed) {
        this.failed = true;
        this.options.onFailure?.(error);
      }
    } finally {
      this.busy = false;
    }
  }

  private record(startedAt: number, finishedAt: number): void {
    this.completed += 1;
    this.lastInferenceMs = Math.max(0, finishedAt - startedAt);
    this.inferenceMs =
      this.inferenceMs === 0
        ? this.lastInferenceMs
        : this.inferenceMs + (this.lastInferenceMs - this.inferenceMs) * EMA_ALPHA;

    if (this.lastCompletedAt !== null) {
      const gap = finishedAt - this.lastCompletedAt;
      if (gap > 0) {
        const fps = 1000 / gap;
        this.segmentationFps =
          this.segmentationFps === 0
            ? fps
            : this.segmentationFps + (fps - this.segmentationFps) * EMA_ALPHA;
      }
    }
    this.lastCompletedAt = finishedAt;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.options.segmenter.dispose();
  }
}
