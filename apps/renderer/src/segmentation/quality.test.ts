import { describe, expect, it } from 'vitest';

import { DEFAULT_QUALITY, QUALITY_ORDER, QUALITY_PRESETS } from './quality.js';

const ordered = QUALITY_ORDER.map((id) => QUALITY_PRESETS[id]);

describe('quality presets', () => {
  it('defaults to Balanced', () => {
    expect(DEFAULT_QUALITY).toBe('balanced');
  });

  it('raises matte resolution, cadence and refinement in one direction', () => {
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]!.inputSize).toBeGreaterThan(ordered[i - 1]!.inputSize);
      expect(ordered[i]!.minIntervalMs).toBeLessThan(ordered[i - 1]!.minIntervalMs);
      expect(ordered[i]!.refineRadius).toBeGreaterThanOrEqual(ordered[i - 1]!.refineRadius);
      expect(ordered[i]!.maxDutyCycle).toBeGreaterThan(ordered[i - 1]!.maxDutyCycle);
    }
  });

  it('keeps Performance free of edge refinement', () => {
    expect(QUALITY_PRESETS.performance.refineRadius).toBe(0);
    expect(QUALITY_PRESETS.balanced.refineRadius).toBeGreaterThan(0);
  });

  it('never asks for inference faster than a display refresh', () => {
    for (const preset of ordered) expect(preset.minIntervalMs).toBeGreaterThanOrEqual(16);
  });

  it('lets Balanced and Quality keep up with a 30 FPS camera', () => {
    // A 30 FPS camera delivers a frame every 33 ms; a longer minimum interval
    // would halve the subject's frame rate.
    expect(QUALITY_PRESETS.balanced.minIntervalMs).toBeLessThan(33);
    expect(QUALITY_PRESETS.quality.minIntervalMs).toBeLessThan(33);
  });

  it('always leaves the page some of each second', () => {
    for (const preset of ordered) {
      expect(preset.maxDutyCycle).toBeGreaterThan(0);
      expect(preset.maxDutyCycle).toBeLessThan(1);
    }
  });
});
