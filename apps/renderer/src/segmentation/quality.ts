import type { SegmentationQuality } from './types.js';

export interface QualityPreset {
  readonly id: SegmentationQuality;
  readonly label: string;
  /**
   * Longest side, in pixels, of the frame handed to the segmenter. The model
   * always runs at 256x256, and MediaPipe returns the mask at this size, so
   * this sets the resolution the matte is processed and refined at, not what
   * the model sees.
   */
  readonly inputSize: number;
  /**
   * Lower bound between two inference starts, in milliseconds. A mask is
   * never computed for a camera frame that has already been segmented, so at
   * or below one camera frame period this means "every camera frame".
   */
  readonly minIntervalMs: number;
  /**
   * Edge-refinement window radius, in the refiner's half-resolution pixels
   * (see `refine.ts`). 0 disables refinement.
   */
  readonly refineRadius: number;
  /** Largest share of wall-clock time segmentation may use (see the scheduler). */
  readonly maxDutyCycle: number;
}

/**
 * Every preset shows the subject synchronised with its own mask, so the rate
 * here is also the rate the subject moves at on stream.
 *
 * - Performance limits segmentation to about 20 masks a second, at the lowest
 *   resolution, with no refinement: for machines where inference is the
 *   bottleneck.
 * - Balanced segments every frame of a 30 FPS camera and refines edges.
 * - Quality raises the matte resolution and widens refinement; it is meant for
 *   a still desk setup on a machine with headroom.
 */
export const QUALITY_PRESETS: Record<SegmentationQuality, QualityPreset> = {
  performance: {
    id: 'performance',
    label: 'Performance',
    inputSize: 256,
    minIntervalMs: 45,
    refineRadius: 0,
    maxDutyCycle: 0.5,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    inputSize: 320,
    minIntervalMs: 20,
    refineRadius: 1,
    maxDutyCycle: 0.8,
  },
  quality: {
    id: 'quality',
    label: 'Quality',
    inputSize: 384,
    minIntervalMs: 16,
    refineRadius: 2,
    maxDutyCycle: 0.9,
  },
};

export const DEFAULT_QUALITY: SegmentationQuality = 'balanced';

export const QUALITY_ORDER: readonly SegmentationQuality[] = [
  'performance',
  'balanced',
  'quality',
];
