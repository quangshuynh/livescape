import { describe, expect, it } from 'vitest';

import { DEFAULT_MASK_SHAPING, clamp, shapeConfidence } from './mask.js';
import { QUALITY_ORDER, QUALITY_PRESETS } from './quality.js';

describe('clamp', () => {
  it.each([
    [5, 0, 1, 1],
    [-5, 0, 1, 0],
    [0.5, 0, 1, 0.5],
  ])('clamps %s into [%s, %s]', (value, min, max, expected) => {
    expect(clamp(value, min, max)).toBe(expected);
  });
});

describe('shapeConfidence', () => {
  it('cuts hard when softness is zero', () => {
    expect(shapeConfidence(0.49, 0.5, 0)).toBe(0);
    expect(shapeConfidence(0.51, 0.5, 0)).toBe(1);
  });

  it('is half covered at the threshold', () => {
    expect(shapeConfidence(0.5, 0.5, 0.2)).toBeCloseTo(0.5, 5);
  });

  it('saturates outside the ramp', () => {
    expect(shapeConfidence(0.1, 0.5, 0.2)).toBe(0);
    expect(shapeConfidence(0.9, 0.5, 0.2)).toBe(1);
  });

  it('rises monotonically across the ramp', () => {
    const samples = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65].map((value) =>
      shapeConfidence(value, 0.5, 0.2),
    );

    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
  });

  it('follows the threshold', () => {
    // A higher threshold demands more confidence for the same coverage.
    expect(shapeConfidence(0.5, 0.7, 0.2)).toBeLessThan(shapeConfidence(0.5, 0.5, 0.2));
  });
});

describe('defaults', () => {
  it('prefers a low-latency temporal smoothing default', () => {
    // Heavy smoothing hides a bad mask behind a ghost trailing the subject.
    expect(DEFAULT_MASK_SHAPING.smoothing).toBeLessThanOrEqual(0.3);
  });

  it('feathers the edge by default', () => {
    expect(DEFAULT_MASK_SHAPING.softness).toBeGreaterThan(0);
    expect(DEFAULT_MASK_SHAPING.featherPx).toBeGreaterThan(0);
  });
});

describe('quality presets', () => {
  it('trades input size against inference interval in one direction', () => {
    const ordered = QUALITY_ORDER.map((id) => QUALITY_PRESETS[id]);

    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]!.inputSize).toBeGreaterThan(ordered[i - 1]!.inputSize);
      expect(ordered[i]!.minIntervalMs).toBeLessThan(ordered[i - 1]!.minIntervalMs);
    }
  });

  it('never asks for inference faster than a display refresh', () => {
    for (const preset of Object.values(QUALITY_PRESETS)) {
      expect(preset.minIntervalMs).toBeGreaterThanOrEqual(16);
    }
  });
});
