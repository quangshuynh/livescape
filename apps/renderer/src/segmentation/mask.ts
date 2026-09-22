import { clamp } from './math.js';
import { GuidedMatteRefiner, rgbaToLuma } from './refine.js';
import { TemporalMatteFilter } from './temporal.js';
import type { SegmentationMask } from './types.js';

export { clamp };

export interface MaskShaping {
  /** Confidence at which a pixel is half opaque. */
  readonly threshold: number;
  /** Half-width of the ramp around the threshold. 0 is a hard cut. */
  readonly softness: number;
  /**
   * Weight kept from the previous mask where the mask barely changed, 0 to
   * 0.9. Real motion bypasses it (see `temporal.ts`), so it steadies a still
   * edge without leaving a ghost behind a moving arm.
   */
  readonly smoothing: number;
  /** Blur applied to the mask while compositing, in destination pixels. */
  readonly featherPx: number;
  /** Snap the matte edge to edges in the camera image (see `refine.ts`). */
  readonly refineEdges: boolean;
}

export const DEFAULT_MASK_SHAPING: MaskShaping = {
  threshold: 0.5,
  softness: 0.18,
  smoothing: 0.5,
  featherPx: 2,
  refineEdges: true,
};

/**
 * How far the threshold moves towards a pixel's previous state. A pixel that
 * was subject needs a little less confidence to stay subject, and a pixel that
 * was background a little more to become subject, so a still edge whose
 * confidence wobbles around the threshold does not flip every frame.
 */
export const HYSTERESIS = 0.04;

/**
 * Maps a raw confidence onto coverage with a smoothstep ramp.
 *
 * A hard threshold makes the edge crawl from frame to frame because pixels on
 * the boundary flip between 0 and 1; a ramp turns that into a soft edge that
 * reads as anti-aliasing instead of noise.
 */
export function shapeConfidence(confidence: number, threshold: number, softness: number): number {
  if (softness <= 0) return confidence >= threshold ? 1 : 0;
  const low = threshold - softness;
  const t = clamp((confidence - low) / (softness * 2), 0, 1);
  return t * t * (3 - 2 * t);
}

/** `shapeConfidence` with the threshold biased towards the pixel's last state. */
export function shapeWithHysteresis(
  confidence: number,
  threshold: number,
  softness: number,
  wasSubject: boolean,
): number {
  const biased = wasSubject ? threshold - HYSTERESIS : threshold + HYSTERESIS;
  return shapeConfidence(confidence, biased, softness);
}

/** The camera frame a mask was computed from, at the mask's own resolution. */
export interface MaskGuide {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface MaskUpdateOptions {
  /** Guide image for edge refinement; ignored unless it matches the mask size. */
  readonly guide?: MaskGuide | null;
  /** Refinement window radius in mask pixels; 0 disables refinement. */
  readonly refineRadius?: number;
}

/**
 * Turns a stream of confidence masks into a canvas whose alpha channel is the
 * subject's coverage.
 *
 * Per mask: motion-gated temporal filtering on confidence, optional
 * edge-aware refinement against the matching camera frame, then the
 * threshold ramp with hysteresis. Drawing the canvas over the camera frame
 * with `destination-in` is what removes the physical background.
 *
 * All history is per pixel and one frame deep; `reset()` drops it.
 */
export class MaskCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly temporal = new TemporalMatteFilter();
  private readonly refiner = new GuidedMatteRefiner();
  private image: ImageData | null = null;
  private work: Float32Array | null = null;
  private luma: Float32Array | null = null;
  private subject: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private refined = false;

  constructor(canvas: HTMLCanvasElement = document.createElement('canvas')) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
  }

  get ready(): boolean {
    return this.context !== null && this.width > 0 && this.height > 0;
  }

  /** Whether the last update was edge-refined, for diagnostics. */
  get lastRefined(): boolean {
    return this.refined;
  }

  /** Pixels of history held, for the tests: 0 after a reset. */
  get historySize(): number {
    return this.temporal.size + (this.subject?.length ?? 0) + this.refiner.size;
  }

  /** Drops the temporal history, for example after a camera switch. */
  reset(): void {
    this.temporal.reset();
    this.refiner.reset();
    this.subject = null;
    this.work = null;
    this.luma = null;
  }

  update(mask: SegmentationMask, shaping: MaskShaping, options: MaskUpdateOptions = {}): void {
    const context = this.context;
    if (!context) return;

    const { width, height, data } = mask;
    const count = width * height;
    if (width <= 0 || height <= 0 || data.length < count) return;

    if (width !== this.width || height !== this.height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.width = width;
      this.height = height;
      this.image = context.createImageData(width, height);
      this.reset();
    }

    const image = this.image;
    if (!image) return;

    let work = this.work;
    if (!work || work.length !== count) {
      work = new Float32Array(count);
      this.work = work;
    }
    this.temporal.apply(data, count, shaping.smoothing, work);

    const radius = options.refineRadius ?? 0;
    const guide = options.guide;
    this.refined = false;
    if (
      shaping.refineEdges &&
      radius > 0 &&
      guide &&
      guide.width === width &&
      guide.height === height &&
      guide.data.length >= count * 4
    ) {
      let luma = this.luma;
      if (!luma || luma.length !== count) {
        luma = new Float32Array(count);
        this.luma = luma;
      }
      rgbaToLuma(guide.data, count, luma);
      this.refiner.refine(work, luma, width, height, radius);
      this.refined = true;
    }

    let subject = this.subject;
    const first = !subject || subject.length !== count;
    if (!subject || first) {
      subject = new Uint8Array(count);
      this.subject = subject;
    }

    const { threshold, softness } = shaping;
    const pixels = image.data;
    for (let i = 0; i < count; i += 1) {
      const value = work[i]!;
      const alpha = first
        ? shapeConfidence(value, threshold, softness)
        : shapeWithHysteresis(value, threshold, softness, subject[i] === 1);
      subject[i] = alpha >= 0.5 ? 1 : 0;
      const offset = i * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(alpha * 255);
    }

    context.putImageData(image, 0, 0);
  }
}
