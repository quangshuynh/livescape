import type { SegmentationMask } from './types.js';

export interface MaskShaping {
  /** Confidence at which a pixel is half opaque. */
  readonly threshold: number;
  /** Half-width of the ramp around the threshold. 0 is a hard cut. */
  readonly softness: number;
  /**
   * Weight kept from the previous mask, 0 to 0.9. Small values steady the
   * edge without the trailing ghost that heavy smoothing leaves behind a
   * moving arm.
   */
  readonly smoothing: number;
  /** Blur applied to the mask while compositing, in destination pixels. */
  readonly featherPx: number;
}

export const DEFAULT_MASK_SHAPING: MaskShaping = {
  threshold: 0.5,
  softness: 0.18,
  smoothing: 0.25,
  featherPx: 2,
};

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

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

/**
 * Turns a stream of confidence masks into a canvas whose alpha channel is the
 * subject's coverage.
 *
 * Drawing that canvas over the camera frame with `destination-in` is what
 * removes the physical background: the browser scales the small mask up to the
 * frame with bilinear filtering, which feathers the edge for free.
 */
export class MaskCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private previous: Float32Array | null = null;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement = document.createElement('canvas')) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
  }

  get ready(): boolean {
    return this.context !== null && this.width > 0 && this.height > 0;
  }

  /** Drops the temporal history, for example after a camera switch. */
  reset(): void {
    this.previous = null;
  }

  update(mask: SegmentationMask, shaping: MaskShaping): void {
    const context = this.context;
    if (!context) return;

    const { width, height, data } = mask;
    if (width <= 0 || height <= 0 || data.length < width * height) return;

    if (width !== this.width || height !== this.height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.width = width;
      this.height = height;
      this.image = context.createImageData(width, height);
      this.previous = null;
    }

    const image = this.image;
    if (!image) return;

    const keep = clamp(shaping.smoothing, 0, 0.9);
    const count = width * height;
    let previous = this.previous;
    if (!previous || previous.length !== count) {
      previous = new Float32Array(count);
      previous.set(data.subarray(0, count));
      this.previous = previous;
    }

    const pixels = image.data;
    for (let i = 0; i < count; i += 1) {
      const raw = data[i] ?? 0;
      const blended = keep > 0 ? (previous[i] ?? raw) * keep + raw * (1 - keep) : raw;
      previous[i] = blended;

      const alpha = shapeConfidence(blended, shaping.threshold, shaping.softness);
      const offset = i * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = Math.round(alpha * 255);
    }

    context.putImageData(image, 0, 0);
  }
}
