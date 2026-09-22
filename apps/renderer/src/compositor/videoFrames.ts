import { FrameRateMeter } from './stats.js';

/** The part of `HTMLVideoElement` this module uses, so tests can fake it. */
export interface VideoFrameSource {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

/**
 * Tells the compositor when the camera has delivered a new frame.
 *
 * The page animates at the display rate, usually 60 Hz, while a webcam
 * delivers 30 frames a second. Without this, every other animation frame
 * would re-segment a frame that has already been segmented. Where
 * `requestVideoFrameCallback` is missing, every animation frame counts as new,
 * and the scheduler's rate limit is the only guard.
 */
export class VideoFrameWatcher {
  private readonly video: VideoFrameSource;
  private readonly meter = new FrameRateMeter();
  private handle: number | null = null;
  private presented = 0;
  private consumed = 0;
  private stopped = false;

  constructor(video: VideoFrameSource) {
    this.video = video;
    this.listen();
  }

  /** False when the browser cannot report camera frames. */
  get supported(): boolean {
    return typeof this.video.requestVideoFrameCallback === 'function';
  }

  /** Smoothed camera delivery rate, or 0 when unsupported. */
  get fps(): number {
    return this.meter.value;
  }

  /** Frames the camera has delivered since this watcher started. */
  get presentedFrames(): number {
    return this.presented;
  }

  /** True if a frame has arrived since the last `consume()`. */
  get hasNewFrame(): boolean {
    return !this.supported || this.presented !== this.consumed;
  }

  consume(): void {
    this.consumed = this.presented;
  }

  dispose(): void {
    this.stopped = true;
    if (this.handle !== null) this.video.cancelVideoFrameCallback?.(this.handle);
    this.handle = null;
  }

  private listen(): void {
    const request = this.video.requestVideoFrameCallback;
    if (typeof request !== 'function' || this.stopped) return;
    this.handle = request.call(this.video, (now: number) => {
      if (this.stopped) return;
      this.presented += 1;
      this.meter.sample(now);
      this.listen();
    });
  }
}
