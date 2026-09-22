import type { SegmentationQuality } from './types.js';

export interface QualityPreset {
  readonly id: SegmentationQuality;
  readonly label: string;
  /**
   * Longest side, in pixels, of the frame handed to the segmenter. The
   * SelfieSegmenter model resamples to 256x256 internally whatever it is
   * given, so this mostly controls how much detail survives the downscale and
   * how large the returned mask is.
   */
  readonly inputSize: number;
  /** Lower bound between two inference starts, in milliseconds. */
  readonly minIntervalMs: number;
}

export const QUALITY_PRESETS: Record<SegmentationQuality, QualityPreset> = {
  performance: { id: 'performance', label: 'Performance', inputSize: 192, minIntervalMs: 66 },
  balanced: { id: 'balanced', label: 'Balanced', inputSize: 256, minIntervalMs: 40 },
  quality: { id: 'quality', label: 'Quality', inputSize: 384, minIntervalMs: 25 },
};

export const DEFAULT_QUALITY: SegmentationQuality = 'balanced';

export const QUALITY_ORDER: readonly SegmentationQuality[] = [
  'performance',
  'balanced',
  'quality',
];
