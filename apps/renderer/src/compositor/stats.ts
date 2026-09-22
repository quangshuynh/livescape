import type { Resolution } from '../camera/types.js';
import { EMPTY_SEGMENTATION_STATS, type SegmentationStats } from '../segmentation/scheduler.js';

export interface CompositorStats {
  /** Smoothed rate of the compositor's own animation loop. */
  readonly renderFps: number;
  /** What the camera actually delivers, which is rarely what was requested. */
  readonly cameraResolution: Resolution | null;
  /** The size of the frame handed to the segmenter. */
  readonly segmentationInput: Resolution | null;
  /** Which backend is running, for example `mediapipe-selfie/GPU`. */
  readonly segmentationBackend: string | null;
  readonly segmentation: SegmentationStats;
}

export const EMPTY_COMPOSITOR_STATS: CompositorStats = {
  renderFps: 0,
  cameraResolution: null,
  segmentationInput: null,
  segmentationBackend: null,
  segmentation: EMPTY_SEGMENTATION_STATS,
};

/** Exponential moving average of frame rate, fed one timestamp per frame. */
export class FrameRateMeter {
  private last: number | null = null;
  private fps = 0;

  get value(): number {
    return this.fps;
  }

  sample(timeMs: number): number {
    if (this.last !== null) {
      const delta = timeMs - this.last;
      if (delta > 0) {
        const instant = 1000 / delta;
        this.fps = this.fps === 0 ? instant : this.fps + (instant - this.fps) * 0.1;
      }
    }
    this.last = timeMs;
    return this.fps;
  }

  reset(): void {
    this.last = null;
    this.fps = 0;
  }
}
