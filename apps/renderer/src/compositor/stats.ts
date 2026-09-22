import type { Resolution } from '../camera/types.js';
import { EMPTY_SEGMENTATION_STATS, type SegmentationStats } from '../segmentation/scheduler.js';
import type { SegmentationQuality } from '../segmentation/types.js';

export interface CompositorStats {
  /** Smoothed rate of the compositor's own animation loop. */
  readonly renderFps: number;
  /** What the camera actually delivers, which is rarely what was requested. */
  readonly cameraResolution: Resolution | null;
  /** Rate the camera delivers new frames, where the browser reports it. */
  readonly cameraFps: number;
  /** The size of the frame handed to the segmenter. */
  readonly segmentationInput: Resolution | null;
  /** The size of the mask the backend returned. */
  readonly maskResolution: Resolution | null;
  /** Which backend is running, for example `mediapipe-selfie/GPU`. */
  readonly segmentationBackend: string | null;
  readonly quality: SegmentationQuality | null;
  readonly segmentation: SegmentationStats;
  /** Smoothed time spent turning a mask into a matte, in milliseconds. */
  readonly processingMs: number;
  /** Whether the last matte was edge-refined against its camera frame. */
  readonly edgeRefined: boolean;
  /**
   * How old the camera frame on screen was when it was last drawn, in
   * milliseconds. The subject is shown with its own mask, so this is the
   * delay segmentation adds to the subject.
   */
  readonly maskAgeMs: number | null;
  /** Masks thrown away because their frame was no longer the one waiting. */
  readonly staleMasks: number;
}

export const EMPTY_COMPOSITOR_STATS: CompositorStats = {
  renderFps: 0,
  cameraResolution: null,
  cameraFps: 0,
  segmentationInput: null,
  maskResolution: null,
  segmentationBackend: null,
  quality: null,
  segmentation: EMPTY_SEGMENTATION_STATS,
  processingMs: 0,
  edgeRefined: false,
  maskAgeMs: null,
  staleMasks: 0,
};

/** Exponential moving average; the first sample seeds it. */
export function ema(previous: number, sample: number, alpha = 0.15): number {
  return previous === 0 ? sample : previous + (sample - previous) * alpha;
}

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
